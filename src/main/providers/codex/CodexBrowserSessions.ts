import { supportsLocalHostTools } from '../hostToolTarget'
import type { AppContainerTarget } from '../../../shared/app'
import type { BrowserAutomationScope } from '../../../shared/browser'
import { getContainerTargetKey } from '../../containerTarget'

const sessions = new Map<string, { owner: object; scope: BrowserAutomationScope }>()
const removedListeners = new Set<(sessionId: string) => void>()

export function onBrowserUseSessionRemoved(listener: (sessionId: string) => void): () => void {
  removedListeners.add(listener)
  return () => {
    removedListeners.delete(listener)
  }
}

export function registerBrowserUseSession(
  owner: object,
  sessionId: string,
  cwd: string | null,
  container: AppContainerTarget | null
): void {
  // Remote providers need a forwarded transport, not access to an unrelated local browser.
  const existing = sessions.get(sessionId)
  if (!supportsLocalHostTools(container)) {
    if (existing) {
      sessions.delete(sessionId)
      for (const listener of removedListeners) listener(sessionId)
    }
    return
  }
  const scope: BrowserAutomationScope = {
    providerId: 'codex',
    sessionId,
    cwd: cwd ?? '',
    containerKey: getContainerTargetKey(container)
  }
  if (
    existing &&
    (existing.owner !== owner ||
      existing.scope.cwd !== scope.cwd ||
      existing.scope.containerKey !== scope.containerKey)
  )
    for (const listener of removedListeners) listener(sessionId)
  sessions.set(sessionId, { owner, scope })
}

export function getBrowserUseSession(sessionId: string): BrowserAutomationScope | undefined {
  return sessions.get(sessionId)?.scope
}

export function removeBrowserUseSession(owner: object, sessionId: string): void {
  if (sessions.get(sessionId)?.owner !== owner) return
  sessions.delete(sessionId)
  for (const listener of removedListeners) listener(sessionId)
}

export function removeBrowserUseSessions(owner: object): void {
  for (const id of sessions.keys()) removeBrowserUseSession(owner, id)
}
