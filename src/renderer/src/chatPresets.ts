import {
  isProviderAgentMode,
  isProviderApprovalMode,
  isProviderModelId,
  isProviderReasoningEffort,
  isProviderSandboxMode,
  isProviderServiceTier,
  type ProviderId
} from '../../shared/provider.ts'
import type { MessageBoxSelection } from './messageBoxPreferences'
import { selectionsEqual } from './chatModelPreferences.ts'
import { preferences } from './preferences.ts'

const storageKey = (providerId: ProviderId): string => `sele:chat-presets:v1:${providerId}`

export type ChatPresetEditableFields = Record<keyof MessageBoxSelection, boolean>

export const getChatPresetChanges = (
  preset: MessageBoxSelection,
  editable: ChatPresetEditableFields
): Partial<MessageBoxSelection> =>
  Object.fromEntries(
    Object.entries(preset).filter(([key]) => editable[key as keyof MessageBoxSelection])
  )

const parsePreset = (value: unknown): MessageBoxSelection | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const preset = value as Record<string, unknown>
  if (
    !isProviderAgentMode(preset.agentMode) ||
    !isProviderApprovalMode(preset.approvalMode) ||
    !isProviderModelId(preset.model) ||
    !isProviderReasoningEffort(preset.reasoningEffort) ||
    !isProviderSandboxMode(preset.sandboxMode) ||
    (preset.serviceTier !== null && !isProviderServiceTier(preset.serviceTier))
  )
    return null

  return {
    agentMode: preset.agentMode,
    approvalMode: preset.approvalMode,
    model: preset.model,
    reasoningEffort: preset.reasoningEffort,
    sandboxMode: preset.sandboxMode,
    serviceTier: preset.serviceTier
  }
}

export const readChatPresets = (
  providerId: ProviderId,
  storage: Pick<Storage, 'getItem'> = preferences
): MessageBoxSelection[] => {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey(providerId)) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
      const preset = parsePreset(entry)
      return preset ? [preset] : []
    })
  } catch (error) {
    console.error('Unable to read chat presets.', error)
    return []
  }
}

export const saveChatPreset = (
  providerId: ProviderId,
  selection: MessageBoxSelection,
  storage: Pick<Storage, 'getItem' | 'setItem'> = preferences
): MessageBoxSelection[] => {
  const presets = readChatPresets(providerId, storage)
  if (presets.some((preset) => selectionsEqual(preset, selection))) return presets
  const next = [...presets, selection]
  storage.setItem(storageKey(providerId), JSON.stringify(next))
  return next
}

export const updateChatPreset = (
  providerId: ProviderId,
  original: MessageBoxSelection,
  selection: MessageBoxSelection,
  storage: Pick<Storage, 'getItem' | 'setItem'> = preferences
): MessageBoxSelection[] => {
  const presets = readChatPresets(providerId, storage)
  const next = presets
    .map((preset) => (selectionsEqual(preset, original) ? selection : preset))
    .filter(
      (preset, index, all) => !all.slice(0, index).some((other) => selectionsEqual(other, preset))
    )
  storage.setItem(storageKey(providerId), JSON.stringify(next))
  return next
}

export const deleteChatPreset = (
  providerId: ProviderId,
  selection: MessageBoxSelection,
  storage: Pick<Storage, 'getItem' | 'setItem'> = preferences
): MessageBoxSelection[] => {
  const next = readChatPresets(providerId, storage).filter(
    (preset) => !selectionsEqual(preset, selection)
  )
  storage.setItem(storageKey(providerId), JSON.stringify(next))
  return next
}
