import type {
  ProviderId,
  ProviderModel,
  ProviderSkill,
  ProviderUpdateAvailability
} from '../../shared/provider'
import {
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

export type ProviderUpdatePreferences = Partial<Record<ProviderId, ProviderUpdatePreference>>

const providerUpdatePreferenceStorageKey = 'sele:provider-update-preferences:v1'

export const providerLabels = {
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  opencode: 'OpenCode'
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
      : providerId === 'opencode'
        ? fallbackOpenCodeModels
        : fallbackProviderModels

export const getProviderUpdatePreference = (
  preferences: ProviderUpdatePreferences,
  providerId: ProviderId
): ProviderUpdatePreference => ({
  neverSuggest: Boolean(preferences[providerId]?.neverSuggest),
  ignoredVersions: preferences[providerId]?.ignoredVersions ?? []
})

export const shouldSuggestProviderUpdate = (
  preferences: ProviderUpdatePreferences,
  providerId: ProviderId,
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
    const storedValue = window.localStorage.getItem(providerUpdatePreferenceStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const preferences: ProviderUpdatePreferences = {}
    for (const providerId of Object.keys(providerLabels) as ProviderId[]) {
      const preference = parsedValue[providerId]
      if (isProviderUpdatePreference(preference)) preferences[providerId] = preference
    }

    return preferences
  } catch {
    return {}
  }
}

export const writeStoredProviderUpdatePreferences = (
  preferences: ProviderUpdatePreferences
): void => {
  try {
    window.localStorage.setItem(providerUpdatePreferenceStorageKey, JSON.stringify(preferences))
  } catch {
    // Update suggestion preferences are non-critical; ignore unavailable storage.
  }
}
