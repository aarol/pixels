import type { Rgb } from './quantize'

/** Black or white, whichever is more readable on top of `color`. */
export function contrastColor({ r, g, b }: Rgb): '#000' | '#fff' {
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000' : '#fff'
}
