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
import { useConversationViewModel } from '../useConversationViewModel'
import { useChatInteractionController } from '../useChatInteractionController'
import { useChatListController } from '../useChatListController'
import { useChatMessagingController } from '../useChatMessagingController'
import { useWorkspaceSelection, type WorkspaceSession } from '../useWorkspaceSelection'
import { useSettingsController } from '../useSettingsController'
import { useWorkspaceRuntime } from './useWorkspaceRuntime'
import { useWorkspaceState } from './useWorkspaceState'

type WorkspaceChatModelDependencies = {
  state: ReturnType<typeof useWorkspaceState>
  runtime: ReturnType<typeof useWorkspaceRuntime>
  session: ReturnType<typeof useWorkspaceSelection>
  onConversationRequested: (() => void) | undefined
  returnToRootChat: () => void
  returnFromSubagentChat: () => void
}

export type WorkspaceChat = WorkspaceSession & ReturnType<typeof useWorkspaceChatModel>

export function useWorkspaceChatModel({
  state,
  runtime,
  session,
  onConversationRequested,
  returnToRootChat,
  returnFromSubagentChat
}: WorkspaceChatModelDependencies) {
  const workspace = { ...state, ...runtime, session }

  const sidebarModel = useWorkspaceSidebarModel(workspace)

  const gitHubPullRequests = useGitHubPullRequests({
    active:
      runtime.panes.changesPaneView === 'git' && runtime.panes.gitPaneView === 'pull-requests',
    cwd: session.changesProjectCwd ?? session.changesCwd,
    container: session.changesContainer
  })

  const projectResources = useWorkspaceProjectResources({ ...workspace, sidebarModel })

  const projectCatalog = useWorkspaceProjectCatalog(workspace)

  const sourceControls = useWorkspaceSourceControls(workspace)

  const accountActions = useWorkspaceProviderAccounts(workspace)

  const resourceActions = useWorkspaceResourceActions(workspace)

  const gitModels = useWorkspaceGitModels(workspace)

  const effectiveSelection = useWorkspaceEffectiveSelection(workspace)

  const settingsOptions = useWorkspaceSettingsOptions(workspace)

  const sidebarActions = useWorkspaceSidebarActions(workspace)

  const navigation = useWorkspaceNavigation({
    ...workspace,
    onConversationRequested,
    handleReturnToRootChat: returnToRootChat,
    handleReturnFromSubagentChat: returnFromSubagentChat
  })

  const chatPreset = useWorkspaceChatPreset({ ...workspace, effectiveSelection })

  const settingsActions = useSettingsController(workspace)

  const chatErrors = useWorkspaceChatErrors({ ...workspace, effectiveSelection })

  const listActions = useChatListController({ ...workspace, sidebarModel })

  const messaging = useChatMessagingController({ ...workspace, chatErrors, effectiveSelection })

  const interactions = useChatInteractionController({
    ...workspace,
    sidebarModel,
    projectCatalog,
    sidebarActions,
    listActions,
    navigation,
    messaging,
    chatErrors
  })

  const conversation = useConversationViewModel({
    ...workspace,
    effectiveSelection,
    chatErrors,
    interactions
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
