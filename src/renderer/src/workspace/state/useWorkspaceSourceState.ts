import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  AppContainerSuggestion,
  AppContainerTarget,
  AppSshEnvironment
} from '../../../../shared/app'
import { isNoProjectCwd } from '../../../../shared/noProject'
import type { ProviderId } from '../../../../shared/provider'
import { getContainerTargetKey, readStoredContainerSelection } from '../../containerSelection'
import { getProviderLabels } from '../../providerLabels'
import {
  newSessionNoProjectValue,
  type NewSessionLocation,
  type SourceAvailabilityState,
  type WorktreeCreationState
} from '../controllerTypes'

export function useWorkspaceSourceState() {
  const [containerSuggestions, setContainerSuggestions] = useState<AppContainerSuggestion[]>([])

  const [remoteContainerSuggestions, setRemoteContainerSuggestions] = useState<
    AppContainerSuggestion[]
  >([])

  const [remoteContainerSuggestionsLoading, setRemoteContainerSuggestionsLoading] = useState(false)

  const [remoteContainerSuggestionsError, setRemoteContainerSuggestionsError] = useState<
    string | null
  >(null)

  const [sshEnvironments, setSshEnvironments] = useState<AppSshEnvironment[]>([])

  const [storedChatContainers, setStoredChatContainers] = useState<AppContainerTarget[]>([])

  const [sshEnvironmentDialogOpen, setSshEnvironmentDialogOpen] = useState(false)

  const [editingSshEnvironment, setEditingSshEnvironment] = useState<AppSshEnvironment | null>(null)

  const [deletingSshEnvironmentId, setDeletingSshEnvironmentId] = useState<string | null>(null)

  const [sshEnvironmentError, setSshEnvironmentError] = useState<string | null>(null)

  const [storedContainerSelection] = useState<AppContainerTarget | null>(
    readStoredContainerSelection
  )

  const [containerSelectionReady, setContainerSelectionReady] = useState(false)

  const [newSessionContainer, setNewSessionContainer] = useState<AppContainerTarget>(
    () => storedContainerSelection ?? { kind: 'host' }
  )

  const newSessionSshEnvironmentId =
    newSessionContainer.kind === 'container' && newSessionContainer.tool === 'ssh'
      ? newSessionContainer.name
      : null

  const newSessionContainerKey = getContainerTargetKey(newSessionContainer)

  const newSessionContainerKeyRef = useRef(newSessionContainerKey)

  const [newSessionSourceAvailability, setNewSessionSourceAvailability] =
    useState<SourceAvailabilityState | null>(null)

  const [newChatOpen, setNewChatOpen] = useState(true)

  const [newSessionProjectSelection, setNewSessionProjectSelection] = useState<string | null>(null)

  const newSessionNoProject = newSessionProjectSelection === newSessionNoProjectValue

  const newSessionCwd = newSessionNoProject ? null : newSessionProjectSelection

  const setNewSessionCwd = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (value) => {
      setNewSessionProjectSelection((previous) => {
        const cwd =
          typeof value === 'function'
            ? value(previous === newSessionNoProjectValue ? null : previous)
            : value
        return cwd === null || isNoProjectCwd(cwd) ? newSessionNoProjectValue : cwd
      })
    },
    []
  )

  const initializeNewSessionCwd = useCallback((cwd: string | null): void => {
    setNewSessionProjectSelection((current) =>
      current === null
        ? cwd === null || isNoProjectCwd(cwd)
          ? newSessionNoProjectValue
          : cwd
        : current
    )
  }, [])

  const [newSessionLocation, setNewSessionLocation] = useState<NewSessionLocation>('folder')

  const [worktreeCreationState, setWorktreeCreationState] = useState<WorktreeCreationState>('idle')

  const [newSessionProvider, setNewSessionProvider] = useState<ProviderId>('codex')

  const newSessionAvailableProviderIds = useMemo(
    () =>
      newSessionSourceAvailability?.containerKey === newSessionContainerKey
        ? newSessionSourceAvailability.availability.providers.flatMap((provider) =>
            provider.available ? [provider.providerId] : []
          )
        : [],
    [newSessionContainerKey, newSessionSourceAvailability]
  )

  const providerRuntimeLabels = useMemo(
    () => getProviderLabels(newSessionAvailableProviderIds),
    [newSessionAvailableProviderIds]
  )

  const newSessionProviderAvailable = newSessionAvailableProviderIds.includes(newSessionProvider)

  const newSessionSourceAvailabilityReady =
    newSessionSourceAvailability?.containerKey === newSessionContainerKey

  const worktreeCreationCanceledRef = useRef(false)

  const worktreeBranchGenerationRef = useRef<{
    generationId: string
    providerId: ProviderId
  } | null>(null)

  const containerSelectionReadyRef = useRef(false)
  return {
    containerSuggestions,
    setContainerSuggestions,
    remoteContainerSuggestions,
    setRemoteContainerSuggestions,
    remoteContainerSuggestionsLoading,
    setRemoteContainerSuggestionsLoading,
    remoteContainerSuggestionsError,
    setRemoteContainerSuggestionsError,
    sshEnvironments,
    setSshEnvironments,
    storedChatContainers,
    setStoredChatContainers,
    sshEnvironmentDialogOpen,
    setSshEnvironmentDialogOpen,
    editingSshEnvironment,
    setEditingSshEnvironment,
    deletingSshEnvironmentId,
    setDeletingSshEnvironmentId,
    sshEnvironmentError,
    setSshEnvironmentError,
    storedContainerSelection,
    containerSelectionReady,
    setContainerSelectionReady,
    newSessionContainer,
    setNewSessionContainer,
    newSessionSshEnvironmentId,
    newSessionContainerKey,
    newSessionContainerKeyRef,
    setNewSessionSourceAvailability,
    newChatOpen,
    setNewChatOpen,
    setNewSessionProjectSelection,
    newSessionNoProject,
    newSessionCwd,
    setNewSessionCwd,
    initializeNewSessionCwd,
    newSessionLocation,
    setNewSessionLocation,
    worktreeCreationState,
    setWorktreeCreationState,
    newSessionProvider,
    setNewSessionProvider,
    newSessionAvailableProviderIds,
    providerRuntimeLabels,
    newSessionProviderAvailable,
    newSessionSourceAvailabilityReady,
    worktreeCreationCanceledRef,
    worktreeBranchGenerationRef,
    containerSelectionReadyRef
  }
}
