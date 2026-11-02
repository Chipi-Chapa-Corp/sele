import { CodexDesktopPredictions } from './CodexDesktopPredictions.ts'

export type PredictionNotification = { method: string; params?: unknown }
export type PredictionClient = {
  serverVersion?: string | null
  request<T>(
    method: string,
    params: unknown,
    options?: {
      signal?: AbortSignal
      isExpectedError?: (error: Error) => boolean
      requireConnection?: boolean
    }
  ): Promise<T>
  onNotification(listener: (notification: PredictionNotification) => void): () => void
  onStopped(listener: (error: Error) => void): () => void
}

export const isPredictionOperationUnavailable = (error: unknown): boolean => {
  const value = error as { code?: unknown; message?: unknown } | null
  return (
    value?.code === -32601 ||
    (typeof value?.message === 'string' &&
      /^(?:thread\/prediction\/request is not implemented yet|unknown method|method not found)/i.test(
        value.message
      ))
  )
}

/** The sole provider boundary. Delete the desktop delegate when the native operation ships. */
export class CodexPromptSuggestions {
  private client: PredictionClient
  private nativeUnavailable = false
  private desktop: CodexDesktopPredictions
  private unsubscribeStopped: () => void
  private unsubscribeAccount: () => void
  private pending = new Map<string, object>()
  private disposed = false

  constructor(
    client: PredictionClient,
    publish: (notification: PredictionNotification) => void,
    desktop = new CodexDesktopPredictions(client, publish)
  ) {
    this.client = client
    this.desktop = desktop
    this.unsubscribeStopped = client.onStopped(() => {
      this.nativeUnavailable = false
      this.pending.clear()
      this.desktop.clear()
    })
    this.unsubscribeAccount = client.onNotification(({ method, params }) => {
      if (method === 'account/updated') {
        this.pending.clear()
        this.desktop.clear()
      } else if (method === 'turn/started') {
        const threadId = (params as { threadId?: unknown } | undefined)?.threadId
        if (typeof threadId === 'string') this.cancel(threadId)
      }
    })
  }

  async request(threadId: string, sourceTurnId: string): Promise<void> {
    if (this.disposed) return
    const generation = {}
    this.pending.set(threadId, generation)
    if (!this.nativeUnavailable) {
      try {
        await this.client.request(
          'thread/prediction/request',
          { threadId, sourceTurnId },
          { isExpectedError: isPredictionOperationUnavailable }
        )
        return
      } catch (error) {
        // Auth, quota, network and other native errors must never cause a second inference.
        if (!isPredictionOperationUnavailable(error)) throw error
        if (this.disposed || this.pending.get(threadId) !== generation) return
        this.nativeUnavailable = true
      }
    }
    if (this.disposed || this.pending.get(threadId) !== generation) return
    await this.desktop.request(threadId, sourceTurnId)
  }

  cancel(threadId: string): void {
    this.pending.delete(threadId)
    this.desktop.cancel(threadId)
  }

  isTemporaryThread(threadId: string): boolean {
    return this.desktop.isTemporaryThread(threadId)
  }

  dispose(): void {
    this.disposed = true
    this.pending.clear()
    this.unsubscribeStopped()
    this.unsubscribeAccount()
    this.desktop.dispose()
  }
}
