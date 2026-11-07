<script lang="ts">
    import { contrastColor } from "./color";
    import type { Rgb } from "./quantize";

    import { MediaQuery } from 'svelte/reactivity';

    const isDesktop = new MediaQuery('min-width: 768px');

    const PAGE_SIZE = 10;

    let {
        palette,
        progress = [],
        completed = $bindable(null),
        selected = $bindable(null),
    }: {
        palette: Rgb[];
        progress?: number[];
        completed?: number | null;
        selected?: number | null;
    } = $props();

    let page = $state(0);
    let scroller = $state<HTMLDivElement | null>(null);
    let scrollRaf = 0;
    let lastScrollPos = 0;
    let scrollDir = 0;

    const SCROLL_DURATION = 160;

    const pageCount = $derived(Math.ceil(palette.length / PAGE_SIZE));
    const pages = $derived(
        Array.from({ length: pageCount }, (_, p) =>
            palette
                .slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE)
                .map((color, i) => {
                    const index = p * PAGE_SIZE + i;
                    return {
                        color,
                        index,
                        ratio: progress[index] ?? 0,
                    };
                }),
        ),
    );

    $effect(() => {
        if (page >= pageCount) page = 0;
    });

    function cancelScrollAnim() {
        restoreSnap();
        if (!scrollRaf) return;
        cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
    }

    function restoreSnap() {
        if (scroller) scroller.style.scrollSnapType = "";
    }

    function easeInOutCubic(x: number) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    function scrollToPage(target: number) {
        if (!scroller) return;
        const child = scroller.children[target] as HTMLElement | undefined;
        if (!child) return;

        cancelScrollAnim();
        page = target;

        const vertical = scroller.scrollHeight > scroller.clientHeight;
        const from = vertical ? scroller.scrollTop : scroller.scrollLeft;
        const to = vertical
            ? target * scroller.clientHeight
            : target * scroller.clientWidth;
        const delta = to - from;
        if (delta === 0) return;

        scroller.style.scrollSnapType = "none";
        const start = performance.now();

        function step(now: number) {
            if (!scroller) return;
            const t = Math.min(1, (now - start) / SCROLL_DURATION);
            const pos = t < 1 ? from + delta * easeInOutCubic(t) : to;
            if (vertical) scroller.scrollTop = pos;
            else scroller.scrollLeft = pos;

            if (t < 1) {
                scrollRaf = requestAnimationFrame(step);
            } else {
                scrollRaf = 0;
            }
        }

        scrollRaf = requestAnimationFrame(step);
    }

    function nextPage() {
        completed = null;
        scrollToPage((page + 1) % pageCount);
    }

    function prevPage() {
        completed = null;
        scrollToPage((page - 1 + pageCount) % pageCount);
    }

    function onScroll() {
        if (!scroller) return;
        const vertical = scroller.scrollHeight > scroller.clientHeight;
        const size = vertical ? scroller.clientHeight : scroller.clientWidth;
        const pos = vertical ? scroller.scrollTop : scroller.scrollLeft;
        if (pos !== lastScrollPos) {
            scrollDir = pos > lastScrollPos ? 1 : -1;
            lastScrollPos = pos;
        }
        if (scrollRaf || size <= 0) return;
        const ratio = pos / size;
        const frac = ratio - Math.floor(ratio);
        let next: number;
        if (frac < 0.05 || frac > 0.95) {
            next = Math.round(ratio);
        } else if (scrollDir > 0) {
            next = Math.ceil(ratio);
        } else if (scrollDir < 0) {
            next = Math.floor(ratio);
        } else {
            next = Math.round(ratio);
        }
        next = Math.max(0, Math.min(pageCount - 1, next));
        if (next !== page) {
            completed = null;
            page = next;
        }
    }

    function onScrollerClick(e: MouseEvent) {
        if (!scroller) return;
        if (e.detail === 0 && e.target instanceof HTMLElement) {
            const idx = Number(e.target.dataset.index);
            if (!Number.isNaN(idx) && idx < palette.length) selected = idx;
            return;
        }
        const rect = scroller.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) return;

        const vertical = scroller.scrollHeight > scroller.clientHeight;
        let slot: number;
        if (vertical) {
            slot = Math.min(
                PAGE_SIZE - 1,
                Math.max(0, Math.floor((y / rect.height) * PAGE_SIZE)),
            );
        } else {
            const col = Math.min(
                4,
                Math.max(0, Math.floor((x / rect.width) * 5)),
            );
            const row = Math.min(
                1,
                Math.max(0, Math.floor((y / rect.height) * 2)),
            );
            slot = row * 5 + col;
        }

        const index = page * PAGE_SIZE + slot;
        if (index < palette.length) selected = index;
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        if (!/^[0-9]$/.test(e.key)) return;
        const index = page * PAGE_SIZE + Number(e.key);
        if (index < palette.length) selected = index;
    }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="palette" role="toolbar" aria-label="Colors"
    title={isDesktop.current ? "You can use number keys (0-9) to select colors" : undefined}
