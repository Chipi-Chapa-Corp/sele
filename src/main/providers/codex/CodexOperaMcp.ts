import { createBrowserMcpServer, type BrowserMcpIntegration } from '../../browser/BrowserMcpServer'
import { operaAutomation } from '../../desktop/ChromeAutomation'
import type { BrowserAutomationScope } from '../../../shared/browser'
import { getBrowserUseSession, onBrowserUseSessionRemoved } from './CodexBrowserSessions'
import type { ChromePairingStore } from '../../desktop/ChromePairingStore'

/** Resumed Codex threads cannot replace their persisted dynamic-tool catalog.
 * HTTP MCP is a supported resume configuration, including for pre-Opera threads.
 */
export class CodexOperaMcp {
  private endpoints = new Map<
    string,
    { scope: BrowserAutomationScope; server: BrowserMcpIntegration }
  >()
  private unsubscribe: (() => void) | undefined
  private lifecycle = 0
  private closing = new Set<Promise<void>>()

  constructor(
    private readonly readOnly: (threadId: string) => boolean,
    private readonly storeForScope?: (scope: BrowserAutomationScope) => ChromePairingStore
  ) {}

  async restore(scope: BrowserAutomationScope): Promise<boolean> {
    const store = this.storeForScope?.(scope)
    if (!store || !(await store.load())) return false
    await this.config(scope)
    return true
  }

  hasScope(scope: BrowserAutomationScope): boolean {
    const entry = this.endpoints.get(scope.sessionId)
    return entry?.scope.cwd === scope.cwd && entry.scope.containerKey === scope.containerKey
  }

  private revoke = (threadId: string): void => {
    const entry = this.endpoints.get(threadId)
    this.endpoints.delete(threadId)
    entry?.server.suspend()
    if (entry) {
      const closing = entry.server
        .close()
        .catch((error) => console.error('Unable to close Opera MCP.', error))
      this.closing.add(closing)
      void closing.finally(() => this.closing.delete(closing))
    }
  }

  async config(scope: BrowserAutomationScope): Promise<Record<string, unknown>> {
    this.unsubscribe ??= onBrowserUseSessionRemoved(this.revoke)
    let entry = this.endpoints.get(scope.sessionId)
    if (
      entry &&
      (entry.scope.cwd !== scope.cwd || entry.scope.containerKey !== scope.containerKey)
    ) {
      this.revoke(scope.sessionId)
      entry = undefined
    }
    if (!entry) {
      await Promise.all(this.closing)
      const snapshot = { ...scope }
      const lifecycle = this.lifecycle
      const store = this.storeForScope?.(snapshot)
      const binding = await store?.load()
      const server = await createBrowserMcpServer(operaAutomation, snapshot, {
        ...(binding ? { binding } : {}),
        pairedBrowser: 'opera',
        authorizeTool: () => {
          const current = getBrowserUseSession(snapshot.sessionId)
          if (
            this.readOnly(snapshot.sessionId) ||
            current?.cwd !== snapshot.cwd ||
            current?.containerKey !== snapshot.containerKey
          )
            throw new Error('Opera session is unavailable or read-only.')
        }
      })
      const current = getBrowserUseSession(snapshot.sessionId)
      if (
        this.lifecycle !== lifecycle ||
        current?.cwd !== snapshot.cwd ||
        current?.containerKey !== snapshot.containerKey
      ) {
        await server.close()
        throw new Error('Opera session changed during startup.')
      }
      try {
        await store?.save({ port: Number(new URL(server.url).port), token: server.token })
      } catch (error) {
        await server.close()
        throw error
      }
      entry = { scope: snapshot, server }
      this.endpoints.set(scope.sessionId, entry)
    }
    return {
      'mcp_servers.sele_opera': {
        url: entry.server.url,
        http_headers: { Authorization: `Bearer ${entry.server.token}` },
        // This is Sele's user-connected, chat-scoped browser, like the Chrome
        // host tools. Keep unrelated MCP servers and native elicitations unchanged.
        default_tools_approval_mode: 'approve',
        enabled: true
      }
    }
  }

  async close(): Promise<void> {
    this.lifecycle++
    this.unsubscribe?.()
    this.unsubscribe = undefined
    for (const threadId of this.endpoints.keys()) this.revoke(threadId)
    await Promise.all(this.closing)
  }
}
