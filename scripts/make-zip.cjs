// Builds the release archive from the files git tracks, so the ZIP and the
// repository can never disagree. Writes deliver/<name>-<version>.zip plus a
// `<...>.zip.sha256` sidecar (LF line ending, so `sha256sum -c` works on
// Windows too).
//
// Usage: node scripts/make-zip.cjs [--out=<dir>]

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const zlib = require('node:zlib')

const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))
const outFlag = process.argv.find(item => item.startsWith('--out='))
const outDir = outFlag ? path.resolve(outFlag.slice('--out='.length)) : path.join(ROOT, '..', 'deliver-' + pkg.name)

function tracked () {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  return output.split('\0').filter(Boolean).sort()
}

// --- Minimal deterministic ZIP writer (stored + deflate) ---------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32 (buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function dosTime (date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  return { time, day }
}

function writeZip (entries, target) {
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = entry.content
    const compressed = zlib.deflateRawSync(content, { level: 9 })
    const useDeflate = compressed.length < content.length
    const data = useDeflate ? compressed : content
    const crc = crc32(content)
    const { time, day } = dosTime(entry.mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, name, data)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(useDeflate ? 8 : 0, 10)
    header.writeUInt16LE(time, 12)
    header.writeUInt16LE(day, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(content.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  fs.writeFileSync(target, Buffer.concat([...chunks, centralBuffer, end]))
}

function main () {
  const files = tracked()
  if (files.length === 0) throw new Error('git tracks no files; run from the repository root')
  if (files.some(file => file.startsWith('node_modules/'))) throw new Error('node_modules is tracked; refusing to package')

  const prefix = `${pkg.name}-${pkg.version}/`
  const entries = files.map(file => ({
    name: prefix + file,
    content: fs.readFileSync(path.join(ROOT, file)),
    mtime: fs.statSync(path.join(ROOT, file)).mtime
  }))

  fs.mkdirSync(outDir, { recursive: true })
  const zipPath = path.join(outDir, `${pkg.name}-${pkg.version}.zip`)
  writeZip(entries, zipPath)

  const digest = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
  fs.writeFileSync(
    `${zipPath}.sha256`,
    `${digest}  ${path.basename(zipPath)}\n`,
    { encoding: 'utf8', newline: '\n' }
  )

  const size = fs.statSync(zipPath).size
  process.stdout.write(`wrote ${zipPath}\n`)
  process.stdout.write(`${entries.length} entries, ${(size / 1024).toFixed(1)} KiB, sha256 ${digest}\n`)
}

main()
