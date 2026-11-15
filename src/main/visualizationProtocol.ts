import { protocol } from 'electron'
import stylesheet from './visualization/visualize.css?raw'
import utilities from './visualization/visualize.html?raw'
import runtime from './visualization/runtime.js?raw'
import floatingCore from '../../node_modules/@floating-ui/core/dist/floating-ui.core.umd.min.js?raw'
import floatingDom from '../../node_modules/@floating-ui/dom/dist/floating-ui.dom.umd.min.js?raw'
import lucide from '../../node_modules/lucide/dist/umd/lucide.min.js?raw'

import { createVisualizationShell, visualizationCsp } from '../shared/visualizationShell'
export { visualizationCsp } from '../shared/visualizationShell'

// A dedicated protocol gives the frame its own CSP without weakening the app's script policy.
export function registerVisualizationProtocol(): void {
  protocol.handle(
    'sele-visualize',
    () =>
      new Response(
        createVisualizationShell({
          stylesheet,
          utilities,
          runtime,
          floatingCore,
          floatingDom,
          lucide
        }),
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