>
    {#if pageCount > 1}
        <button
            class="nav prev"
            aria-label="Previous colors"
            onclick={prevPage}
        >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path
                    d="M15 5l-7 7 7 7"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="square"
                    stroke-linejoin="inherit"
                />
            </svg>
        </button>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        class="swatches-scroller"
        role="region"
        aria-label="Color pages"
        bind:this={scroller}
        onscroll={onScroll}
        onpointerdown={cancelScrollAnim}
        onwheel={cancelScrollAnim}
        onclick={onScrollerClick}
    >
        {#each pages as slots, p (p)}
            <div class="swatches">
                {#each slots as { color, index, ratio } (index)}
                    <button
                        class="swatch"
                        class:selected={selected === index}
                        style:background={`rgb(${color.r} ${color.g} ${color.b})`}
                        style:color={contrastColor(color)}
                        aria-label={`Color ${index}`}
                        aria-pressed={selected === index}
                        data-index={index}
                    >
                        {#if selected === index}
                            <svg
                                class="ring"
                                viewBox="0 0 48 48"
                                aria-hidden="true"
                            >
                                <path
                                    class="fill"
                                    d="M 24 2 H 46 V 46 H 2 V 2 Z"
                                    pathLength="1"
                                    stroke-dasharray="{ratio} 1"
                                />
                            </svg>
                        {/if}
                        {index}
                    </button>
                {/each}
            </div>
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
                    stroke-linecap="square"
                    stroke-linejoin="inherit"
                />
            </svg>
        </button>
    {/if}
</div>

<style>
    .palette {
        position: fixed;
        z-index: 1;
        box-sizing: border-box;
        background: #fff;
        box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
        display: flex;
    }

    .swatches-scroller {
        position: relative;
        flex: 1;
        max-width: 360px;
        display: flex;
        overflow-x: auto;
        overflow-y: hidden;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
    }

    .swatches-scroller::-webkit-scrollbar {
        display: none;
    }

    .swatches {
        flex: 0 0 100%;
        scroll-snap-align: start;
        scroll-snap-stop: always;
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        grid-template-rows: repeat(2, 1fr);
        aspect-ratio: 5 / 2;
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
        position: relative;
        aspect-ratio: 1;
        font-size: 14px;
        font-weight: 600;
        /*box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);*/
    }

    .ring {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
    }

    .ring path {
        fill: none;
        stroke: #888;
        stroke-width: 4;
    }

    .nav {
        flex: none;
        width: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
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
        padding-bottom: env(safe-area-inset-bottom);
        border-radius: 0;
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
            padding-bottom: 0px;
            flex-direction: column;
        }

        .swatches-scroller {
            flex: none;
            flex-direction: column;
            height: calc(48px * 10);
            overflow-x: hidden;
            overflow-y: auto;
            scroll-snap-type: y mandatory;
        }

        .swatches {
            grid-template-columns: 48px;
            grid-template-rows: repeat(10, 48px);
            aspect-ratio: 1 / 10;
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
