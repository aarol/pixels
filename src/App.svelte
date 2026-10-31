<script lang="ts">
  import PixelCanvas from './lib/PixelCanvas.svelte'
  import Palette from './lib/Palette.svelte'
  import type { Rgb } from './lib/quantize'

  let palette = $state.raw<Rgb[]>([])
  let selected = $state<number | null>(null)
</script>

<PixelCanvas src="/test2.png" numColors={100} bind:palette {selected} />
<Palette {palette} bind:selected />
