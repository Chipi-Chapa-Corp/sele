import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export const rendererViteConfig = {
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
    react({
      // These modules also run in a worker without React Refresh or window.
      exclude: [/node_modules/, /\/chatMarkdownRenderer\.tsx$/, /\/components\/SymbolIcons\.tsx$/]
    })
  ]
}
