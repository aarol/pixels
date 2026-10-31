# AGENTS.md

## Commands

Use `pnpm` (`pnpm-lock.yaml` is the lockfile). There is no test runner or linter configured; `pnpm check` is the primary verification step.

- `pnpm check` — Run `svelte-check` (`tsconfig.app.json`) and `tsc` (`tsconfig.node.json`)
- `pnpm build` — Build production bundle with Vite
- `pnpm dev` — Start Vite dev server

## Architecture & Conventions

pixel-by-number image viewer/editor built with **Svelte 5** (`^5.57`), **TypeScript 6**, and **Vite 8** (plain Vite SPA, not SvelteKit).

- **Svelte 5 Runes**: Always use Svelte 5 runes (`$state`, `$state.raw`, `$derived`, `$effect`, `$props`, `$bindable`) and `mount()`. Do not use legacy Svelte 3/4 syntax (`export let`, `$:`, `on:click`, `createEventDispatcher`).
- **Large buffers in state**: Prefer `$state.raw` over `$state` for `ImageData`, typed arrays, and large palette arrays to avoid deep proxy overhead.
- **Code style**: 2-space indentation, single quotes, no semicolons.

## Key Modules (`src/lib/`)

- `quantize.ts`: Median-cut color quantization (`quantize(image, numColors)`). Composites alpha over white first (output is always fully opaque) and returns `{ image: ImageData, palette: Rgb[], indices: Uint16Array }` where `indices` is row-major.
- `PixelCanvas.svelte`: Full-bleed interactive 2D `<canvas>` with pan, wheel zoom, and 2-pointer pinch-zoom.
  - Coordinate transform: screen CSS px = `imagePoint * scale + (tx, ty)`; backing store scales by `devicePixelRatio`.
  - Performance invariants: only visible cells (`[x0..x1, y0..y1]`) are drawn; cell index labels are pre-rendered into offscreen canvas tiles (`tiles` map) cached at integer device-pixel cell `size` and blitted 1:1 with `imageSmoothingEnabled = false`. Clear `tiles` whenever `palette` or cell pixel `size` changes.
- `Palette.svelte`: Paginated color toolbar (10 colors/page; keys `0`–`9` select slots on the active page). Responsive layout switches at `701px` (bottom bar on mobile, right vertical rail on desktop).
