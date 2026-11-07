<script lang="ts">
  import PixelCanvas from './lib/PixelCanvas.svelte'
  import Palette from './lib/Palette.svelte'
  import Menu from './lib/Menu.svelte'
  import type { Rgb } from './lib/quantize'
    import { createTextMask, eraseCapsule, wiperPos } from './lib/intro';

  let palette = $state.raw<Rgb[]>([])
  let progress = $state.raw<number[]>([])
  let completed = $state<number | null>(null)
  let selected = $state<number | null>(null)

  const images = [
    { src: 'test.png', name: 'Test Image 1', colors: 30 },
    { src: 'place2017.png', name: 'r/place 2017', colors: 16 },
  ]
  const selectedImage = $state(images[1])

  let pixelCanvas: PixelCanvas
  let introActive = $state(true)
  let introCleanup: (() => void) | null = null


  function startIntro(width: number, height: number) {
    introCleanup?.()

    const displayFilled = new Uint8Array(width * height)
    displayFilled.fill(1)
    pixelCanvas.setDisplayFilled(displayFilled)

    const { mask, minX, maxX, minY, maxY } = createTextMask(width, height)

    const HOLD_INITIAL = 900
    const WIPE_MAIN = 2600
    const HOLD_TEXT = 1800
    const WIPE_TEXT = 900

    const mainRadius = Math.max(16, Math.hypot(width, height) * 0.085)
    const mainStrokes = 18

    const boxPad = Math.max(12, Math.round(height * 0.04))
    const bx0 = Math.max(0, minX - boxPad)
    const by0 = Math.max(0, minY - boxPad)
    const bw = Math.min(width - bx0, maxX - minX + boxPad * 2)
    const bh = Math.min(height - by0, maxY - minY + boxPad * 2)
    const textRadius = Math.max(16, Math.hypot(bw, bh) * 0.14)
    const textStrokes = 12

    const startTime = performance.now()
    let prevMainT = 0
    let prevTextT = 0
    let mainCleaned = false
    let raf = 0

    function tick(now: number) {
      const elapsed = now - startTime

      if (elapsed < HOLD_INITIAL) {
        raf = requestAnimationFrame(tick)
        return
      }

      const mainElapsed = elapsed - HOLD_INITIAL
      if (mainElapsed < WIPE_MAIN) {
        const currT = Math.min(1, mainElapsed / WIPE_MAIN)
        const subSteps = Math.max(1, Math.ceil((currT - prevMainT) * mainStrokes * 4))
        for (let s = 0; s < subSteps; s++) {
          const t0 = prevMainT + ((currT - prevMainT) * s) / subSteps
          const t1 = prevMainT + ((currT - prevMainT) * (s + 1)) / subSteps
          const p0 = wiperPos(t0, mainStrokes, 0, 0, width, height, 0.08)
          const p1 = wiperPos(t1, mainStrokes, 0, 0, width, height, 0.08)
          eraseCapsule(displayFilled, mask, width, height, p0.x, p0.y, p1.x, p1.y, mainRadius)
        }
        prevMainT = currT
        pixelCanvas.setDisplayFilled(displayFilled)
        raf = requestAnimationFrame(tick)
        return
      }

      if (!mainCleaned) {
        mainCleaned = true
        for (let i = 0; i < displayFilled.length; i++) {
          displayFilled[i] = mask[i]
        }
        pixelCanvas.setDisplayFilled(displayFilled)
      }

      const holdElapsed = mainElapsed - WIPE_MAIN
      if (holdElapsed < HOLD_TEXT) {
        raf = requestAnimationFrame(tick)
        return
      }

      const textElapsed = holdElapsed - HOLD_TEXT
      if (textElapsed < WIPE_TEXT) {
        const currT = Math.min(1, textElapsed / WIPE_TEXT)
        const subSteps = Math.max(1, Math.ceil((currT - prevTextT) * textStrokes * 4))
        for (let s = 0; s < subSteps; s++) {
          const t0 = prevTextT + ((currT - prevTextT) * s) / subSteps
          const t1 = prevTextT + ((currT - prevTextT) * (s + 1)) / subSteps
          const p0 = wiperPos(t0, textStrokes, bx0, by0, bw, bh, 0.12)
          const p1 = wiperPos(t1, textStrokes, bx0, by0, bw, bh, 0.12)
          eraseCapsule(displayFilled, null, width, height, p0.x, p0.y, p1.x, p1.y, textRadius)
        }
        prevTextT = currT
        pixelCanvas.setDisplayFilled(displayFilled)
        raf = requestAnimationFrame(tick)
        return
      }

      pixelCanvas.setDisplayFilled()
      introActive = false
      introCleanup = null
    }

    raf = requestAnimationFrame(tick)
    introCleanup = () => {
      cancelAnimationFrame(raf)
    }
  }

  function handleReady({
    width,
    height,
    hasSavedProgress,
  }: {
    width: number
    height: number
    hasSavedProgress: boolean
  }) {
    if (hasSavedProgress) {
      introCleanup?.()
      introCleanup = null
      introActive = false
      return
    }
    startIntro(width, height)
  }

  function onWindowKeyDownCapture(e: KeyboardEvent) {
    if (introActive) {
      e.stopImmediatePropagation()
    }
  }
</script>

<svelte:window onkeydowncapture={onWindowKeyDownCapture} />

<PixelCanvas
  bind:this={pixelCanvas}
  src={selectedImage.src}
  numColors={selectedImage.colors}
  bind:palette
  bind:progress
  bind:completed
  {selected}
  onReady={handleReady}
/>

<div class="intro-vignette" class:active={introActive} aria-hidden="true"></div>

<div class="ui-chrome" class:hidden={introActive} inert={introActive}>
  <Palette {palette} {progress} bind:completed bind:selected />
  <Menu
    imageName={selectedImage.name}
    onReset={() => pixelCanvas.resetProgress()}
  />
</div>

<style>
  .intro-vignette {
    position: fixed;
    inset: 0;
    z-index: 5;
    pointer-events: none;
    opacity: 0;
    transition: opacity 600ms ease;
    background:
      linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.55) 0%,
        rgba(0, 0, 0, 0.18) 12%,
        rgba(255, 255, 255, 0) 24%
      ),
      linear-gradient(
        to top,
        rgba(0, 0, 0, 0.55) 0%,
        rgba(0, 0, 0, 0.18) 12%,
        rgba(255, 255, 255, 0) 24%
      );
  }

  .intro-vignette.active {
    opacity: 1;
    pointer-events: all;
  }

  .ui-chrome :global(.palette),
  .ui-chrome :global(.menu-btn) {
    transition:
      translate 550ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 450ms ease;
  }

  .ui-chrome.hidden :global(.palette) {
    translate: 0 calc(100% + 32px);
    opacity: 0;
  }

  .ui-chrome.hidden :global(.menu-btn) {
    translate: 0 calc(-100% - 32px);
    opacity: 0;
  }

  @media (min-width: 701px) {
    .ui-chrome.hidden :global(.palette),
    .ui-chrome.hidden :global(.menu-btn) {
      translate: calc(100% + 32px) 0;
      opacity: 0;
    }
  }
</style>
