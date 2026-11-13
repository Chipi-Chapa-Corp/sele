import { Monitor, Pencil, Server, X } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import type {
  AppCreateSshEnvironmentOptions,
  AppLocalContainerTarget,
  AppSshEnvironment
} from '../../../../shared/app'
import type { ProviderId } from '../../../../shared/provider'
import { appApi } from '../../appApi'
import type { DropdownOption } from '../../components/Dropdown'
import {
  getContainerSelectionValue,
  getContainerSuggestionState,
  getContainerTargetFromSuggestion,
  getContainerToolIcon,
  hostContainerValue
} from '../../containerSelection'
import { providerOptions } from '../../messageBoxPreferences'
import { getErrorMessage } from '../chatControllerUtils'
import type { WorkspaceSession } from '../useWorkspaceSelection'

export function useWorkspaceSourceControls({ sourceState, providerUpdates }: WorkspaceSession) {
  const { isProviderUpdating } = providerUpdates

  const handleDeleteSshEnvironment = useCallback(
    async (environment: AppSshEnvironment): Promise<void> => {
      if (sourceState.deletingSshEnvironmentId) return

      sourceState.setDeletingSshEnvironmentId(environment.id)
      sourceState.setSshEnvironmentError(null)
      try {
        await appApi.deleteSshEnvironment({ id: environment.id })
        sourceState.setSshEnvironments((currentEnvironments) =>
          currentEnvironments.filter(
            (currentEnvironment) => currentEnvironment.id !== environment.id
          )
        )
        sourceState.setNewSessionContainer((currentContainer) =>
          currentContainer.kind === 'container' &&
          currentContainer.tool === 'ssh' &&
          currentContainer.name === environment.id
            ? { kind: 'host' }
            : currentContainer
        )
      } catch (error) {
        console.error('Unable to remove the SSH environment.', error)
        sourceState.setSshEnvironmentError(getErrorMessage(error, 'Unable to remove environment.'))
      } finally {
        sourceState.setDeletingSshEnvironmentId(null)
      }
    },
    [sourceState.deletingSshEnvironmentId]
  )

  const containerOptions = useMemo<DropdownOption<string>[]>(
    () => [
      {
        value: hostContainerValue,
        label: 'Host',
        icon: <Monitor aria-hidden="true" />
      },
      ...sourceState.sshEnvironments.map((environment) => ({
        value: `ssh:${environment.id}`,
        label: environment.name,
        menuLabel: environment.name,
        description: `${environment.user ? `${environment.user}@` : ''}${environment.host}:${environment.port}`,
        icon: <Server aria-hidden="true" />,
        inlineActions: [
          {
            id: `edit-${environment.id}`,
            ariaLabel: `Edit ${environment.name}`,
            title: `Edit ${environment.name}`,
            icon: <Pencil aria-hidden="true" />,
            callback: () => {
              sourceState.setEditingSshEnvironment(environment)
              sourceState.setSshEnvironmentError(null)
              sourceState.setSshEnvironmentDialogOpen(true)
            }
          },
          {
            id: `remove-${environment.id}`,
            ariaLabel: `Remove ${environment.name}`,
            title: `Remove ${environment.name}`,
            disabled: Boolean(sourceState.deletingSshEnvironmentId),
            icon: <X aria-hidden="true" />,
            callback: () => handleDeleteSshEnvironment(environment)
          }
        ]
      })),
      ...sourceState.containerSuggestions.map((container) => ({
        value: container.id,
        label: container.name,
        menuLabel: `${container.name} · ${getContainerSuggestionState(container)}`,
        icon: getContainerToolIcon(container.tool)
      }))
    ],
    [
      sourceState.containerSuggestions,
      sourceState.deletingSshEnvironmentId,
      handleDeleteSshEnvironment,
      sourceState.sshEnvironments
    ]
  )

  const newSessionRemoteRuntime = useMemo<AppLocalContainerTarget | null>(
    () =>
      sourceState.newSessionContainer.kind === 'container' &&
      sourceState.newSessionContainer.tool === 'ssh'
        ? (sourceState.newSessionContainer.runtime ?? { kind: 'host' })
        : null,
    [sourceState.newSessionContainer]
  )

  const remoteRuntimeOptions = useMemo<DropdownOption<string>[]>(() => {
    const suggestions = [...sourceState.remoteContainerSuggestions]
    if (
      newSessionRemoteRuntime?.kind === 'container' &&
      !suggestions.some(
        (suggestion) =>
          suggestion.tool === newSessionRemoteRuntime.tool &&
          suggestion.name === newSessionRemoteRuntime.name
      )
    ) {
      suggestions.unshift({
        id: `${newSessionRemoteRuntime.tool}:${newSessionRemoteRuntime.name}`,
        tool: newSessionRemoteRuntime.tool,
        name: newSessionRemoteRuntime.name,
        label: newSessionRemoteRuntime.name,
        description: null,
        status: null
      })
    }

    return [
      {
        value: hostContainerValue,
        label: 'Host',
        icon: <Monitor aria-hidden="true" />
      },
      ...suggestions.map((container) => ({
        value: container.id,
        label: container.name,
        menuLabel: `${container.name} · ${getContainerSuggestionState(container)}`,
        icon: getContainerToolIcon(container.tool)
      }))
    ]
  }, [newSessionRemoteRuntime, sourceState.remoteContainerSuggestions])

  const newSessionProviderOptions = useMemo<DropdownOption<ProviderId>[]>(
    () =>
      providerOptions
        .filter((option) =>
          sourceState.newSessionAvailableProviderIds.includes(option.value as ProviderId)
        )
        .map((option) => ({
          ...option,
          label: sourceState.providerRuntimeLabels[option.value as ProviderId],
          disabled: isProviderUpdating(option.value as ProviderId, sourceState.newSessionContainer)
        })),
    [
      sourceState.newSessionAvailableProviderIds,
      sourceState.providerRuntimeLabels,
      isProviderUpdating,
      sourceState.newSessionContainer
    ]
  )

  const newSessionProviderValueContent: 'Checking' | 'No providers found' | undefined =
    !sourceState.newSessionSourceAvailabilityReady
      ? 'Checking'
      : newSessionProviderOptions.length === 0
        ? 'No providers found'
        : undefined

  const newSessionContainerValue = getContainerSelectionValue(sourceState.newSessionContainer)

  const handleNewSessionContainerChange = (value: string): void => {
    if (value === hostContainerValue) {
      sourceState.setNewSessionContainer({ kind: 'host' })
      return
    }

    const environment = sourceState.sshEnvironments.find(
      (candidateEnvironment) => `ssh:${candidateEnvironment.id}` === value
    )
    if (environment) {
      sourceState.setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: environment.id,
        runtime: { kind: 'host' }
      })
      return
    }

    const suggestion = sourceState.containerSuggestions.find((container) => container.id === value)
    if (suggestion) sourceState.setNewSessionContainer(getContainerTargetFromSuggestion(suggestion))
  }

  const handleNewSessionRemoteRuntimeChange = (value: string): void => {
    if (!sourceState.newSessionSshEnvironmentId) return
    if (value === hostContainerValue) {
      sourceState.setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: sourceState.newSessionSshEnvironmentId,
        runtime: { kind: 'host' }
      })
      return
    }

    const suggestion = sourceState.remoteContainerSuggestions.find(
      (container) => container.id === value
    )
    if (!suggestion) return
    sourceState.setNewSessionContainer({
      kind: 'container',
      tool: 'ssh',
      name: sourceState.newSessionSshEnvironmentId,
      runtime: getContainerTargetFromSuggestion(suggestion)
    })
  }

  const handleSaveSshEnvironment = async (
    options: AppCreateSshEnvironmentOptions
  ): Promise<void> => {
    const environment = sourceState.editingSshEnvironment
      ? await appApi.updateSshEnvironment({ id: sourceState.editingSshEnvironment.id, ...options })
      : await appApi.createSshEnvironment(options)
    sourceState.setSshEnvironments((currentEnvironments) => [
      environment,
      ...currentEnvironments.filter(
        (currentEnvironment) => currentEnvironment.id !== environment.id
      )
    ])
    sourceState.setSshEnvironmentError(null)
    if (!sourceState.editingSshEnvironment) {
      sourceState.setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: environment.id,
        runtime: { kind: 'host' }
      })
    }
  }
  return {
    containerOptions,
    newSessionRemoteRuntime,
    remoteRuntimeOptions,
    newSessionProviderOptions,
    newSessionProviderValueContent,
    newSessionContainerValue,
    handleNewSessionContainerChange,
    handleNewSessionRemoteRuntimeChange,
    handleSaveSshEnvironment
  }
}
