import { useEffect, useRef, useState } from 'react'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderId, ProviderUpdateAvailability } from '../../shared/provider'
import { isProviderId } from '../../shared/provider'
import { getContainerTargetKey, normalizeContainerTarget } from './containerSelection'
import { providerApi } from './providerApi'
import { getProviderLabels } from './providerLabels'
import {
  expandProviderUpdateSuggestions,
  getProviderUpdateKey,
  getProviderUpdatePreference,
  getProviderUpdatePreferenceKey,
  readStoredProviderUpdatePreferences,
  shouldSuggestProviderUpdate,
  writeStoredProviderUpdatePreferences,
  type ProviderUpdatePreference,
  type ProviderUpdateSuggestion
} from './providerSettings'

export function useProviderUpdates({
  providerIds,
  container: selectedContainer,
  onUpdated
}: {
  providerIds: readonly ProviderId[]
  container: AppContainerTarget
  onUpdated: (
    result: ProviderUpdateAvailability | null,
    container: AppContainerTarget
  ) => void | Promise<void>
}) {
  const providerLabels = getProviderLabels(providerIds)
  const [snapshot, setSnapshot] = useState<{
    sourceKey: string
    items: ProviderUpdateSuggestion[]
  }>({ sourceKey: '', items: [] })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [preferences, setPreferences] = useState(readStoredProviderUpdatePreferences)
  const [revision, setRevision] = useState(0)
  const skipped = useRef(new Set<string>())
  const updating = useRef(false)
  const onUpdatedRef = useRef(onUpdated)
  onUpdatedRef.current = onUpdated
  const containerKey = getContainerTargetKey(selectedContainer)
  const containerJson = JSON.stringify(normalizeContainerTarget(selectedContainer))
  // Stable across provider selection and unrelated availability refreshes.
  // Source availability and retained development state can still contain removed IDs.
  const providersKey = providerIds.filter(isProviderId).join(',')

  useEffect(() => {
    writeStoredProviderUpdatePreferences(preferences)
  }, [preferences])

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly refreshes after an update
  useEffect(() => {
    let active = true
    let checking = false
    const container = normalizeContainerTarget(JSON.parse(containerJson) as AppContainerTarget)
    const providers = providersKey ? (providersKey.split(',') as ProviderId[]) : []
    const check = async (): Promise<void> => {
      if (checking || updating.current) return
      checking = true
      const results = await Promise.allSettled(
        providers.map(async (providerId) => {
          const availability = await providerApi.getUpdateAvailability(providerId, { container })
          return expandProviderUpdateSuggestions(providerId, availability).filter((suggestion) =>
            shouldSuggestProviderUpdate(
              preferences,
              getProviderUpdatePreferenceKey(suggestion),
              suggestion
            )
          )
        })
      )
      checking = false
      if (!active || updating.current) return
      const next: ProviderUpdateSuggestion[] = []
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Unable to check ${providers[index]} update availability.`, result.reason)
          return
        }
        next.push(
          ...result.value.filter(
            (suggestion) =>
              !skipped.current.has(`${containerKey}:${getProviderUpdateKey(suggestion)}`)
          )
        )
      })
      setSnapshot({ sourceKey: containerKey, items: next })
    }
    setSnapshot((current) =>
      current.sourceKey === containerKey
        ? { ...current, items: current.items.filter((item) => providers.includes(item.providerId)) }
        : { sourceKey: containerKey, items: [] }
    )
    void check()
    const timer = window.setInterval(() => void check(), 5 * 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [containerKey, containerJson, providersKey, preferences, revision])

  const skip = (suggestion: ProviderUpdateSuggestion): void => {
    const key = getProviderUpdateKey(suggestion)
    skipped.current.add(`${containerKey}:${key}`)
    setSnapshot((current) =>
      current.sourceKey === containerKey
        ? { ...current, items: current.items.filter((item) => getProviderUpdateKey(item) !== key) }
        : current
    )
    setErrors((current) => {
      const next = { ...current }
      delete next[`${containerKey}:${key}`]
      return next
    })
  }
  const changePreference = (
    suggestion: ProviderUpdateSuggestion,
    update: (current: ProviderUpdatePreference) => ProviderUpdatePreference
  ): void => {
    setPreferences((current) => ({
      ...current,
      [getProviderUpdatePreferenceKey(suggestion)]: update(
        getProviderUpdatePreference(current, getProviderUpdatePreferenceKey(suggestion))
      )
    }))
    skip(suggestion)
  }
  const update = async (suggestion: ProviderUpdateSuggestion): Promise<void> => {
    if (updating.current) return
    updating.current = true
    const key = getProviderUpdateKey(suggestion)
    const scopedKey = `${containerKey}:${key}`
    setUpdatingKey(scopedKey)
    setErrors((current) => ({ ...current, [scopedKey]: '' }))
    try {
      const container = normalizeContainerTarget(selectedContainer)
      const { activeChatCount } = await providerApi.getProviderUpdateImpact(suggestion.providerId, {
        container
      })
      if (
        activeChatCount > 0 &&
        !window.confirm(
          `${providerLabels[suggestion.providerId]} has ${activeChatCount} active ${activeChatCount === 1 ? 'chat' : 'chats'}. Updating will stop ${activeChatCount === 1 ? 'it' : 'them'}. Continue?`
        )
      )
        return
      const result = await providerApi.updateProvider(suggestion.providerId, {
        container,
        stopActiveChats: activeChatCount > 0
      })
      await onUpdatedRef.current(result, container)
      if (!result || result.currentVersion === result.latestVersion) skip(suggestion)
    } catch (error) {
      console.error('Unable to update provider.', error)
      setErrors((current) => ({
        ...current,
        [scopedKey]:
          error instanceof Error
            ? error.message
            : `Unable to update ${providerLabels[suggestion.providerId]}.`
      }))
    } finally {
      updating.current = false
      setUpdatingKey(null)
      setRevision((current) => current + 1)
    }
  }

  return {
    providerUpdateSuggestions:
      snapshot.sourceKey === containerKey
        ? snapshot.items.filter(
            (item) => isProviderId(item.providerId) && providerIds.includes(item.providerId)
          )
        : [],
    providerUpdateErrors: Object.fromEntries(
      Object.entries(errors)
        .filter(([key]) => key.startsWith(`${containerKey}:`))
        .map(([key, error]) => [key.slice(containerKey.length + 1), error])
    ),
    updatingProviderUpdateKey: updatingKey?.startsWith(`${containerKey}:`)
      ? updatingKey.slice(containerKey.length + 1)
      : null,
    providerUpdateInProgress: updatingKey !== null,
    handleSkipProviderUpdate: skip,
    handleNeverSuggestProviderUpdate: (suggestion: ProviderUpdateSuggestion) =>
      changePreference(suggestion, (current) => ({ ...current, neverSuggest: true })),
    handleNeverSuggestProviderUpdateVersion: (suggestion: ProviderUpdateSuggestion) =>
      changePreference(suggestion, (current) => ({
        ...current,
        ignoredVersions: [...new Set([...current.ignoredVersions, suggestion.latestVersion])]
      })),
    handleUpdateProvider: update
  }
}
