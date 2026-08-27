const defaultRootFontSize = 16
const remPrecision = 1_000_000
let cachedRootFontSize: number | null = null

const getRootFontSize = (): number => {
  if (cachedRootFontSize !== null) return cachedRootFontSize
  if (typeof document === 'undefined') return defaultRootFontSize

  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  cachedRootFontSize =
    Number.isFinite(rootFontSize) && rootFontSize > 0 ? rootFontSize : defaultRootFontSize
  return cachedRootFontSize
}

export const toCssRem = (pixels: number): string =>
  `${Math.round((pixels / getRootFontSize()) * remPrecision) / remPrecision}rem`
