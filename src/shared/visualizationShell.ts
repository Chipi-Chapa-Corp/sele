const cdns =
  'https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net'
export const visualizationCsp = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${cdns}`,
  `style-src 'unsafe-inline' ${cdns}`,
  `img-src data: blob: ${cdns}`,
  `font-src data: ${cdns}`,
  `media-src data: blob: ${cdns}`,
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export const visualizationFramePath = '/sele-visualization.html'

export function createVisualizationShell(assets: {
  stylesheet: string
  utilities: string
  runtime: string
  floatingCore: string
  floatingDom: string
  lucide: string
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${visualizationCsp}">
<style>${assets.stylesheet}\n:root{background:transparent!important}html>body{margin:0;padding:0;background:transparent}#visualization-root{display:flow-root}
html>body{--color-text-secondary:var(--muted-foreground);--color-text-tertiary:color-mix(in oklab,var(--muted-foreground) 72%,transparent);--color-background-secondary:var(--card);--color-background-tertiary:color-mix(in oklab,var(--foreground) 9%,var(--background));--color-border-primary:color-mix(in oklab,var(--foreground) 22%,transparent);--color-border-tertiary:color-mix(in oklab,var(--foreground) 5%,transparent);--color-accent:var(--primary)}</style>
</head><body><div id="visualization-root"></div>
<script>${assets.floatingCore}</script><script>${assets.floatingDom}</script><script>${assets.lucide}</script><script>${assets.runtime}</script>
${assets.utilities.replace('<!--__INLINE_VISUALIZATION_FRAGMENT__-->', '')}
</body></html>`
}
