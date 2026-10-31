<script lang="ts">
  import { contrastColor } from './color'
  import type { Rgb } from './quantize'

  const PAGE_SIZE = 10

  let {
    palette,
    selected = $bindable(null),
  }: { palette: Rgb[]; selected?: number | null } = $props()

  let page = $state(0)

  const pageCount = $derived(Math.ceil(palette.length / PAGE_SIZE))
  const slots = $derived(
    palette.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((color, i) => ({
      color,
      index: page * PAGE_SIZE + i,
    })),
  )

  $effect(() => {
    if (page >= pageCount) page = 0
  })

  function nextPage() {
    page = (page + 1) % pageCount
  }

  function prevPage() {
    page = (page - 1 + pageCount) % pageCount
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
    if (!/^[0-9]$/.test(e.key)) return
    const index = page * PAGE_SIZE + Number(e.key)
    if (index < palette.length) selected = index
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if palette.length > 0}
  <div class="palette" role="toolbar" aria-label="Colors">
    {#if pageCount > 1}
      <button class="nav prev" aria-label="Previous colors" onclick={prevPage}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M15 5l-7 7 7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    {/if}
    <div class="swatches">
      {#each slots as { color, index } (index)}
        <button
          class="swatch"
          class:selected={selected === index}
          style:background={`rgb(${color.r} ${color.g} ${color.b})`}
          style:color={contrastColor(color)}
          aria-label={`Color ${index}`}
          aria-pressed={selected === index}
          onclick={() => (selected = index)}
        >
          {index}
        </button>
      {/each}
    </div>
    {#if pageCount > 1}
      <button class="nav next" aria-label="Next colors" onclick={nextPage}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M9 5l7 7-7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    {/if}
  </div>
{/if}

<style>
  .palette {
    position: fixed;
    z-index: 1;
    box-sizing: border-box;
    background: #fff;
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
    display: flex;
    gap: 8px;
    padding: 10px;
  }

  .swatches {
    flex: 1;
    max-width: 360px;
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(5, 1fr);
  }

  button {
    font: inherit;
    border: 0;
    margin: 0;
    padding: 0;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }

  .swatch {
    aspect-ratio: 1;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .swatch.selected {
    outline: 3px solid #111;
    outline-offset: 2px;
  }

  .nav {
    flex: none;
    width: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: #eee;
    color: #111;
  }

  .nav:active {
    background: #ddd;
  }

  /* Phone: pinned to the bottom, two rows of five, arrows on either side. */
  .palette {
    left: 0;
    right: 0;
    bottom: 0;
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
    border-radius: 14px 14px 0 0;
    justify-content: center;
  }

  /* Desktop: vertically centred on the right, one column flowing down. */
  @media (min-width: 701px) {
    .palette {
      left: auto;
      right: 16px;
      bottom: auto;
      top: 50%;
      transform: translateY(-50%);
      padding-bottom: 10px;
      border-radius: 14px;
      flex-direction: column;
    }

    .swatches {
      grid-template-columns: 48px;
    }

    .nav {
      width: auto;
      height: 36px;
    }

    .prev svg {
      transform: rotate(90deg);
    }

    .next svg {
      transform: rotate(90deg);
    }
  }
</style>
