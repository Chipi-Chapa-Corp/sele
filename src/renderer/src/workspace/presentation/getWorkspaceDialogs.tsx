import { getWorkspaceSettingsPanel } from './getWorkspaceSettingsPanel'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'
import { getContainerTargetKey } from '../../containerSelection'

export function getWorkspaceDialogs({
  preferences,
  settingsPanel,
  settings,
  providerState,
  accountActions,
  projectState,
  sourceState,
  settingsActions,
  sourceControls,
  dialogState,
  changes,
  session,
  benchmark,
  primaryWorktreeChanges,
  secondaryWorktreeChanges,
  files
}: WorkspaceChanges & {
  settingsPanel: ReturnType<typeof getWorkspaceSettingsPanel>
}) {
  const editorTarget = dialogState.fileEditorTarget
  const editorWorktree =
    benchmark.active &&
    editorTarget &&
    getContainerTargetKey(editorTarget.container) === session.changesContainerKey
      ? [primaryWorktreeChanges, secondaryWorktreeChanges].find(
          ({ cwd }) => cwd === editorTarget.cwd
        )
      : undefined

  return {
    settingsCloseButtonRef: preferences.settingsCloseButtonRef,
    settingsOpen: preferences.settingsOpen,
    settingsPanelProps: settingsPanel.settingsPanelProps,
    settingsProjectCwd: settings.settingsProjectCwd,
    settingsProjectLabel: settingsPanel.settingsProjectLabel,
    settingsTab: preferences.settingsTab,
    settingsViewIsProject: settings.settingsViewIsProject,
    setSettingsOpen: preferences.setSettingsOpen,
    setAppearanceZoomLevelInputDraft: preferences.setAppearanceZoomLevelInputDraft,
    setAppearanceFontSizeInputDraft: preferences.setAppearanceFontSizeInputDraft,
    setSettingsScope: preferences.setSettingsScope,
    setSettingsTab: preferences.setSettingsTab,
    accountDialogOpen: providerState.accountDialogOpen,
    reauthenticationTarget: providerState.reauthenticationTarget,
    setReauthenticationTarget: providerState.setReauthenticationTarget,
    handleReauthenticateChatAccount: (signal: AbortSignal) =>
      accountActions.handleCreateProviderAccount(
        signal,
        providerState.reauthenticationTarget ?? undefined
      ),
    setAccountDialogOpen: providerState.setAccountDialogOpen,
    handleCreateProviderAccount: accountActions.handleCreateProviderAccount,
    projectDialogOpen: projectState.projectDialogOpen,
    editingProjectCwd: projectState.editingProjectCwd,
    setEditingProjectCwd: projectState.setEditingProjectCwd,
    newSessionCwd: sourceState.newSessionCwd,
    projects: projectState.projects,
    setProjectDialogOpen: projectState.setProjectDialogOpen,
    handleProjectSaved: settingsActions.handleProjectSaved,
    sshEnvironmentDialogOpen: sourceState.sshEnvironmentDialogOpen,
    editingSshEnvironment: sourceState.editingSshEnvironment,
    setSshEnvironmentDialogOpen: sourceState.setSshEnvironmentDialogOpen,
    setEditingSshEnvironment: sourceState.setEditingSshEnvironment,
    handleSaveSshEnvironment: sourceControls.handleSaveSshEnvironment,
    fileEditorTarget: dialogState.fileEditorTarget,
    fileEditorDiffTargets: editorWorktree?.diffTargets ?? changes.fileEditorDiffTargets,
    reviewCommentsDraft: dialogState.reviewCommentsDraft,
    handleCloseFileEditor: files.handleCloseFileEditor,
    handleContinueReview: files.handleContinueReview,
    handleReviewCommentsChange: files.handleReviewCommentsChange,
    handleSelectFileEditorTarget: files.handleSelectFileEditorTarget
  }
}
