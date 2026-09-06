import type { ProviderId } from '../../shared/provider'
import type { MessageBoxSelection, StoredMessageBoxSelection } from './messageBoxPreferences'

export const selectChatPreferences = (
  chats: Record<string, StoredMessageBoxSelection>,
  defaults: Partial<Record<ProviderId, StoredMessageBoxSelection>>,
  providerId: ProviderId,
  chatKey: string | null,
  draftSelection?: MessageBoxSelection
): StoredMessageBoxSelection =>
  (chatKey ? chats[chatKey] : undefined) ?? draftSelection ?? defaults[providerId] ?? {}

export const updateChatPreferences = (
  chats: Record<string, StoredMessageBoxSelection>,
  chatKey: string | null,
  selection: MessageBoxSelection,
  existingChatKeys: string[]
): Record<string, StoredMessageBoxSelection> => {
  const next = { ...chats }
  if (chatKey) next[chatKey] = selection
  for (const key of existingChatKeys) next[key] = selection
  return next
}

export const selectionsEqual = (
  left: MessageBoxSelection | null,
  right: MessageBoxSelection
): boolean =>
  left !== null &&
  left.agentMode === right.agentMode &&
  left.approvalMode === right.approvalMode &&
  left.model === right.model &&
  left.reasoningEffort === right.reasoningEffort &&
  left.sandboxMode === right.sandboxMode &&
  left.serviceTier === right.serviceTier
