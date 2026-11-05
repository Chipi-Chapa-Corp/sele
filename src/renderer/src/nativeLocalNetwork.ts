import { registerPlugin } from '@capacitor/core'

export type NearbyComputer = { id: string; name: string; origin: string }
// Register once: all native capabilities share the same Capacitor plugin proxy.
export const localNetwork = registerPlugin<{
  startDiscovery(): Promise<void>
  stopDiscovery(): Promise<void>
  getServices(): Promise<{ services: NearbyComputer[]; error?: string }>
  deviceInfo(): Promise<{ id: string; name: string }>
  showKeyboard(): Promise<void>
  consumeKeyboardBack(): Promise<{ consumed: boolean }>
  setSystemBars(options: { color: string; dark: boolean; dimmed: boolean }): Promise<void>
  readStorage(): Promise<{ values: Record<string, string> }>
  writeStorage(value: { key: string; value: string | null }): Promise<void>
  saveFile(file: { name: string; type: string; data: string }): Promise<{ path: string | null }>
}>('LocalNetwork')
