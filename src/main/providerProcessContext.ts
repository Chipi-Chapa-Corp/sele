import { AsyncLocalStorage } from 'node:async_hooks'
import type { AppContainerTarget } from '../shared/app'
import type { ProviderProcessScope } from './ProviderProcessStore.ts'

export const providerProcessContext = new AsyncLocalStorage<ProviderProcessScope>()

/** Seed native adapter routing before an operation without source options, such as a fork. */
export const getInitialProviderContainers = (): [
  string,
  Extract<AppContainerTarget, { kind: 'container' }> | null
][] => {
  const scope = providerProcessContext.getStore()
  const id = scope?.record.chatId ?? scope?.sourceChatId
  if (!scope || !id) return []
  const container = scope.record.container
  return [[id, container?.kind === 'container' ? container : null]]
}
