import type { BrowserRendererApi } from '../../shared/browser'

type BrowserWindow = Window & {
  browserApi: BrowserRendererApi
}

export const browserApi = (window as unknown as BrowserWindow).browserApi
