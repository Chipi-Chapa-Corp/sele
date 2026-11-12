import { useEffect } from 'react'
import { normalizeContainerTarget } from '../../containerSelection'
import { providerApi } from '../../providerApi'
import { mergeSettingsProviderSkills } from '../../providerSettings'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'

type WorkspaceProviderSettingsDependencies = {
  preferences: ReturnType<typeof useWorkspacePreferenceState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
}

export function useWorkspaceProviderSettings({
  preferences,
  sourceState,
  providerState,
  settings
}: WorkspaceProviderSettingsDependencies) {
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) providerState.setAccountDialogOpen(false)
    })
    return () => {
      active = false
    }
  }, [sourceState.newSessionContainerKey, sourceState.newSessionProvider])

  useEffect(() => {
    if (!preferences.settingsOpen || preferences.settingsTab !== 'providers') return

    let active = true
    if (!sourceState.newSessionSourceAvailabilityReady) {
      queueMicrotask(() => {
        if (!active) return
        providerState.setSettingsProviderSkills([])
        providerState.setSettingsProviderApps([])
        providerState.setProviderResourcesError(null)
        providerState.setProviderResourcesLoadState('loading')
      })
      return () => {
        active = false
      }
    }

    if (sourceState.newSessionAvailableProviderIds.length === 0) {
      queueMicrotask(() => {
        if (!active) return
        providerState.setSettingsProviderSkills([])
        providerState.setSettingsProviderApps([])
        providerState.setProviderResourcesError('No providers are available in this environment.')
        providerState.setProviderResourcesLoadState('ready')
      })
      return () => {
        active = false
      }
    }

    if (!sourceState.newSessionProviderAvailable) {
      queueMicrotask(() => {
        if (!active) return
        providerState.setSettingsProviderSkills([])
        providerState.setSettingsProviderApps([])
        providerState.setProviderResourcesError(null)
        providerState.setProviderResourcesLoadState('loading')
      })
      return () => {
        active = false
      }
    }

    const providerId = sourceState.newSessionProvider
    const container = normalizeContainerTarget(sourceState.newSessionContainer)
    queueMicrotask(() => {
      if (!active) return
      providerState.setSettingsProviderSkills([])
      providerState.setSettingsProviderApps([])
      providerState.setProviderResourcesError(null)
      providerState.setProviderResourcesLoadState('loading')
    })

    void Promise.allSettled([
      providerApi.getSkills(providerId, settings.settingsProjectCwd, { container }),
      providerApi.getApps(providerId, { container })
    ]).then(([skills, apps]) => {
      if (skills.status === 'rejected') {
        console.error(`Unable to load ${providerId} skills.`, skills.reason)
      }
      if (apps.status === 'rejected') {
        console.error(`Unable to load ${providerId} apps.`, apps.reason)
      }
      if (!active) return

      providerState.setSettingsProviderSkills(
        mergeSettingsProviderSkills([
          {
            providerId,
            skills: skills.status === 'fulfilled' ? skills.value : []
          }
        ])
      )
      providerState.setSettingsProviderApps(
        (apps.status === 'fulfilled' ? apps.value : [])
          .map((app) => ({ providerId, app }))
          .sort((first, second) => first.app.name.localeCompare(second.app.name))
      )
      providerState.setProviderResourcesError(
        skills.status === 'rejected' && apps.status === 'rejected'
          ? 'Unable to inspect provider resources in this environment.'
          : null
      )
      providerState.setProviderResourcesLoadState('ready')
    })

    return () => {
      active = false
    }
  }, [
    sourceState.newSessionAvailableProviderIds,
    sourceState.newSessionContainer,
    sourceState.newSessionContainerKey,
    sourceState.newSessionProvider,
    sourceState.newSessionProviderAvailable,
    sourceState.newSessionSourceAvailabilityReady,
    providerState.providerResourcesRefresh,
    preferences.settingsOpen,
    settings.settingsProjectCwd,
    preferences.settingsTab
  ])
  return {}
}
