import type { AppContainerTarget } from '../../shared/app'
import type { ProviderChatMetadata, ProviderId } from '../../shared/provider'
import type { ProviderAdapter } from './ProviderAdapter'

type Dependencies = {
  adapters: Record<ProviderId, Pick<ProviderAdapter, 'stopChatProcesses'>>
  metadata: (chatId: string) => Promise<ProviderChatMetadata>
  stopTerminals: (chatIds: string[]) => Promise<void>
  killProcesses: (chatIds: string[], container: AppContainerTarget | null) => Promise<void>
}

/** Stop a chat's owned work in each saved execution environment. */
export const createChatProcessCleanup =
  (dependencies: Dependencies) =>
  async (chatIds: string[], providerId?: ProviderId): Promise<void> => {
    const failures: unknown[] = []
    const targets = new Map<string, Set<string>>()
    const containers = new Map<string, AppContainerTarget | null>()
    for (const chatId of new Set(chatIds)) {
      const { container } = await dependencies.metadata(chatId)
      const key = JSON.stringify(container)
      const ids = targets.get(key) ?? new Set<string>()
      ids.add(chatId)
      targets.set(key, ids)
      containers.set(key, container)
      const adapters = providerId
        ? [dependencies.adapters[providerId]]
        : Object.values(dependencies.adapters)
      for (const adapter of adapters) {
        try {
          for (const id of (await adapter.stopChatProcesses?.(chatId, { container })) ?? [])
            ids.add(id)
        } catch (error) {
          failures.push(error)
        }
      }
    }
    for (const [key, ids] of targets) {
      try {
        await dependencies.stopTerminals([...ids])
      } catch (error) {
        failures.push(error)
      }
      try {
        await dependencies.killProcesses([...ids], containers.get(key)!)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Unable to stop all chat processes.')
  }
