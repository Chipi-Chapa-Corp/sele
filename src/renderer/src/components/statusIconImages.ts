// Static masks rasterize once. Animate their HTML hosts' transform and opacity;
// SVG image timelines repaint their pixels on the renderer thread.
const mask = (content: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`)}")`

// Loader-circle geometry follows Lucide (ISC).
export const spinnerImage = mask('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>')
