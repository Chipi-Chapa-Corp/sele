import type { AppContainerTarget } from '../../shared/app'
import type { ProviderChatItem, ProviderId } from '../../shared/provider'

// Local presentation while the provider creates the real chat. This is never
// registered as a provider chat, persisted, or used for provider requests.
export type StartingChat = {
  scopeKey: string
  providerId: ProviderId
  container: AppContainerTarget | null
  cwd: string | null
  items: ProviderChatItem[]
}
