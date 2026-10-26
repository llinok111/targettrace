// Proves the upstream dependency is not patched: the installed
// node_modules/browserslist is compared file by file against the tarball named
// by package-lock.json, and that tarball's SHA-512 is checked against the
// integrity recorded in the lockfile.
//
// Usage: node scripts/verify-upstream.cjs   -> docs/VERIFY-UPSTREAM.json

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))
const VERSION = pkg.dependencies.browserslist

function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// Minimal tar reader (ustar, regular files only) so the check has no dependency
// of its own.
function readTar (buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    if (name === '') break
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
    const type = header[156]
    const data = buffer.subarray(offset + 512, offset + 512 + size)
    if (type === 0x30 || type === 0) entries.set(name, Buffer.from(data))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

async function main () {
  const vendorDir = path.join(ROOT, 'node_modules', 'browserslist')
  if (!fs.existsSync(vendorDir)) throw new Error('run `npm ci` first')

  const installedVersion = require(path.join(vendorDir, 'package.json')).version
  if (installedVersion !== VERSION) {
    throw new Error(`installed browserslist ${installedVersion} but package.json pins ${VERSION}`)
  }

  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
  const lockEntry = lock.packages['node_modules/browserslist']
  if (!lockEntry || lockEntry.version !== VERSION) throw new Error('lockfile entry missing for browserslist')

  const response = await fetch(lockEntry.resolved)
  if (!response.ok) throw new Error(`could not download ${lockEntry.resolved}: ${response.status}`)
  const tarball = Buffer.from(await response.arrayBuffer())
  const integrity = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`

  const entries = readTar(zlib.gunzipSync(tarball))
  const identical = []
  const modified = []
  const missing = []

  for (const [name, content] of entries) {
    const relative = name.replace(/^package\//, '')
    const onDisk = path.join(vendorDir, relative)
    if (!fs.existsSync(onDisk)) {
      missing.push(relative)
      continue
    }
    if (sha256(content) === sha256(fs.readFileSync(onDisk))) identical.push(relative)
    else modified.push(relative)
  }

  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    package: 'browserslist',
    version: VERSION,
    installedVersion,
    source: lockEntry.resolved,
    tarballIntegrityMatchesLockfile: integrity === lockEntry.integrity,
    integrity,
    filesCompared: identical.length + modified.length + missing.length,
    identical: identical.length,
    files: identical.sort(),
    modified,
    missing,
    upstreamPatched: modified.length > 0 || missing.length > 0
  }

  fs.writeFileSync(
    path.join(ROOT, 'docs', 'VERIFY-UPSTREAM.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  )

  process.stdout.write(
    `browserslist ${VERSION}: ${identical.length}/${report.filesCompared} files byte-identical to ${path.basename(lockEntry.resolved)}\n`
  )
  process.stdout.write(
    `modified: ${modified.length}, missing: ${missing.length}, tarball integrity matches lockfile: ${report.tarballIntegrityMatchesLockfile}\n`
  )
  if (report.upstreamPatched) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`verify-upstream failed: ${error.message}\n`)
  process.exitCode = 1
})
