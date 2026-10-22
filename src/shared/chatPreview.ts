import type { ProviderChatDetail } from './provider'
import type { AppContainerTarget } from './app'

export const chatPreviewSourceKey = (target?: AppContainerTarget | null): string => {
  if (!target || target.kind === 'host') return 'host'
  const runtime = target.tool === 'ssh' ? target.runtime : null
  return JSON.stringify([
    target.tool,
    target.name,
    runtime?.kind === 'container' ? [runtime.tool, runtime.name] : null
  ])
}

// A readable snapshot must never grant stale provider permissions or compete
// with the next authoritative revision (which can restart at zero).
export const asChatPreview = (detail: ProviderChatDetail): ProviderChatDetail => ({
  ...detail,
  revision: -1,
  historyPreview: true,
  writeAccess: 'checking',
  writeAccessReason: undefined,
  capabilities: { editMessages: false, activeMessages: false },
  pendingApproval: null,
  pendingUserInput: null
})
