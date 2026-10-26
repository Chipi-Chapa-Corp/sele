import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const config = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@opencode-ai/sdk'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // Refractor's entity decoder selects a DOM implementation under the browser
        // condition. Its equivalent table implementation also works inside our worker.
        'decode-named-character-reference': resolve(
          'node_modules/decode-named-character-reference/index.js'
        )
      }
    },
    plugins: [
      react({
        // These TSX modules also run in the Markdown worker. React Refresh's
        // development runtime requires window and crashes before the worker starts.
        exclude: [/node_modules/, /\/chatMarkdownRenderer\.tsx$/, /\/components\/SymbolIcons\.tsx$/]
      })
    ]
  }
})

module.exports = config
