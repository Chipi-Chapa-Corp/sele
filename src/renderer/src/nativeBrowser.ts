import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
export type NativeBrowserState = {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: string | null
}
export const nativeBrowser = registerPlugin<{
  open(options: { id: string; url: string }): Promise<void>
  viewport(options: {
    id: string
    url: string
    x: number
    y: number
    width: number
    height: number
    viewportWidth: number
    visible: boolean
    radius: number
  }): Promise<void>
  action(options: {
    id: string
    action: 'back' | 'forward' | 'reload' | 'close' | 'external'
  }): Promise<void>
  hide(): Promise<void>
  dispose(): Promise<void>
  addListener(event:'urlOpened',listener:(event:{id:string;url:string})=>void):Promise<PluginListenerHandle>
  addListener(
    event: 'stateChanged',
    listener: (state: NativeBrowserState) => void
  ): Promise<PluginListenerHandle>
}>('MobileBrowser')
