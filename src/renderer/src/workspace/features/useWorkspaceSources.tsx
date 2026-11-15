import { startTransition, useEffect } from 'react'
import type { AppContainerSuggestion, AppContainerTarget } from '../../../../shared/app'
import { providerIds } from '../../../../shared/provider'
import { appApi } from '../../appApi'
import {
  getContainerTargetFromSuggestion,
  getContainerTargetKey,
  isContainerTargetAvailable,
  normalizeContainerTarget,
  writeStoredContainerSelection
} from '../../containerSelection'
import { providerApi } from '../../providerApi'
import { getErrorMessage, mergeProjects } from '../chatControllerUtils'
import type { WorkspaceState } from '../composition/useWorkspaceState'

export function useWorkspaceSources({ sourceState, projectState, providerState }: WorkspaceState) {
  // Asynchronous catalogs can settle while a large chat is visible. Let input
  // and the next animation frame interrupt the resulting workspace render.
  useEffect(() => {
    if (!sourceState.containerSelectionReady) return

    writeStoredContainerSelection(sourceState.newSessionContainer)
  }, [sourceState.containerSelectionReady, sourceState.newSessionContainer])

  useEffect(() => {
    let active = true

    Promise.all([
      appApi.getContainerSuggestions().catch((error: unknown) => {
        console.error('Unable to load container suggestions.', error)
        return [] satisfies AppContainerSuggestion[]
      }),
      appApi.getSshEnvironments(),
      providerApi.getChatContainers().catch((error: unknown) => {
        console.error('Unable to load containers referenced by chats.', error)
        return [] satisfies AppContainerTarget[]
      })
    ])
      .then(([suggestions, environments, chatContainers]) => {
        startTransition(() => {
          if (!active) return

          const currentSuggestion = suggestions.find((suggestion) => suggestion.current)
          const currentSource = currentSuggestion
            ? getContainerTargetFromSuggestion(currentSuggestion)
            : ({ kind: 'host' } satisfies AppContainerTarget)
          const initialContainer = sourceState.containerSelectionReadyRef.current
            ? null
            : (sourceState.storedContainerSelection ?? currentSource)

          sourceState.setContainerSuggestions(suggestions)
          sourceState.setSshEnvironments(environments)
          sourceState.setStoredChatContainers(chatContainers)
          sourceState.setNewSessionContainer((currentContainer) => {
            if (initialContainer) {
              return isContainerTargetAvailable(initialContainer, suggestions, environments)
                ? initialContainer
                : currentSource
            }

            return isContainerTargetAvailable(currentContainer, suggestions, environments)
              ? currentContainer
              : currentSource
          })
          sourceState.containerSelectionReadyRef.current = true
          sourceState.setContainerSelectionReady(true)
        })
      })
      .catch((error: unknown) => {
        startTransition(() => {
          console.error('Unable to initialize available environments.', error)
          if (!active) return

          sourceState.setContainerSuggestions([])
          sourceState.setSshEnvironments([])
          sourceState.setStoredChatContainers([])
          if (!sourceState.containerSelectionReadyRef.current) {
            sourceState.setNewSessionContainer(
              sourceState.storedContainerSelection ?? { kind: 'host' }
            )
          } else {
            sourceState.setNewSessionContainer({ kind: 'host' })
          }
          sourceState.containerSelectionReadyRef.current = true
          sourceState.setContainerSelectionReady(true)
        })
      })

    return () => {
      active = false
    }
  }, [sourceState.storedContainerSelection])

  useEffect(() => {
    let active = true
    const environmentId = sourceState.newSessionSshEnvironmentId

    if (!environmentId) {
      queueMicrotask(() => {
        startTransition(() => {
          if (!active) return
          sourceState.setRemoteContainerSuggestions((current) => (current.length ? [] : current))
          sourceState.setRemoteContainerSuggestionsLoading(false)
          sourceState.setRemoteContainerSuggestionsError(null)
        })
      })
      return () => {
        active = false
      }
    }

    const remoteEnvironment = {
      kind: 'container',
      tool: 'ssh',
      name: environmentId,
      runtime: { kind: 'host' }
    } satisfies AppContainerTarget

    queueMicrotask(() => {
      startTransition(() => {
        if (!active) return
        sourceState.setRemoteContainerSuggestions((current) => (current.length ? [] : current))
        sourceState.setRemoteContainerSuggestionsLoading(true)
        sourceState.setRemoteContainerSuggestionsError(null)
      })
    })

    appApi
      .getContainerSuggestions({ container: remoteEnvironment })
      .then((suggestions) => {
        startTransition(() => {
          if (!active) return

          sourceState.setRemoteContainerSuggestions(suggestions)
          sourceState.setRemoteContainerSuggestionsError(null)
          sourceState.setNewSessionContainer((currentContainer) => {
            if (
              currentContainer.kind !== 'container' ||
              currentContainer.tool !== 'ssh' ||
              currentContainer.name !== environmentId ||
              currentContainer.runtime?.kind !== 'container'
            ) {
              return currentContainer
            }

            const runtime = currentContainer.runtime
            return suggestions.some(
              (suggestion) => suggestion.tool === runtime.tool && suggestion.name === runtime.name
            )
              ? currentContainer
              : { ...currentContainer, runtime: { kind: 'host' } }
          })
        })
      })
      .catch((error) => {
        startTransition(() => {
          console.error('Unable to check containers over SSH.', error)
          if (!active) return
          sourceState.setRemoteContainerSuggestions((current) => (current.length ? [] : current))
          sourceState.setRemoteContainerSuggestionsError(
            getErrorMessage(error, 'Unable to check containers over SSH.')
          )
        })
      })
      .finally(() => {
        startTransition(() => {
          if (active) sourceState.setRemoteContainerSuggestionsLoading(false)
        })
      })

    return () => {
      active = false
    }
  }, [sourceState.newSessionSshEnvironmentId])

  useEffect(() => {
    let active = true
    const container = normalizeContainerTarget(sourceState.newSessionContainer)
    const containerKey = getContainerTargetKey(container)

    queueMicrotask(() => {
      startTransition(() => {
        if (!active) return
        sourceState.setNewSessionSourceAvailability((currentAvailability) =>
          currentAvailability?.containerKey === containerKey ? currentAvailability : null
        )
      })
    })

    appApi
      .getSourceAvailability({ container })
      .then((availability) => {
        startTransition(() => {
          if (!active) return

          sourceState.setNewSessionSourceAvailability({ containerKey, availability, error: null })
        })
      })
      .catch((error) => {
        startTransition(() => {
          console.error('Unable to check source availability.', error)
          if (!active) return

          sourceState.setNewSessionSourceAvailability({
            containerKey,
            availability: {
              gitAvailable: false,
              providers: providerIds.map((providerId) => ({ providerId, available: false }))
            },
            error: getErrorMessage(error, 'Unable to check source availability.')
          })
        })
      })

    return () => {
      active = false
    }
  }, [sourceState.newSessionContainer, sourceState.newSessionContainerKey])

  useEffect(() => {
    if (
      sourceState.newSessionAvailableProviderIds.length === 0 ||
      sourceState.newSessionProviderAvailable
    )
      return

    let active = true
    queueMicrotask(() => {
      startTransition(() => {
        if (active)
          sourceState.setNewSessionProvider(sourceState.newSessionAvailableProviderIds[0]!)
      })
    })

    return () => {
      active = false
    }
  }, [sourceState.newSessionAvailableProviderIds, sourceState.newSessionProviderAvailable])

  useEffect(() => {
    let active = true

    const refresh = (): void => {
      void Promise.all([
        appApi.getProjects(),
        appApi.getDeletedProjectCwds(),
        appApi.getSshEnvironments()
      ])
        .then(([storedProjects, deletedCwds, environments]) => {
          startTransition(() => {
            if (!active) return
            projectState.setProjects(mergeProjects(storedProjects))
            projectState.setDeletedProjectCwds(new Set(deletedCwds))
            sourceState.setSshEnvironments(environments)
          })
        })
        .catch((error: unknown) => console.error('Unable to load projects.', error))
    }
    refresh()
    const unsubscribe = appApi.onWorkspaceUpdated(() => {
      startTransition(() => {
        refresh()
        projectState.setProjectIconsByGroup({})
        projectState.setCwdNotesByGroup({})
        providerState.setProviderAccountsRefresh((value) => value + 1)
        providerState.setProviderResourcesRefresh((value) => value + 1)
        providerState.setProviderResourcesRevision((value) => value + 1)
        providerState.setProviderModelsRevision((value) => value + 1)
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return {}
}
