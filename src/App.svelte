<script lang="ts">
  import PixelCanvas from './lib/PixelCanvas.svelte'
  import Palette from './lib/Palette.svelte'
  import type { Rgb } from './lib/quantize'

  let palette = $state.raw<Rgb[]>([])
  let progress = $state.raw<number[]>([])
  let selected = $state<number | null>(null)
</script>

<PixelCanvas src="test.png" numColors={100} bind:palette bind:progress {selected} />
<Palette {palette} {progress} bind:selected />
