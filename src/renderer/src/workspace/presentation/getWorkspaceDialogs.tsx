import { getWorkspaceSettingsPanel } from './getWorkspaceSettingsPanel'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

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
  files
}: WorkspaceChanges & {
  settingsPanel: ReturnType<typeof getWorkspaceSettingsPanel>
}) {
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
    handleReauthenticateChatAccount: () =>
      accountActions.handleCreateProviderAccount(providerState.reauthenticationTarget ?? undefined),
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
    fileEditorDiffTargets: changes.fileEditorDiffTargets,
    reviewCommentsDraft: dialogState.reviewCommentsDraft,
    handleCloseFileEditor: files.handleCloseFileEditor,
    handleContinueReview: files.handleContinueReview,
    handleReviewCommentsChange: files.handleReviewCommentsChange,
    handleSelectFileEditorTarget: files.handleSelectFileEditorTarget
  }
}
