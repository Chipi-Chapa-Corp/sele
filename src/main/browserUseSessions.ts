import type { AppContainerTarget } from '../shared/app'
import type { BrowserAutomationScope } from '../shared/browser'
import { getContainerTargetKey } from './containerTarget'

const sessions = new Map<string, { owner: object; scope: BrowserAutomationScope }>()

export function registerBrowserUseSession(
  owner: object,
  sessionId: string,
  cwd: string | null,
  container: AppContainerTarget | null
): void {
  // Remote providers need a forwarded transport, not access to an unrelated local browser.
  if (container?.kind === 'container' && container.tool === 'ssh') return
  sessions.set(sessionId, {
    owner,
    scope: { sessionId, cwd: cwd ?? '', containerKey: getContainerTargetKey(container) }
  })
}

export function getBrowserUseSession(sessionId: string): BrowserAutomationScope | undefined {
  return sessions.get(sessionId)?.scope
}

export function removeBrowserUseSessions(owner: object): void {
  for (const [id, session] of sessions) if (session.owner === owner) sessions.delete(id)
}
