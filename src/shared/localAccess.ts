import type { RemoteBrowserRequest, RemoteBrowserState } from './remoteBrowser'

export type LocalAccessState = {
  enabled: boolean
  port: number
  urls: string[]
  error: string | null
  computerName?: string
  devices?: LocalAccessDevice[]
  pairingRequests?: LocalAccessPairingRequest[]
  discoveryError?: string | null
}

export type LocalAccessDevice = { id: string; name: string; pairedAt: number }
export type LocalAccessPairingRequest = { id: string; name: string; expiresAt: number }

export type LocalAccessOptions = { enabled: boolean; port: number; resetToken?: boolean }
export type LocalAccessApi = {
  getState(): Promise<LocalAccessState>
  configure(options: LocalAccessOptions): Promise<LocalAccessState>
  decidePairing(id: string, approve: boolean): Promise<LocalAccessState>
  revokeDevice(id: string): Promise<LocalAccessState>
  remoteBrowser(request: RemoteBrowserRequest): Promise<RemoteBrowserState | null>
}

export const localAccessChannels = {
  getState: 'local-access:get-state',
  configure: 'local-access:configure',
  uploadAttachments: 'local-access:upload-attachments',
  readDiagnosticLog: 'local-access:read-diagnostic-log',
  remoteBrowser: 'local-access:remote-browser',
  browseHostDirectory: 'local-access:browse-host-directory',
  decidePairing: 'local-access:decide-pairing',
  revokeDevice: 'local-access:revoke-device'
} as const

export const localAccessDefaultPort = 4589
export const localAccessProtocolVersion = 1
export const localAccessAndroidOrigin = 'http://sele.localhost'

// Electron's structured clone supports ArrayBuffer; JSON does not. Keep media
// payloads portable without turning arbitrary objects into executable values.
export const encodeClientMessage = (value: unknown): string =>
  JSON.stringify(value, (_key, entry) => {
    if (!(entry instanceof ArrayBuffer)) return entry
    const bytes = new Uint8Array(entry)
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    }
    return { $seleBuffer: btoa(binary) }
  })

export const decodeClientMessage = (text: string): Record<string, unknown> => {
  const message: unknown = JSON.parse(text, (_key, value) => {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).length === 1 &&
      typeof value.$seleBuffer === 'string'
    ) {
      const binary = atob(value.$seleBuffer)
      return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
    }
    return value
  })

  if (!message || typeof message !== 'object' || Array.isArray(message))
    throw new Error('Invalid client message.')
  return message as Record<string, unknown>
}
