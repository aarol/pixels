<script lang="ts">
  import { untrack } from 'svelte'
  import { quantize, type Rgb } from './quantize'
  import { loadProgress, saveProgress } from './storage'

  // numColors is expected to be between 10 and 500. The resulting palette is
  // reported back through the bindable `palette` prop.
  let {
    src,
    numColors,
    palette = $bindable([]),
    selected = null,
  }: { src: string; numColors: number; palette?: Rgb[]; selected?: number | null } = $props()

  const MAX_CELL = 80
  const PAD = 24
  const KEEP_VISIBLE = 64
  const UNFILLED_RGB = [0xe8, 0xe8, 0xe8] as const
  const HIGHLIGHT_RGB = [0xcf, 0xcf, 0xcf] as const
  const GRID_COLOR = '#c8c8c8'
  const GRID_WIDTH = 1
  const GRID_RES = 4
  const GRID_FADE_START = 3
  const GRID_FADE_END = 7
  const NUMBER_FADE_START = 16
  const NUMBER_FADE_END = 22
  const TEXT_RES = 48

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement

  let source: HTMLCanvasElement | null = null
  let sourceCtx: CanvasRenderingContext2D | null = null
  let gridLayer: HTMLCanvasElement | null = null
  let surfaceData: ImageData | null = null
  let indices: Uint16Array = new Uint16Array(0)
  let filled: Uint8Array = new Uint8Array(0)
  let colorCells: Uint32Array[] = []
  let highlighted: number | null = null
  let imgW = 0
  let imgH = 0

  let viewW = 0
  let viewH = 0
  let dpr = 1

  // Screen position (css px) of an image point p is: p * scale + (tx, ty)
  let scale = 1
  let tx = 0
  let ty = 0
  let fitted = false

  let raf = 0

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

  function fitScale() {
    return Math.min((viewW - PAD * 2) / imgW, (viewH - PAD * 2) / imgH)
  }

  function minScale() {
    return Math.min(fitScale(), MAX_CELL)
  }

  function clampView() {
    scale = clamp(scale, minScale(), MAX_CELL)
    // Pan freely, but keep a sliver of the image on screen so it can't be lost.
    const w = imgW * scale
    const h = imgH * scale
    const keepX = Math.min(w, KEEP_VISIBLE)
    const keepY = Math.min(h, KEEP_VISIBLE)
    tx = clamp(tx, keepX - w, viewW - keepX)
    ty = clamp(ty, keepY - h, viewH - keepY)
  }

  function fit() {
    scale = fitScale()
    tx = (viewW - imgW * scale) / 2
    ty = (viewH - imgH * scale) / 2
    clampView()
    fitted = true
  }

  function zoomAt(cx: number, cy: number, factor: number) {
    const next = clamp(scale * factor, minScale(), MAX_CELL)
    const k = next / scale
    tx = cx - (cx - tx) * k
    ty = cy - (cy - ty) * k
    scale = next
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw)
  }

  // Each color's number is rendered once into a fixed TEXT_RES×TEXT_RES tile,
  // and cached in `detailCanvas` for a padded window of cells around the
  // viewport. Panning and zooming within that window only takes a single
  // drawImage call, and zooming never rebuilds text tiles.
  const tiles = new Map<number, HTMLCanvasElement>()
  let detailCanvas: HTMLCanvasElement | null = null
  let detailCtx: CanvasRenderingContext2D | null = null
  let detailX0 = 0
  let detailY0 = 0
  let detailX1 = 0
  let detailY1 = 0

  function invalidateDetail() {
    detailX0 = 0
    detailY0 = 0
    detailX1 = 0
    detailY1 = 0
  }

  function makeTile(index: number) {
    const size = TEXT_RES
    const tile = document.createElement('canvas')
    tile.width = size
    tile.height = size
    const t = tile.getContext('2d')!

    const label = String(index)

    let fontSize = size * 0.5
    t.font = `${fontSize}px system-ui, sans-serif`
    const width = t.measureText(label).width
    if (width > size * 0.8) {
      fontSize *= (size * 0.8) / width
      t.font = `${fontSize}px system-ui, sans-serif`
    }

    const m = t.measureText(label)
    t.fillStyle = '#000'
    t.textAlign = 'center'
    t.textBaseline = 'alphabetic'
    t.fillText(label, size / 2, size / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)
    return tile
  }

  function ensureDetailWindow(vx0: number, vy0: number, vx1: number, vy1: number) {
    if (
      detailCanvas &&
      vx0 >= detailX0 &&
      vy0 >= detailY0 &&
      vx1 <= detailX1 &&
      vy1 <= detailY1
    ) {
      return
    }

    const padX = Math.max(8, ((vx1 - vx0) >> 1) + 4)
    const padY = Math.max(8, ((vy1 - vy0) >> 1) + 4)
    const nx0 = clamp(vx0 - padX, 0, imgW)
    const ny0 = clamp(vy0 - padY, 0, imgH)
    const nx1 = clamp(vx1 + padX, 0, imgW)
    const ny1 = clamp(vy1 + padY, 0, imgH)
    const cw = nx1 - nx0
    const ch = ny1 - ny0
    if (cw <= 0 || ch <= 0) return

    if (!detailCanvas) {
      detailCanvas = document.createElement('canvas')
      detailCtx = detailCanvas.getContext('2d')!
    }
    const reqW = cw * TEXT_RES
    const reqH = ch * TEXT_RES
    if (detailCanvas.width !== reqW || detailCanvas.height !== reqH) {
      detailCanvas.width = reqW
      detailCanvas.height = reqH
    } else {
      detailCtx!.clearRect(0, 0, reqW, reqH)
    }

    const dctx = detailCtx!
    for (let y = ny0; y < ny1; y++) {
      const row = y * imgW
      const dy = (y - ny0) * TEXT_RES
      for (let x = nx0; x < nx1; x++) {
        const i = row + x
        if (filled[i]) continue
        const colorIdx = indices[i]
        let tile = tiles.get(colorIdx)
        if (!tile) {
          tile = makeTile(colorIdx)
          tiles.set(colorIdx, tile)
        }
        dctx.drawImage(tile, (x - nx0) * TEXT_RES, dy)
      }
    }

    detailX0 = nx0
    detailY0 = ny0
    detailX1 = nx1
    detailY1 = ny1
  }

  function clearDetailCell(x: number, y: number) {
    if (!detailCtx || x < detailX0 || x >= detailX1 || y < detailY0 || y >= detailY1) return
    detailCtx.clearRect((x - detailX0) * TEXT_RES, (y - detailY0) * TEXT_RES, TEXT_RES, TEXT_RES)
  }

  function draw() {
    raf = 0
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, W, H)
    if (!source) return

    const s = scale * dpr
    const ox = tx * dpr
    const oy = ty * dpr

    const x0 = clamp(Math.floor(-ox / s), 0, imgW)
    const y0 = clamp(Math.floor(-oy / s), 0, imgH)
    const x1 = clamp(Math.ceil((W - ox) / s), 0, imgW)
    const y1 = clamp(Math.ceil((H - oy) / s), 0, imgH)
    if (x1 <= x0 || y1 <= y0) return

    // Layer 1: precomputed whole-canvas colors (unfilled, highlighted, painted)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      source,
      x0, y0, x1 - x0, y1 - y0,
      ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s,
    )

    const gridAlpha = clamp((scale - GRID_FADE_START) / (GRID_FADE_END - GRID_FADE_START), 0, 1)
    if (gridAlpha <= 0) return

    const numAlpha = clamp((scale - NUMBER_FADE_START) / (NUMBER_FADE_END - NUMBER_FADE_START), 0, 1)

    // Layer 2: middle zoom — whole grid pre-rendered to an offscreen canvas at
    // fixed resolution (GRID_RES px/cell), blitted in a single drawImage call.
    if (numAlpha <= 0) {
      if (gridLayer) {
        ctx.globalAlpha = gridAlpha
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(
          gridLayer,
          x0 * GRID_RES, y0 * GRID_RES, (x1 - x0) * GRID_RES, (y1 - y0) * GRID_RES,
          ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s,
        )
        ctx.globalAlpha = 1
      }
      return
    }

    // Layer 3: close zoom — generates a single-resolution text canvas only for
    // a padded region around the viewport, and draws crisp grid lines.
    if (palette.length > 0) {
      ensureDetailWindow(x0, y0, x1, y1)
      if (detailCanvas && detailX1 > detailX0 && detailY1 > detailY0) {
        ctx.globalAlpha = numAlpha
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(
          detailCanvas,
          (x0 - detailX0) * TEXT_RES,
          (y0 - detailY0) * TEXT_RES,
          (x1 - x0) * TEXT_RES,
          (y1 - y0) * TEXT_RES,
          ox + x0 * s,
          oy + y0 * s,
          (x1 - x0) * s,
          (y1 - y0) * s,
        )
      }
    }

    const lw = Math.max(1, Math.round(GRID_WIDTH * dpr))
    const half = Math.floor(lw / 2)
    const top = Math.round(oy + y0 * s)
    const bottom = Math.round(oy + y1 * s)
    const left = Math.round(ox + x0 * s)
    const right = Math.round(ox + x1 * s)

    ctx.globalAlpha = gridAlpha
    ctx.fillStyle = GRID_COLOR
    for (let i = x0; i <= x1; i++) {
      ctx.fillRect(Math.round(ox + i * s) - half, top - half, lw, bottom - top + lw)
    }
    for (let j = y0; j <= y1; j++) {
      ctx.fillRect(left - half, Math.round(oy + j * s) - half, right - left + lw, lw)
    }
    ctx.globalAlpha = 1
  }

  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    dpr = window.devicePixelRatio || 1

    tx += (w - viewW) / 2
    ty += (h - viewH) / 2
    viewW = w
    viewH = h
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))

    if (source) {
      if (fitted) clampView()
      else fit()
    }
    draw()
  }

  $effect(() => {
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      let d = e.deltaY
      if (e.deltaMode === 1) d *= 16
      else if (e.deltaMode === 2) d *= viewH
      // ctrl+wheel is how trackpad pinch arrives; its deltas are much smaller
      const factor = Math.exp(-d * (e.ctrlKey ? 0.01 : 0.002))
      const rect = canvas.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
      clampView()
      schedule()
    }
    container.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      observer.disconnect()
      container.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(raf)
      raf = 0
    }
  })

  let original = $state.raw<ImageData | null>(null)

  $effect(() => {
    const img = new Image()
    let cancelled = false

    img.onload = () => {
      if (cancelled) return
      const off = document.createElement('canvas')
      off.width = img.naturalWidth
      off.height = img.naturalHeight
      const octx = off.getContext('2d')!
      octx.drawImage(img, 0, 0)
      original = octx.getImageData(0, 0, off.width, off.height)
    }
    img.src = src

    return () => {
      cancelled = true
    }
  })

  let storageKey = ''
  let saveTimer = 0

  function queueSave() {
    if (saveTimer) return
    const key = storageKey
    const data = filled
    saveTimer = window.setTimeout(() => {
      saveTimer = 0
      if (key) saveProgress(key, data)
    }, 250)
  }

  function flushSave() {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = 0
    if (storageKey) saveProgress(storageKey, filled)
  }

  function fillUnfilled(colorIdx: number, rgb: readonly [number, number, number]) {
    if (!surfaceData) return false
    const cells = colorCells[colorIdx]
    if (!cells) return false
    const data = surfaceData.data
    const [r, g, b] = rgb
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k]
      if (!filled[i]) {
        const p = i * 4
        data[p] = r
        data[p + 1] = g
        data[p + 2] = b
      }
    }
    return true
  }

  $effect(() => {
    const next = selected
    if (!sourceCtx || !surfaceData || next === highlighted) return
    let dirty = false
    if (highlighted !== null) dirty = fillUnfilled(highlighted, UNFILLED_RGB) || dirty
    if (next !== null) dirty = fillUnfilled(next, HIGHLIGHT_RGB) || dirty
    highlighted = next
    if (dirty) {
      sourceCtx.putImageData(surfaceData, 0, 0)
      schedule()
    }
  })

  $effect(() => {
    if (!original) return
    const quantized = quantize(original, numColors)
    const pixels = quantized.image
    const w = pixels.width
    const h = pixels.height
    const key = `${src}:${numColors}:${w}x${h}`

    const idx = quantized.indices
    const pal = quantized.palette
    const counts = new Uint32Array(pal.length)
    for (let i = 0; i < idx.length; i++) counts[idx[i]]++
    const cells = Array.from(counts, (c) => new Uint32Array(c))
    counts.fill(0)
    for (let i = 0; i < idx.length; i++) {
      const c = idx[i]
      cells[c][counts[c]++] = i
    }

    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const octx = off.getContext('2d')!
    const sData = new ImageData(w, h)
    const buf = sData.data
    const [ur, ug, ub] = UNFILLED_RGB
    for (let p = 0; p < buf.length; p += 4) {
      buf[p] = ur
      buf[p + 1] = ug
      buf[p + 2] = ub
      buf[p + 3] = 255
    }

    const currentFilled = new Uint8Array(idx.length)

    palette = pal
    indices = idx
    filled = currentFilled
    colorCells = cells
    highlighted = null
    storageKey = key
    surfaceData = sData

    const sizeChanged = w !== imgW || h !== imgH
    if (sizeChanged || !gridLayer) {
      const gOff = document.createElement('canvas')
      gOff.width = w * GRID_RES
      gOff.height = h * GRID_RES
      const gctx = gOff.getContext('2d')!
      gctx.fillStyle = GRID_COLOR
      for (let i = 0; i <= w; i++) {
        gctx.fillRect(i === w ? w * GRID_RES - 1 : i * GRID_RES, 0, 1, h * GRID_RES)
      }
      for (let j = 0; j <= h; j++) {
        gctx.fillRect(0, j === h ? h * GRID_RES - 1 : j * GRID_RES, w * GRID_RES, 1)
      }
      gridLayer = gOff
    }
    imgW = w
    imgH = h
    source = off
    sourceCtx = octx
    tiles.clear()
    invalidateDetail()
    const sel = untrack(() => selected)
    if (sel !== null) {
      fillUnfilled(sel, HIGHLIGHT_RGB)
      highlighted = sel
    }
    octx.putImageData(sData, 0, 0)
    if (sizeChanged) fitted = false
    if (viewW > 0) {
      if (!fitted) fit()
      schedule()
    }

    let cancelled = false
    loadProgress(key).then((saved) => {
      if (cancelled || !saved || saved.length !== currentFilled.length) return
      const qData = pixels.data
      for (let i = 0; i < saved.length; i++) {
        if (saved[i]) {
          currentFilled[i] = 1
          const p = i * 4
          buf[p] = qData[p]
          buf[p + 1] = qData[p + 1]
          buf[p + 2] = qData[p + 2]
        }
      }
      octx.putImageData(sData, 0, 0)
      invalidateDetail()
      schedule()
    })

    return () => {
      cancelled = true
      flushSave()
    }
  })

  const pointers = new Map<number, { x: number; y: number }>()
  let paintingPointer: number | null = null

  function local(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function cellAt(p: { x: number; y: number }) {
    if (!source) return null
    const x = Math.floor((p.x - tx) / scale)
    const y = Math.floor((p.y - ty) / scale)
    if (x < 0 || x >= imgW || y < 0 || y >= imgH) return null
    return { x, y, i: y * imgW + x }
  }

  function paintCell(cell: { x: number; y: number; i: number }) {
    if (selected === null || indices[cell.i] !== selected || !sourceCtx || !surfaceData) return false
    if (!filled[cell.i]) {
      filled[cell.i] = 1
      const c = palette[selected]
      const p = cell.i * 4
      surfaceData.data[p] = c.r
      surfaceData.data[p + 1] = c.g
      surfaceData.data[p + 2] = c.b
      sourceCtx.fillStyle = `rgb(${c.r} ${c.g} ${c.b})`
      sourceCtx.fillRect(cell.x, cell.y, 1, 1)
      clearDetailCell(cell.x, cell.y)
      schedule()
      queueSave()
    }
    return true
  }

  function gesture() {
    const [a, b] = [...pointers.values()]
    return {
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      dist: Math.hypot(a.x - b.x, a.y - b.y),
    }
  }

  function onPointerDown(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId)
    const p = local(e)
    pointers.set(e.pointerId, p)

    if (pointers.size === 1) {
      const cell = cellAt(p)
      if (cell && paintCell(cell)) {
        paintingPointer = e.pointerId
      }
    } else {
      paintingPointer = null
    }
  }

  function onPointerMove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const p = local(e)

    if (paintingPointer === e.pointerId && pointers.size === 1) {
      pointers.set(e.pointerId, p)
      const cell = cellAt(p)
      if (cell) paintCell(cell)
      return
    }

    if (pointers.size === 1) {
      tx += p.x - prev.x
      ty += p.y - prev.y
      pointers.set(e.pointerId, p)
    } else {
      const before = gesture()
      pointers.set(e.pointerId, p)
      const after = gesture()
      if (before.dist > 0) zoomAt(before.mx, before.my, after.dist / before.dist)
      tx += after.mx - before.mx
      ty += after.my - before.my
    }

    clampView()
    schedule()
  }

  function onPointerEnd(e: PointerEvent) {
    pointers.delete(e.pointerId)
    if (paintingPointer === e.pointerId) {
      paintingPointer = null
      flushSave()
    }
  }
</script>

<svelte:window onpagehide={flushSave} />

<div class="viewport" bind:this={container}>
  <canvas
    bind:this={canvas}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
  ></canvas>
</div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #fff;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }

  canvas:active {
    cursor: grabbing;
  }
</style>
