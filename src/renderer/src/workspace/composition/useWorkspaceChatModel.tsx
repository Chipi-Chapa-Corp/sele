import { useWorkspaceChatErrors } from '../features/useWorkspaceChatErrors'
import { useWorkspaceChatPreset } from '../features/useWorkspaceChatPreset'
import { useWorkspaceEffectiveSelection } from '../features/useWorkspaceEffectiveSelection'
import { useWorkspaceGitModels } from '../features/useWorkspaceGitModels'
import { useWorkspaceNavigation } from '../features/useWorkspaceNavigation'
import { useWorkspaceProjectCatalog } from '../features/useWorkspaceProjectCatalog'
import { useWorkspaceProjectResources } from '../features/useWorkspaceProjectResources'
import { useWorkspaceProviderAccounts } from '../features/useWorkspaceProviderAccounts'
import { useWorkspaceResourceActions } from '../features/useWorkspaceResourceActions'
import { useWorkspaceSettingsOptions } from '../features/useWorkspaceSettingsOptions'
import { useWorkspaceSidebarActions } from '../features/useWorkspaceSidebarActions'
import { useWorkspaceSidebarModel } from '../features/useWorkspaceSidebarModel'
import { useWorkspaceSourceControls } from '../features/useWorkspaceSourceControls'
import { useGitHubPullRequests } from '../useGitHubPullRequests'
import { useWorkspaceChatListActions } from '../wiring/useWorkspaceChatListActions'
import { useWorkspaceConversation } from '../wiring/useWorkspaceConversation'
import { useWorkspaceInteractions } from '../wiring/useWorkspaceInteractions'
import { useWorkspaceMessaging } from '../wiring/useWorkspaceMessaging'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'
import { useWorkspaceSettingsActions } from '../wiring/useWorkspaceSettingsActions'
import { useWorkspaceRuntime } from './useWorkspaceRuntime'
import { useWorkspaceState } from './useWorkspaceState'

type WorkspaceChatModelDependencies = {
  state: ReturnType<typeof useWorkspaceState>
  runtime: ReturnType<typeof useWorkspaceRuntime>
  session: ReturnType<typeof useWorkspaceSession>
  onConversationRequested: (() => void) | undefined
  returnToRootChat: () => void
  returnFromSubagentChat: () => void
}

