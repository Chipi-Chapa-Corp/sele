import { protocol } from 'electron'
import stylesheet from './visualization/visualize.css?raw'
import utilities from './visualization/visualize.html?raw'
import runtime from './visualization/runtime.js?raw'
import floatingCore from '../../node_modules/@floating-ui/core/dist/floating-ui.core.umd.min.js?raw'
import floatingDom from '../../node_modules/@floating-ui/dom/dist/floating-ui.dom.umd.min.js?raw'
import lucide from '../../node_modules/lucide/dist/umd/lucide.min.js?raw'

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

// A dedicated protocol gives the frame its own CSP without weakening the app's script policy.
export function registerVisualizationProtocol(): void {
  protocol.handle(
    'sele-visualize',
    () =>
      new Response(
        `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<style>${stylesheet}\n:root{background:transparent!important}html>body{margin:0;padding:0;background:transparent}#visualization-root{display:flow-root}</style>
</head><body><div id="visualization-root"></div>
<script>${floatingCore}</script><script>${floatingDom}</script><script>${lucide}</script><script>${runtime}</script>
${utilities.replace('<!--__INLINE_VISUALIZATION_FRAGMENT__-->', '')}
</body></html>`,
        {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': visualizationCsp,
            'Cache-Control': 'no-store'
          }
        }
      )
  )
}
