import type { ReactElement } from 'react'
import { AccountDialog } from '../../components/AccountDialog'
import { FileEditorDialog } from '../../components/FileEditorDialog'
import { ProjectDialog } from '../../components/ProjectDialog'
import { SettingsDialog } from '../../components/SettingsDialog'
import { SshEnvironmentDialog } from '../../components/SshEnvironmentDialog'
import type { WorkspaceController } from '../../useWorkspaceController'

type AppDialogsProps = WorkspaceController['dialogs']

export function AppDialogs(props: AppDialogsProps): ReactElement {
  const {
    accountDialogOpen,
    editingSshEnvironment,
    fileEditorDiffTargets,
    fileEditorTarget,
    handleCloseFileEditor,
    handleContinueReview,
    handleCreateProviderAccount,
    handleProjectSaved,
    handleReviewCommentsChange,
    handleSaveSshEnvironment,
    handleSelectFileEditorTarget,
    newSessionCwd,
    projectDialogOpen,
    projects,
    reviewCommentsDraft,
    setAccountDialogOpen,
    setAppearanceFontSizeInputDraft,
    setAppearanceZoomLevelInputDraft,
    setEditingSshEnvironment,
    setProjectDialogOpen,
    setSettingsOpen,
    setSettingsScope,
    setSettingsTab,
    setSshEnvironmentDialogOpen,
    settingsCloseButtonRef,
    settingsOpen,
    settingsPanelProps,
    settingsProjectCwd,
    settingsProjectLabel,
    settingsTab,
    settingsViewIsProject,
    sshEnvironmentDialogOpen
  } = props

  return (
    <>
      <SettingsDialog
        closeButtonRef={settingsCloseButtonRef}
        open={settingsOpen}
        panelProps={settingsPanelProps}
        projectCwd={settingsProjectCwd}
        projectLabel={settingsProjectLabel}
        tab={settingsTab}
        viewIsProject={settingsViewIsProject}
        onClose={() => setSettingsOpen(false)}
        onScopeChange={(scope) => {
          setAppearanceZoomLevelInputDraft(null)
          setAppearanceFontSizeInputDraft(null)
          setSettingsScope(scope)
        }}
        onTabChange={setSettingsTab}
      />
      {accountDialogOpen && (
        <AccountDialog
          onClose={() => setAccountDialogOpen(false)}
          onLogin={handleCreateProviderAccount}
        />
      )}
      {projectDialogOpen && (
        <ProjectDialog
          defaultPath={newSessionCwd}
          projects={projects}
          onClose={() => setProjectDialogOpen(false)}
          onSaved={handleProjectSaved}
        />
      )}
      {sshEnvironmentDialogOpen && (
        <SshEnvironmentDialog
          environment={editingSshEnvironment}
          open
          onClose={() => {
            setSshEnvironmentDialogOpen(false)
            setEditingSshEnvironment(null)
          }}
          onSave={handleSaveSshEnvironment}
        />
      )}
      {fileEditorTarget && (
        <FileEditorDialog
          diffTargets={fileEditorDiffTargets}
          initialReviewComments={reviewCommentsDraft}
          target={fileEditorTarget}
          onClose={handleCloseFileEditor}
          onContinueReview={handleContinueReview}
          onReviewCommentsChange={handleReviewCommentsChange}
          onSelectTarget={handleSelectFileEditorTarget}
        />
      )}
    </>
  )
}
