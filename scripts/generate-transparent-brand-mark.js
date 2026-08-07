const path = require('path')
const sharp = require('sharp')

const projectRoot = path.resolve(__dirname, '..')
const inputPath = path.join(projectRoot, 'frontend', 'assets', 'brand', 'lingxi-logo.png')
const outputPath = path.join(projectRoot, 'frontend', 'assets', 'brand', 'lingxi-logo-transparent.png')

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

async function main() {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixelCount = info.width * info.height
  const candidate = new Uint8Array(pixelCount)
  const luminance = new Float32Array(pixelCount)

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const a = data[offset + 3]
    const light = r * 0.2126 + g * 0.7152 + b * 0.0722
    luminance[index] = light
    candidate[index] = a > 0 && light > 24 ? 1 : 0
  }

  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let best = []
  let bestScore = 0

  for (let start = 0; start < pixelCount; start += 1) {
    if (!candidate[start] || visited[start]) continue
    let head = 0
    let tail = 0
    let lightSum = 0
    const component = []
    queue[tail++] = start
    visited[start] = 1

    while (head < tail) {
      const current = queue[head++]
      component.push(current)
      lightSum += luminance[current]
      const x = current % info.width
      const y = Math.floor(current / info.width)
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x + 1 < info.width ? current + 1 : -1,
        y > 0 ? current - info.width : -1,
        y + 1 < info.height ? current + info.width : -1
      ]
      for (const next of neighbors) {
        if (next >= 0 && candidate[next] && !visited[next]) {
          visited[next] = 1
          queue[tail++] = next
        }
      }
    }

    const score = component.length * (lightSum / component.length)
    if (component.length > 80 && score > bestScore) {
      best = component
      bestScore = score
    }
  }

  const foreground = new Uint8Array(pixelCount)
  for (const index of best) foreground[index] = 1

  const output = Buffer.from(data)
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    if (!foreground[index]) {
      output[offset] = 0
      output[offset + 1] = 0
      output[offset + 2] = 0
      output[offset + 3] = 0
      continue
    }
    const extractedAlpha = Math.round(255 * smoothstep(24, 78, luminance[index]))
    output[offset + 3] = Math.min(data[offset + 3], extractedAlpha)
  }

  await sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 }
  }).png().toFile(outputPath)

  console.log(`Created ${outputPath}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
