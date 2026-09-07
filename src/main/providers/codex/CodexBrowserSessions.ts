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
  if (container?.kind === 'container' && container.tool === 'ssh') return
  const existing = sessions.get(sessionId)
  if (
    existing &&
    (existing.owner !== owner ||
      existing.scope.cwd !== (cwd ?? '') ||
      existing.scope.containerKey !== getContainerTargetKey(container))
  ) {
    for (const listener of removedListeners) listener(sessionId)
  }
  sessions.set(sessionId, {
    owner,
    scope: {
      providerId: 'codex',
      sessionId,
      cwd: cwd ?? '',
      containerKey: getContainerTargetKey(container)
    }
  })
}

export function getBrowserUseSession(sessionId: string): BrowserAutomationScope | undefined {
  return sessions.get(sessionId)?.scope
}

export function removeBrowserUseSessions(owner: object): void {
  for (const [id, session] of sessions) {
    if (session.owner !== owner) continue
    sessions.delete(id)
    for (const listener of removedListeners) listener(id)
  }
}
