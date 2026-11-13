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
import type { WorkspaceState } from './useWorkspaceState'

export type WorkspaceRuntime = WorkspaceState & ReturnType<typeof useWorkspaceRuntime>

export function useWorkspaceRuntime({ state }: { state: WorkspaceState }) {
  const settings = useWorkspaceSettingsContext(state)

  const provider = useWorkspaceProviderContext(state)

  const panes = useWorkspacePanes({ settings })

  const projectRecordsByCwd = useMemo(
    () => new Map(state.projectState.projects.map((project) => [project.cwd, project])),
    [state.projectState.projects]
  )

  useWorkspaceSelectionPreferences({ ...state, provider, settings, projectRecordsByCwd })

  const resourceRefresh = useWorkspaceResourceRefresh(state)

  const scroll = useWorkspaceScroll(state)

  useWorkspacePersistence(state)

  useWorkspaceChatDiscovery(state)

  const chatCache = useWorkspaceChatCache({ ...state, settings })

  const chrome = useWorkspaceChrome({ ...state, settings })

  useWorkspaceAppearance({ ...state, settings })

  const browser = useWorkspaceBrowser({ ...state, settings, panes })

  useWorkspaceSources(state)

  useWorkspaceProviderSettings({ ...state, settings })

  const providerUpdates = useWorkspaceProviderUpdates({ ...state, provider })

  useWorkspaceProviderModes({ ...state, provider })

  const catalogs = useWorkspaceModelCatalogs({ ...state, provider })

  const chatProjection = useWorkspaceChatProjection({ ...state, chatCache })

  const chatRead = useWorkspaceChatReadState({ ...state, chatCache, chatProjection })

  useWorkspaceChatUpdates({ ...state, chatProjection })
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
