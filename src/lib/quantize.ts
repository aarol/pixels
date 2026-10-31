type Entry = { r: number; g: number; b: number; n: number }

const CHANNELS = ['r', 'g', 'b'] as const

function range(box: Entry[]) {
  let best: (typeof CHANNELS)[number] = 'r'
  let bestRange = -1
  for (const c of CHANNELS) {
    let lo = 255
    let hi = 0
    for (const e of box) {
      if (e[c] < lo) lo = e[c]
      if (e[c] > hi) hi = e[c]
    }
    if (hi - lo > bestRange) {
      bestRange = hi - lo
      best = c
    }
  }
  return { channel: best, size: bestRange }
}

function average(box: Entry[]): Entry {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (const e of box) {
    r += e.r * e.n
    g += e.g * e.n
    b += e.b * e.n
    n += e.n
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n }
}

export type Rgb = { r: number; g: number; b: number }

export type Quantized = {
  image: ImageData
  palette: Rgb[]
  /** Palette index of every pixel, row-major. */
  indices: Uint16Array
}

/**
 * Reduces an image to at most `numColors` colors using median cut, then maps
 * every pixel to its nearest palette color. Transparent pixels are composited
 * onto white first, so the result is fully opaque.
 */
export function quantize(image: ImageData, numColors: number): Quantized {
  const { data, width, height } = image
  const k = Math.max(1, Math.floor(numColors))

  const counts = new Map<number, Entry>()
  const keys = new Uint32Array(width * height)
  for (let i = 0; i < keys.length; i++) {
    const a = data[i * 4 + 3] / 255
    const r = Math.round(data[i * 4] * a + 255 * (1 - a))
    const g = Math.round(data[i * 4 + 1] * a + 255 * (1 - a))
    const b = Math.round(data[i * 4 + 2] * a + 255 * (1 - a))
    const key = (r << 16) | (g << 8) | b
    keys[i] = key
    const entry = counts.get(key)
    if (entry) entry.n++
    else counts.set(key, { r, g, b, n: 1 })
  }

  const boxes: Entry[][] = [[...counts.values()]]
  while (boxes.length < k) {
    let target = -1
    let targetSize = 0
    let targetChannel: (typeof CHANNELS)[number] = 'r'
    boxes.forEach((box, i) => {
      if (box.length < 2) return
      const { channel, size } = range(box)
      if (size > targetSize) {
        target = i
        targetSize = size
        targetChannel = channel
      }
    })
    if (target < 0) break

    const box = boxes[target]
    box.sort((a, b) => a[targetChannel] - b[targetChannel])
    const total = box.reduce((sum, e) => sum + e.n, 0)
    let acc = 0
    let split = 1
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].n
      split = i + 1
      if (acc >= total / 2) break
    }
    boxes.splice(target, 1, box.slice(0, split), box.slice(split))
  }

  const palette = boxes.map(average)
  const nearest = new Map<number, number>()
  for (const [key, e] of counts) {
    let best = 0
    let bestDist = Infinity
    palette.forEach((p, i) => {
      const d = (p.r - e.r) ** 2 + (p.g - e.g) ** 2 + (p.b - e.b) ** 2
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    nearest.set(key, best)
  }

  const out = new ImageData(width, height)
  const indices = new Uint16Array(keys.length)
  for (let i = 0; i < keys.length; i++) {
    const index = nearest.get(keys[i])!
    const c = palette[index]
    indices[i] = index
    out.data[i * 4] = c.r
    out.data[i * 4 + 1] = c.g
    out.data[i * 4 + 2] = c.b
    out.data[i * 4 + 3] = 255
  }
  return {
    image: out,
    palette: palette.map(({ r, g, b }) => ({ r, g, b })),
    indices,
  }
}
