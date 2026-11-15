import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import {
  createVisualizationShell,
  visualizationCsp,
  visualizationFramePath
} from './src/shared/visualizationShell'

/** Serve the same opaque sandbox on LAN and in the packaged Android WebView. */
export const visualizationFrame = (): Plugin => {
  const sources = {
    stylesheet: 'src/main/visualization/visualize.css',
    utilities: 'src/main/visualization/visualize.html',
    runtime: 'src/main/visualization/runtime.js',
    floatingCore: 'node_modules/@floating-ui/core/dist/floating-ui.core.umd.min.js',
    floatingDom: 'node_modules/@floating-ui/dom/dist/floating-ui.dom.umd.min.js',
    lucide: 'node_modules/lucide/dist/umd/lucide.min.js'
  }
  const shell = (): string =>
    createVisualizationShell(
      Object.fromEntries(
        Object.entries(sources).map(([key, path]) => [key, readFileSync(resolve(path), 'utf8')])
      ) as Record<keyof typeof sources, string>
    )
  return {
    name: 'sele-visualization-frame',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== visualizationFramePath) return next()
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.setHeader('Content-Security-Policy', visualizationCsp)
        response.end(shell())
      })
    },
    generateBundle() {
      for (const path of Object.values(sources)) this.addWatchFile(resolve(path))
      this.emitFile({ type: 'asset', fileName: visualizationFramePath.slice(1), source: shell() })
    }
  }
}
