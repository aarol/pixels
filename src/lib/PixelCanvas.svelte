<script lang="ts">
  import { quantize, type Rgb } from './quantize'
  import { loadProgress, saveProgress } from './storage'
  import { createRenderer, type WebGPURenderer } from './webgpu'

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

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let renderer: WebGPURenderer | null = null

  let indices: Uint16Array = new Uint16Array(0)
  let filled: Uint8Array = new Uint8Array(0)
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

  function draw() {
    raf = 0
    if (!renderer) return
    renderer.render({
      viewW,
      viewH,
      dpr,
      scale,
      tx,
      ty,
      selected,
    })
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

    if (imgW > 0 && imgH > 0) {
      if (fitted) clampView()
      else fit()
    }
    draw()
  }

  $effect(() => {
    let cancelled = false
    createRenderer(canvas).then((r) => {
      if (cancelled) {
        r.destroy()
        return
      }
      renderer = r
      if (imgW > 0 && imgH > 0) {
        r.setImage(imgW, imgH, palette, indices, filled)
      }
      schedule()
    })

    return () => {
      cancelled = true
      renderer?.destroy()
      renderer = null
    }
  })

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

  $effect(() => {
    void selected
    if (renderer && imgW > 0) schedule()
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
    const currentFilled = new Uint8Array(idx.length)

    const sizeChanged = w !== imgW || h !== imgH
    palette = pal
    indices = idx
    filled = currentFilled
    storageKey = key
    imgW = w
    imgH = h

    renderer?.setImage(w, h, pal, idx, currentFilled)

    if (sizeChanged) fitted = false
    if (viewW > 0) {
      if (!fitted) fit()
      schedule()
    }

    let cancelled = false
    loadProgress(key).then((saved) => {
      if (cancelled || !saved || saved.length !== currentFilled.length) return
      for (let i = 0; i < saved.length; i++) {
        if (saved[i]) currentFilled[i] = 1
      }
      renderer?.setFilled(currentFilled)
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
    if (imgW === 0 || imgH === 0) return null
    const x = Math.floor((p.x - tx) / scale)
    const y = Math.floor((p.y - ty) / scale)
    if (x < 0 || x >= imgW || y < 0 || y >= imgH) return null
    return { x, y, i: y * imgW + x }
  }

  function isColorable(x: number, y: number) {
    if (x < 0 || x >= imgW || y < 0 || y >= imgH || selected === null) return false
    const i = y * imgW + x
    return indices[i] === selected && !filled[i]
  }

  function hasColorableNeighbor(x: number, y: number) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (isColorable(x + dx, y + dy)) return true
      }
    }
    return false
  }

  function paintCell(x: number, y: number) {
    if (!isColorable(x, y)) return false
    const i = y * imgW + x
    filled[i] = 1
    renderer?.paintCell(x, y)
    schedule()
    queueSave()
    return true
  }

  function paintLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    if (imgW === 0 || imgH === 0 || selected === null) return

    const x0 = (from.x - tx) / scale
    const y0 = (from.y - ty) / scale
    const x1 = (to.x - tx) / scale
    const y1 = (to.y - ty) / scale

    let cx = Math.floor(x0)
    let cy = Math.floor(y0)
    const endX = Math.floor(x1)
    const endY = Math.floor(y1)

    paintCell(cx, cy)
    if (cx === endX && cy === endY) return

    const dx = x1 - x0
    const dy = y1 - y0
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity

    let tMaxX =
      stepX > 0 ? (cx + 1 - x0) * tDeltaX : stepX < 0 ? (x0 - cx) * tDeltaX : Infinity
    let tMaxY =
      stepY > 0 ? (cy + 1 - y0) * tDeltaY : stepY < 0 ? (y0 - cy) * tDeltaY : Infinity

    const maxSteps = Math.abs(endX - cx) + Math.abs(endY - cy)
    for (let s = 0; s < maxSteps; s++) {
      if (tMaxX < tMaxY) {
        tMaxX += tDeltaX
        cx += stepX
      } else {
        tMaxY += tDeltaY
        cy += stepY
      }
      paintCell(cx, cy)
    }
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
      if (cell && hasColorableNeighbor(cell.x, cell.y)) {
        paintCell(cell.x, cell.y)
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
      paintLine(prev, p)
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
