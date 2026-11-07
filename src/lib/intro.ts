export function createTextMask(width: number, height: number) {
  const off = document.createElement('canvas')
  off.width = width
  off.height = height
  const ctx = off.getContext('2d')!

  const lines = ['Color', 'r/place']
  const fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

  let fontSize = Math.floor(width / 4)
  ctx.font = `bold ${fontSize}px ${fontFamily}`
  const maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width))
  if (maxLineWidth > 0) {
    fontSize = Math.floor(fontSize * ((width * 0.78) / maxLineWidth))
  }
  ctx.font = `900 ${fontSize}px ${fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'

  const lineHeight = fontSize * 1.15
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], width / 2, startY + i * lineHeight)
  }

  const data = ctx.getImageData(0, 0, width, height).data
  const mask = new Uint8Array(width * height)
  let minX = width
  let maxX = 0
  let minY = height
  let maxY = 0

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      if (data[i * 4 + 3] > 128) {
        mask[i] = 1
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (minX > maxX) {
    minX = 0
    maxX = width - 1
    minY = 0
    maxY = height - 1
  }

  return { mask, minX, maxX, minY, maxY }
}

export function eraseCircle(
  buf: Uint8Array,
  mask: Uint8Array | null,
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
) {
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(width - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(height - 1, Math.ceil(cy + r))
  const r2 = r * r

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy
    const dy2 = dy * dy
    const row = y * width
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      if (dx * dx + dy2 <= r2) {
        const i = row + x
        if (!mask || !mask[i]) {
          buf[i] = 0
        }
      }
    }
  }
}

export function eraseCapsule(
  buf: Uint8Array,
  mask: Uint8Array | null,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
) {
  const dist = Math.hypot(bx - ax, by - ay)
  const step = Math.max(2, r * 0.25)
  const steps = Math.max(1, Math.ceil(dist / step))
  for (let s = 0; s <= steps; s++) {
    const k = s / steps
    eraseCircle(buf, mask, width, height, ax + (bx - ax) * k, ay + (by - ay) * k, r)
  }
}

function triangleWave(t: number) {
  const p = ((t % 1) + 1) % 1
  return p < 0.5 ? p * 4 - 1 : 3 - p * 4
}

export function wiperPos(
  t: number,
  strokes: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  pad: number,
) {
  const u = -pad + t * (1 + 2 * pad)
  const span = Math.min(1 + pad, 2 * Math.min(u + pad, 1 + pad - u) + 0.25)
  const v = triangleWave(t * (strokes / 2)) * span
  const nx = (2 * u + v) * 0.5
  const ny = (2 * u - v) * 0.5
  return {
    x: x0 + nx * w,
    y: y0 + ny * h,
  }
}
