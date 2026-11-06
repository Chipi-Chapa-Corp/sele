import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { hookRefresh } from './vite.hook-refresh'
import { animatedIcons } from './vite.animated-icons'
import { staticIcons } from './vite.static-icons'

export const rendererViteConfig = {
  server: { warmup: { clientFiles: [resolve('src/renderer/src/bootstrap.tsx')] } },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      // Use the table decoder in both the renderer and Markdown worker.
      'decode-named-character-reference': resolve(
        'node_modules/decode-named-character-reference/index.js'
      )
    }
  },
  plugins: [
    animatedIcons(),
    staticIcons(),
    react({
      // These modules also run in a worker without React Refresh or window.
      exclude: [
        /node_modules/,
        /\/\.vite\//,
        /\/chatMarkdownRenderer\.tsx$/,
        /\/components\/SymbolIcons\.tsx$/
      ]
    }),
    hookRefresh()
  ]
}
