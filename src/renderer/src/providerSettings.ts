import { preferences as preferenceStorage } from './preferences.ts'
import type {
  ProviderId,
  ProviderModel,
  ProviderSkill,
  ProviderUpdateAvailability
} from '../../shared/provider'
import {
  isProviderId,
  fallbackClaudeModels,
  fallbackCopilotModels,
  fallbackOpenCodeModels,
  fallbackProviderModels
} from '../../shared/provider'
import type { SettingsProviderSkill } from '../../shared/providerOwnership'

export type ProviderUpdateSuggestion = ProviderUpdateAvailability & {
  providerId: ProviderId
}

export type ProviderUpdatePreference = {
  neverSuggest: boolean
  ignoredVersions: string[]
}

export type ProviderUpdatePreferenceKey = ProviderId
export type ProviderUpdatePreferences = Partial<
  Record<ProviderUpdatePreferenceKey, ProviderUpdatePreference>
>

export const getProviderUpdatePreferenceKey = (
  suggestion: ProviderUpdateSuggestion
): ProviderUpdatePreferenceKey => suggestion.providerId

export const getProviderUpdateKey = (suggestion: ProviderUpdateSuggestion): string =>
  `${getProviderUpdatePreferenceKey(suggestion)}:${suggestion.latestVersion}`

export const expandProviderUpdateSuggestions = (
  providerId: ProviderId,
  availability: ProviderUpdateAvailability | null
): ProviderUpdateSuggestion[] => {
  return isProviderId(providerId) &&
    availability &&
    availability.currentVersion !== availability.latestVersion
    ? [{ ...availability, providerId }]
    : []
}

const providerUpdatePreferenceStorageKey = 'sele:provider-update-preferences:v1'

export const providerLabels = {
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  'opencode-v2': 'OpenCode'
} satisfies Record<ProviderId, string>

const getFirstSentence = (value: string): string => {
  const normalizedValue = value.replace(/\s+/g, ' ').trim()
  if (!normalizedValue) return ''

  return /^.*?[.!?](?=\s|$)/.exec(normalizedValue)?.[0] ?? normalizedValue
}

export const getSettingsSkillDescription = (skill: ProviderSkill): string =>
  skill.shortDescription?.trim() || getFirstSentence(skill.description) || 'No description'

export const mergeSettingsProviderSkills = (
  resources: Array<{ providerId: ProviderId; skills: ProviderSkill[] }>
): SettingsProviderSkill[] => {
  const skillsByPath = new Map<string, SettingsProviderSkill>()

  resources.forEach(({ providerId, skills }) => {
    skills.forEach((skill) => {
      const current = skillsByPath.get(skill.path)
      if (!current) {
        skillsByPath.set(skill.path, { providerId, providerIds: [providerId], skill })
        return
      }

      const providerIds = current.providerIds.includes(providerId)
        ? current.providerIds
        : [...current.providerIds, providerId]
      skillsByPath.set(skill.path, {
        providerId: current.skill.enabled || !skill.enabled ? current.providerId : providerId,
        providerIds,
        skill: current.skill.enabled || !skill.enabled ? current.skill : skill
      })
    })
  })

  return Array.from(skillsByPath.values()).sort((first, second) =>
    first.skill.name.localeCompare(second.skill.name)
  )
}

export const getFallbackModels = (providerId: ProviderId): ProviderModel[] =>
  providerId === 'copilot'
    ? fallbackCopilotModels
    : providerId === 'claude'
      ? fallbackClaudeModels
      : providerId === 'opencode-v2'
        ? fallbackOpenCodeModels
        : fallbackProviderModels

export const getProviderUpdatePreference = (
  preferences: ProviderUpdatePreferences,
  providerId: ProviderUpdatePreferenceKey
): ProviderUpdatePreference => ({
  neverSuggest: Boolean(preferences[providerId]?.neverSuggest),
  ignoredVersions: preferences[providerId]?.ignoredVersions ?? []
})

export const shouldSuggestProviderUpdate = (
  preferences: ProviderUpdatePreferences,
  providerId: ProviderUpdatePreferenceKey,
  availability: ProviderUpdateAvailability
): boolean => {
  const preference = getProviderUpdatePreference(preferences, providerId)
  return (
    !preference.neverSuggest && !preference.ignoredVersions.includes(availability.latestVersion)
  )
}

const isProviderUpdatePreference = (value: unknown): value is ProviderUpdatePreference => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const preference = value as Partial<ProviderUpdatePreference>
  return (
    typeof preference.neverSuggest === 'boolean' &&
    Array.isArray(preference.ignoredVersions) &&
    preference.ignoredVersions.every((version) => typeof version === 'string')
  )
}

export const readStoredProviderUpdatePreferences = (): ProviderUpdatePreferences => {
  try {
    const storedValue = preferenceStorage.getItem(providerUpdatePreferenceStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const preferences: ProviderUpdatePreferences = {}
    for (const providerId of Object.keys(providerLabels) as ProviderUpdatePreferenceKey[]) {
      const preference = parsedValue[providerId]
      if (isProviderUpdatePreference(preference)) preferences[providerId] = preference
    }

    return preferences
  } catch (error) {
    console.error('[caught:providerSettings:readStoredProviderUpdatePreferences]', error)
    return {}
  }
}

export const writeStoredProviderUpdatePreferences = (
  preferences: ProviderUpdatePreferences
): void => {
  try {
    preferenceStorage.setItem(providerUpdatePreferenceStorageKey, JSON.stringify(preferences))
  } catch (error) {
    console.error('[caught:providerSettings:writeStoredProviderUpdatePreferences]', error)
    // Update suggestion preferences are non-critical; ignore unavailable storage.
  }
}