export function useWorkspaceChatModel({
  state,
  runtime,
  session,
  onConversationRequested,
  returnToRootChat,
  returnFromSubagentChat
}: WorkspaceChatModelDependencies) {
  const sidebarModel = useWorkspaceSidebarModel({
    searchState: state.searchState,
    sourceState: state.sourceState,
    chatState: state.chatState,
    chatRead: runtime.chatRead,
    subagentState: state.subagentState,
    projectState: state.projectState,
    projectRecordsByCwd: runtime.projectRecordsByCwd,
    session
  })

  const gitHubPullRequests = useGitHubPullRequests({
    active:
      runtime.panes.changesPaneView === 'git' && runtime.panes.gitPaneView === 'pull-requests',
    cwd: session.changesProjectCwd ?? session.changesCwd,
    container: session.changesContainer
  })

  const projectResources = useWorkspaceProjectResources({
    chatState: state.chatState,
    session,
    sourceState: state.sourceState,
    sidebarModel,
    projectState: state.projectState
  })

  const projectCatalog = useWorkspaceProjectCatalog({
    chatState: state.chatState,
    projectState: state.projectState,
    sourceState: state.sourceState
  })

  const sourceControls = useWorkspaceSourceControls({
    sourceState: state.sourceState,
    providerUpdates: runtime.providerUpdates
  })

  const accountActions = useWorkspaceProviderAccounts({
    sourceState: state.sourceState,
    providerState: state.providerState,
    chatState: state.chatState,
    session
  })

  const resourceActions = useWorkspaceResourceActions({
    providerState: state.providerState,
    sourceState: state.sourceState,
    settings: runtime.settings,
    resourceRefresh: runtime.resourceRefresh
  })

  const gitModels = useWorkspaceGitModels({
    provider: runtime.provider,
    providerState: state.providerState,
    settings: runtime.settings,
    sourceState: state.sourceState
  })

  const effectiveSelection = useWorkspaceEffectiveSelection({
    provider: runtime.provider,
    settings: runtime.settings,
    providerState: state.providerState,
    catalogs: runtime.catalogs
  })

  const settingsOptions = useWorkspaceSettingsOptions({
    settings: runtime.settings,
    providerState: state.providerState,
    provider: runtime.provider
  })

  const sidebarActions = useWorkspaceSidebarActions({ projectState: state.projectState })

  const navigation = useWorkspaceNavigation({
    onConversationRequested: onConversationRequested,
    chatState: state.chatState,
    handleReturnToRootChat: returnToRootChat,
    chatCache: runtime.chatCache,
    searchState: state.searchState,
    gitState: state.gitState,
    subagentState: state.subagentState,
    sourceState: state.sourceState,
    chatRead: runtime.chatRead,
    handleReturnFromSubagentChat: returnFromSubagentChat,
    chatProjection: runtime.chatProjection,
    viewportState: state.viewportState,
    session
  })

  const chatPreset = useWorkspaceChatPreset({
    providerState: state.providerState,
    provider: runtime.provider,
    effectiveSelection
  })

  const settingsActions = useWorkspaceSettingsActions({
    preferences: state.preferences,
    settings: runtime.settings,
    chatCache: runtime.chatCache,
    chatState: state.chatState,
    sourceState: state.sourceState,
    projectState: state.projectState,
    providerState: state.providerState,
    provider: runtime.provider
  })

  const chatErrors = useWorkspaceChatErrors({
    chatState: state.chatState,
    sourceState: state.sourceState,
    effectiveSelection: effectiveSelection,
    providerState: state.providerState,
    preferences: state.preferences,
    provider: runtime.provider,
    session
  })

  const listActions = useWorkspaceChatListActions({
    chatRead: runtime.chatRead,
    chatCache: runtime.chatCache,
    chatState: state.chatState,
    chatProjection: runtime.chatProjection,
    sourceState: state.sourceState,
    projectState: state.projectState,
    sidebarModel
  })

  const messaging = useWorkspaceMessaging({
    chatErrors,
    providerState: state.providerState,
    chatState: state.chatState,
    session,
    provider: runtime.provider,
    projectRecordsByCwd: runtime.projectRecordsByCwd,
    effectiveSelection,
    settings: runtime.settings,
    sourceState: state.sourceState,
    providerUpdates: runtime.providerUpdates,
    subagentState: state.subagentState,
    viewportState: state.viewportState,
    chatRead: runtime.chatRead,
    chatProjection: runtime.chatProjection,
    gitState: state.gitState
  })

  const interactions = useWorkspaceInteractions({
    viewportState: state.viewportState,
    chatState: state.chatState,
    scroll: runtime.scroll,
    sidebarModel,
    projectState: state.projectState,
    settings: runtime.settings,
    projectRecordsByCwd: runtime.projectRecordsByCwd,
    projectCatalog,
    session,
    sidebarActions,
    listActions,
    navigation,
    messaging,
    chatRead: runtime.chatRead,
    chatErrors
  })

  const conversation = useWorkspaceConversation({
    provider: runtime.provider,
    effectiveSelection,
    chatErrors,
    chatState: state.chatState,
    sourceState: state.sourceState,
    providerUpdates: runtime.providerUpdates,
    session,
    interactions,
    settings: runtime.settings,
    panes: runtime.panes,
    viewportState: state.viewportState,
    scroll: runtime.scroll,
    chatRead: runtime.chatRead,
    gitState: state.gitState
  })
  return {
    sidebarModel,
    gitHubPullRequests,
    projectResources,
    projectCatalog,
    sourceControls,
    accountActions,
    resourceActions,
    gitModels,
    effectiveSelection,
    settingsOptions,
    sidebarActions,
    navigation,
    chatPreset,
    settingsActions,
    chatErrors,
    listActions,
    messaging,
    interactions,
    conversation
  }
}
