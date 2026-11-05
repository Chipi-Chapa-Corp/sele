import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { rendererViteConfig } from './vite.renderer'

const config = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@opencode/client'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: rendererViteConfig
})

module.exports = config
