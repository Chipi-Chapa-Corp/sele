import { useWorkspaceProviderAccounts } from '../features/useWorkspaceProviderAccounts'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceSourceControls } from '../features/useWorkspaceSourceControls'
import { useWorkspaceDialogState } from '../state/useWorkspaceDialogState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useChangesData } from '../useChangesData'
import { useFileNavigationController } from '../useFileNavigationController'
import { useSettingsController } from '../useSettingsController'
import { getWorkspaceSettingsPanel } from './getWorkspaceSettingsPanel'

type WorkspaceDialogsDependencies = {
  preferences: ReturnType<typeof useWorkspacePreferenceState>
  settingsPanel: ReturnType<typeof getWorkspaceSettingsPanel>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  accountActions: ReturnType<typeof useWorkspaceProviderAccounts>
  projectState: ReturnType<typeof useWorkspaceProjectState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  settingsActions: ReturnType<typeof useSettingsController>
  sourceControls: ReturnType<typeof useWorkspaceSourceControls>
  dialogState: ReturnType<typeof useWorkspaceDialogState>
  changes: ReturnType<typeof useChangesData>
  files: ReturnType<typeof useFileNavigationController>
}

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
}: WorkspaceDialogsDependencies) {
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
