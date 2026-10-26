// Minimal PNG reader for verification: supports 8-bit RGB and RGBA,
// non-interlaced images (what Chromium/Edge screenshots produce).

const zlib = require('node:zlib')

function decode (buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  if (interlace !== 0) throw new Error('interlaced PNG not supported')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (channels === 0) throw new Error(`unsupported color type ${colorType}`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= channels ? prev[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft)
      }
      out[x] = value & 0xff
    }
  }

  return { width, height, channels, pixels }
}

function stats (image) {
  const { width, height, channels, pixels } = image
  const colors = new Set()
  let sum = 0
  let ink = 0
  const backgroundSamples = new Map()
  let backgroundTotal = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * channels
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      sum += luma
      if (luma > 40) ink += 1
      colors.add((r << 16) | (g << 8) | b)
      // Background estimate from the left third only: the right edge can carry
      // a scrollbar, and corners can carry a focus ring.
      if (x < width / 3) {
        const key = `${r},${g},${b}`
        backgroundSamples.set(key, (backgroundSamples.get(key) || 0) + 1)
        backgroundTotal += 1
      }
    }
  }

  let modeKey = null
  let modeCount = 0
  for (const [key, count] of backgroundSamples) {
    if (count > modeCount) {
      modeCount = count
      modeKey = key
    }
  }
  const [br, bg, bb] = modeKey.split(',').map(Number)
  const backgroundLuma = 0.2126 * br + 0.7152 * bg + 0.0722 * bb

  return {
    width,
    height,
    colors: colors.size,
    meanLuma: Number((sum / (width * height)).toFixed(2)),
    background: {
      rgb: [br, bg, bb],
      luma: Number(backgroundLuma.toFixed(2)),
      share: Number((modeCount / backgroundTotal).toFixed(4))
    },
    inkShare: Number((ink / (width * height) * 100).toFixed(2))
  }
}

module.exports = { decode, stats }
