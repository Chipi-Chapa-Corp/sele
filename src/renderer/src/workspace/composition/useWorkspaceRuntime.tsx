import { useMemo } from 'react'
import { useWorkspaceAppearance } from '../features/useWorkspaceAppearance'
import { useWorkspaceBrowser } from '../features/useWorkspaceBrowser'
import { useWorkspaceChatCache } from '../features/useWorkspaceChatCache'
import { useWorkspaceChatDiscovery } from '../features/useWorkspaceChatDiscovery'
import { useWorkspaceChatProjection } from '../features/useWorkspaceChatProjection'
import { useWorkspaceChatReadState } from '../features/useWorkspaceChatReadState'
import { useWorkspaceChatUpdates } from '../features/useWorkspaceChatUpdates'
import { useWorkspaceChrome } from '../features/useWorkspaceChrome'
import { useWorkspaceModelCatalogs } from '../features/useWorkspaceModelCatalogs'
import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspacePersistence } from '../features/useWorkspacePersistence'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import { useWorkspaceProviderModes } from '../features/useWorkspaceProviderModes'
import { useWorkspaceProviderSettings } from '../features/useWorkspaceProviderSettings'
import { useWorkspaceResourceRefresh } from '../features/useWorkspaceResourceRefresh'
import { useWorkspaceScroll } from '../features/useWorkspaceScroll'
import { useWorkspaceSelectionPreferences } from '../features/useWorkspaceSelectionPreferences'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceSources } from '../features/useWorkspaceSources'
import { useWorkspaceProviderUpdates } from '../wiring/useWorkspaceProviderUpdates'
import { useWorkspaceState } from './useWorkspaceState'

type WorkspaceRuntimeDependencies = {
  state: ReturnType<typeof useWorkspaceState>
}

export function useWorkspaceRuntime({ state }: WorkspaceRuntimeDependencies) {
  const settings = useWorkspaceSettingsContext({
    chatState: state.chatState,
    sourceState: state.sourceState,
    preferences: state.preferences
  })

  const provider = useWorkspaceProviderContext({
    chatState: state.chatState,
    sourceState: state.sourceState,
    providerState: state.providerState
  })

  const panes = useWorkspacePanes({ settings })

  const projectRecordsByCwd = useMemo(
    () => new Map(state.projectState.projects.map((project) => [project.cwd, project])),
    [state.projectState.projects]
  )

  useWorkspaceSelectionPreferences({
    providerState: state.providerState,
    chatState: state.chatState,
    provider,
    settings,
    projectRecordsByCwd
  })

  const resourceRefresh = useWorkspaceResourceRefresh({
    providerState: state.providerState,
    preferences: state.preferences
  })

  const scroll = useWorkspaceScroll({
    chatState: state.chatState,
    viewportState: state.viewportState
  })

  useWorkspacePersistence({
    chatState: state.chatState,
    sourceState: state.sourceState,
    gitState: state.gitState,
    preferences: state.preferences
  })

  useWorkspaceChatDiscovery({
    chatState: state.chatState,
    searchState: state.searchState,
    sourceState: state.sourceState
  })

  const chatCache = useWorkspaceChatCache({
    settings,
    providerState: state.providerState,
    chatState: state.chatState
  })

  const chrome = useWorkspaceChrome({
    dialogState: state.dialogState,
    settings,
    preferences: state.preferences
  })

  useWorkspaceAppearance({ settings, preferences: state.preferences })

  const browser = useWorkspaceBrowser({ settings, dialogState: state.dialogState, panes })

  useWorkspaceSources({
    sourceState: state.sourceState,
    projectState: state.projectState,
    providerState: state.providerState
  })

  useWorkspaceProviderSettings({
    preferences: state.preferences,
    sourceState: state.sourceState,
    providerState: state.providerState,
    settings
  })

  const providerUpdates = useWorkspaceProviderUpdates({
    sourceState: state.sourceState,
    providerState: state.providerState,
    provider
  })

  useWorkspaceProviderModes({ provider, providerState: state.providerState })

  const catalogs = useWorkspaceModelCatalogs({
    provider,
    providerState: state.providerState,
    chatState: state.chatState,
    preferences: state.preferences,
    sourceState: state.sourceState
  })

  const chatProjection = useWorkspaceChatProjection({
    chatState: state.chatState,
    chatCache,
    searchState: state.searchState,
    sourceState: state.sourceState,
    gitState: state.gitState
  })

  const chatRead = useWorkspaceChatReadState({
    chatCache,
    chatState: state.chatState,
    chatProjection
  })

  useWorkspaceChatUpdates({
    subagentState: state.subagentState,
    chatState: state.chatState,
    viewportState: state.viewportState,
    chatProjection,
    gitState: state.gitState
  })
  return {
    settings,
    provider,
    panes,
    projectRecordsByCwd,
    resourceRefresh,
    scroll,
    chatCache,
    chrome,
    browser,
    providerUpdates,
    catalogs,
    chatProjection,
    chatRead
  }
}
