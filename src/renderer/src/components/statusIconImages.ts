// Static masks rasterize once. Animate their HTML hosts' transform and opacity;
// SVG image timelines repaint their pixels on the renderer thread.
const mask = (content: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`)}")`

// Loader-circle and bot geometry follows Lucide (ISC).
export const spinnerImage = mask('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>')
export const workingChatsImage = mask(
  '<path d="M12 6V2H8 M2 12h2 M20 12h2 M9 11v2 M15 11v2 M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>'
)
