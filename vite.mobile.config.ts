import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { rendererViteConfig } from './vite.renderer'

const config = defineConfig({
  ...rendererViteConfig,
  root: resolve('src/renderer'),
  base: './',
  define: { 'import.meta.env.VITE_SELE_ANDROID': JSON.stringify('true') },
  plugins: [
    ...rendererViteConfig.plugins,
    {
      name: 'sele-android-deferred-file-icons',
      enforce: 'pre',
      resolveId(source, importer) {
        // Markdown renders icons synchronously in a worker. React trees can
        // defer the catalog without delaying their first frame.
        if (
          source.endsWith('/SymbolIcons') &&
          importer &&
          !importer.endsWith('/chatMarkdownRenderer.tsx')
        )
          return resolve('src/renderer/src/components/SymbolIcons.mobile.tsx')
        return null
      }
    },
    {
      name: 'sele-android-document',
      transformIndexHtml: (html) =>
        html.replace(
          'frame-src sele-visualize: sele-mcp-app:;',
          "frame-src 'none'; connect-src 'self' ws: wss:;"
        )
    }
  ],
  build: { outDir: resolve('out/mobile'), emptyOutDir: true }
})

module.exports = config
