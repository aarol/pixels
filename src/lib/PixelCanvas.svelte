<script lang="ts">
  let { src }: { src: string } = $props()

  const MAX_CELL = 80
  const PAD = 24
  const KEEP_VISIBLE = 64
  const GRID_COLOR = '#c8c8c8'
  const GRID_WIDTH = 1
  const GRID_MIN_CELL = 3

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement

  let source: HTMLCanvasElement | null = null
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
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
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

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      source,
      x0, y0, x1 - x0, y1 - y0,
      ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s,
    )

    // Border is a constant GRID_WIDTH css px at every zoom level; it's only
    // hidden when cells get too small for it to be useful.
    if (scale < GRID_MIN_CELL) return

    const lw = Math.max(1, Math.round(GRID_WIDTH * dpr))
    const half = Math.floor(lw / 2)
    const top = Math.round(oy + y0 * s)
    const bottom = Math.round(oy + y1 * s)
    const left = Math.round(ox + x0 * s)
    const right = Math.round(ox + x1 * s)

    ctx.fillStyle = GRID_COLOR
    for (let i = x0; i <= x1; i++) {
      ctx.fillRect(Math.round(ox + i * s) - half, top - half, lw, bottom - top + lw)
    }
    for (let j = y0; j <= y1; j++) {
      ctx.fillRect(left - half, Math.round(oy + j * s) - half, right - left + lw, lw)
    }
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

  $effect(() => {
    const url = src
    const img = new Image()
    let cancelled = false

    img.onload = () => {
      if (cancelled) return
      imgW = img.naturalWidth
      imgH = img.naturalHeight
      const off = document.createElement('canvas')
      off.width = imgW
      off.height = imgH
      off.getContext('2d')!.drawImage(img, 0, 0)
      source = off
      fitted = false
      if (viewW > 0) {
        fit()
        schedule()
      }
    }
    img.src = url

    return () => {
      cancelled = true
    }
  })

  const pointers = new Map<number, { x: number; y: number }>()

  function local(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
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
    pointers.set(e.pointerId, local(e))
  }

  function onPointerMove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const p = local(e)

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
  }
</script>

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
