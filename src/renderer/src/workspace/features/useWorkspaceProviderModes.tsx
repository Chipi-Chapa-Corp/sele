import { startTransition, useEffect } from 'react'
import {
  fallbackProviderApprovalModes,
  fallbackProviderSandboxModes
} from '../../../../shared/provider'
import { normalizeContainerTarget } from '../../containerSelection'
import { providerApi } from '../../providerApi'
import { getDefaultApprovalMode, getDefaultSandboxMode } from '../appearanceControllerUtils'
import { fallbackDefaultApprovalMode, fallbackDefaultSandboxMode } from '../controllerTypes'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceProviderContext } from './useWorkspaceProviderContext'

type WorkspaceProviderModesDependencies = {
  provider: ReturnType<typeof useWorkspaceProviderContext>
  providerState: ReturnType<typeof useWorkspaceProviderState>
}

export function useWorkspaceProviderModes({
  provider,
  providerState
}: WorkspaceProviderModesDependencies) {
  useEffect(() => {
    let active = true

    if (provider.configProviderId !== 'copilot' || !provider.configProviderModelsReady) {
      queueMicrotask(() => {
        startTransition(() => {
          if (!active) return
          providerState.setAgentModes((current) => (current.length ? [] : current))
          providerState.setAgentModesLoading(false)
        })
      })

      return () => {
        active = false
      }
    }

    const container = normalizeContainerTarget(provider.configProviderContainerRef.current)
    queueMicrotask(() => {
      startTransition(() => {
        if (!active) return
        providerState.setAgentModes((current) => (current.length ? [] : current))
        providerState.setAgentModesLoading(true)
      })
    })

    providerApi
      .getAgentModes(provider.configProviderId, { container })
      .then((nextAgentModes) => {
        startTransition(() => {
          if (!active) return
          providerState.setAgentModes(nextAgentModes)
          providerState.setAgentModesLoading(false)
        })
      })
      .catch((error: unknown) => {
        startTransition(() => {
          console.error('Unable to load provider agent modes.', error)
          if (!active) return
          providerState.setAgentModes((current) => (current.length ? [] : current))
          providerState.setAgentModesLoading(false)
        })
      })

    return () => {
      active = false
    }
  }, [
    provider.configProviderContainerKey,
    provider.configProviderId,
    provider.configProviderModelsReady,
    providerState.providerModelsRevision
  ])

  useEffect(() => {
    if (providerState.agentModesLoading || providerState.agentModes.length === 0) return

    let active = true
    queueMicrotask(() => {
      startTransition(() => {
        if (!active) return
        providerState.setAgentMode((currentMode) => {
          if (providerState.agentModes.some((mode) => mode.id === currentMode)) return currentMode
          return (
            providerState.agentModes.find((mode) => mode.isDefault)?.id ??
            providerState.agentModes[0]!.id
          )
        })
      })
    })

    return () => {
      active = false
    }
  }, [providerState.agentModes, providerState.agentModesLoading])

  useEffect(() => {
    let active = true

    providerApi
      .getApprovalModes(provider.configProviderId)
      .then((nextApprovalModes) => {
        startTransition(() => {
          if (!active || nextApprovalModes.length === 0) return

          providerState.setApprovalModes(nextApprovalModes)
        })
      })
      .catch((error: unknown) => {
        startTransition(() => {
          console.error('Unable to load provider approval modes.', error)
          if (active) providerState.setApprovalModes(fallbackProviderApprovalModes)
        })
      })

    return () => {
      active = false
    }
  }, [provider.configProviderId])

  useEffect(() => {
    if (providerState.approvalModes.length === 0) return

    const defaultApprovalMode = getDefaultApprovalMode(providerState.approvalModes)

    providerState.setApprovalMode((currentApprovalMode) => {
      const currentApprovalModeExists = providerState.approvalModes.some(
        (mode) => mode.id === currentApprovalMode
      )

      if (!currentApprovalModeExists) return defaultApprovalMode
      if (
        !providerState.approvalModeManuallySelectedRef.current &&
        currentApprovalMode === fallbackDefaultApprovalMode
      ) {
        return defaultApprovalMode
      }

      return currentApprovalMode
    })
  }, [providerState.approvalModes])

  useEffect(() => {
    let active = true

    providerApi
      .getSandboxModes(provider.configProviderId)
      .then((nextSandboxModes) => {
        startTransition(() => {
          if (!active || nextSandboxModes.length === 0) return

          providerState.setSandboxModes(nextSandboxModes)
        })
      })
      .catch((error: unknown) => {
        startTransition(() => {
          console.error('Unable to load provider sandbox modes.', error)
          if (active) providerState.setSandboxModes(fallbackProviderSandboxModes)
        })
      })

    return () => {
      active = false
    }
  }, [provider.configProviderId])

  useEffect(() => {
    if (providerState.sandboxModes.length === 0) return

    const defaultSandboxMode = getDefaultSandboxMode(providerState.sandboxModes)

    providerState.setSandboxMode((currentSandboxMode) => {
      const currentSandboxModeExists = providerState.sandboxModes.some(
        (mode) => mode.id === currentSandboxMode
      )

      if (!currentSandboxModeExists) return defaultSandboxMode
      if (
        !providerState.sandboxModeManuallySelectedRef.current &&
        currentSandboxMode === fallbackDefaultSandboxMode
      ) {
        return defaultSandboxMode
      }

      return currentSandboxMode
    })
  }, [providerState.sandboxModes])
  return {}
}
