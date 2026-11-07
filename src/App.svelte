<script lang="ts">
  import PixelCanvas from './lib/PixelCanvas.svelte'
  import Palette from './lib/Palette.svelte'
  import Menu from './lib/Menu.svelte'
  import type { Rgb } from './lib/quantize'

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
</script>

<PixelCanvas
  bind:this={pixelCanvas}
  src={selectedImage.src}
  numColors={selectedImage.colors}
  bind:palette
  bind:progress
  bind:completed
  {selected}
/>
<Palette {palette} {progress} bind:completed bind:selected />
<Menu
  imageName={selectedImage.name}
  onReset={() => pixelCanvas.resetProgress()}
/>
