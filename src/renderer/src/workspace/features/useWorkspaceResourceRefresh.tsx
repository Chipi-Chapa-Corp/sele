import { useCallback, useEffect, useLayoutEffect } from 'react'
import { getContainerTargetKey } from '../../containerSelection'
import { providerApi } from '../../providerApi'
import { type DeferredProviderResourceRefresh } from '../controllerTypes'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'

type WorkspaceResourceRefreshDependencies = {
  providerState: ReturnType<typeof useWorkspaceProviderState>
  preferences: ReturnType<typeof useWorkspacePreferenceState>
}

export function useWorkspaceResourceRefresh({
  providerState,
  preferences
}: WorkspaceResourceRefreshDependencies) {
  const flushDeferredProviderResourceRefreshes = useCallback(async (): Promise<void> => {
    if (providerState.deferredProviderResourceRefreshRunningRef.current) return
    providerState.deferredProviderResourceRefreshRunningRef.current = true

    try {
      while (providerState.deferredProviderResourceRefreshesRef.current.size > 0) {
        const refreshes = Array.from(
          providerState.deferredProviderResourceRefreshesRef.current.values()
        )
        providerState.deferredProviderResourceRefreshesRef.current.clear()
        await Promise.all(
          refreshes.map(async ({ providerId, cwd, container }) => {
            const results = await Promise.allSettled([
              providerApi.getSkills(providerId, cwd, { container, forceRefresh: true }),
              providerApi.getApps(providerId, { container, forceRefresh: true })
            ])
            results.forEach((result) => {
              if (result.status === 'rejected') {
                console.error(`Unable to refresh ${providerId} resources.`, result.reason)
              }
            })
          })
        )
        providerState.setProviderResourcesRevision((revision) => revision + 1)
        providerState.setProviderResourcesRefresh((refresh) => refresh + 1)
      }
    } finally {
      providerState.deferredProviderResourceRefreshRunningRef.current = false
    }
  }, [])

  const queueDeferredProviderResourceRefresh = useCallback(
    ({ providerId, cwd, container }: DeferredProviderResourceRefresh): void => {
      const key = `${providerId}:${cwd ?? ''}:${getContainerTargetKey(container)}`
      providerState.deferredProviderResourceRefreshesRef.current.set(key, {
        providerId,
        cwd,
        container
      })
      if (!preferences.settingsOpenRef.current) void flushDeferredProviderResourceRefreshes()
    },
    [flushDeferredProviderResourceRefreshes]
  )

  useLayoutEffect(() => {
    preferences.settingsOpenRef.current = preferences.settingsOpen
    if (!preferences.settingsOpen) void flushDeferredProviderResourceRefreshes()
  }, [flushDeferredProviderResourceRefreshes, preferences.settingsOpen])

  useEffect(() => {
    if (!preferences.settingsOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      preferences.setSettingsOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    queueMicrotask(() => preferences.settingsCloseButtonRef.current?.focus({ preventScroll: true }))

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [preferences.settingsOpen])
  return { queueDeferredProviderResourceRefresh }
}
