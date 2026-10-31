import { AnimatePresence } from 'motion/react'
import { lazy, Suspense, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../components/Button'
import { PopupWindow } from '../../components/PopupWindow'
import '../../components/FileEditorDialog.css'
import { AccountDialog } from '../../components/AccountDialog'
import { ProjectDialog } from '../../components/ProjectDialog'
import { SettingsDialog } from '../../components/SettingsDialog'
import { SshEnvironmentDialog } from '../../components/SshEnvironmentDialog'
import type { WorkspaceController } from '../../useWorkspaceController'

const FileEditorDialog = lazy(() =>
  import('../../components/FileEditorDialog').then((module) => ({
    default: module.FileEditorDialog
  }))
)

type AppDialogsProps = WorkspaceController['dialogs']

export function AppDialogs(props: AppDialogsProps): ReactElement {
  const {
    accountDialogOpen,
    reauthenticationTarget,
    setReauthenticationTarget,
    handleReauthenticateChatAccount,
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
    editingProjectCwd,
    projects,
    reviewCommentsDraft,
    setAccountDialogOpen,
    setAppearanceFontSizeInputDraft,
    setAppearanceZoomLevelInputDraft,
    setEditingSshEnvironment,
    setProjectDialogOpen,
    setEditingProjectCwd,
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
    <AnimatePresence>
      {settingsOpen && (
        <SettingsDialog
          key="settings"
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
      )}
      {accountDialogOpen && (
        <AccountDialog
          key="accounts"
          providerLabel={settingsPanelProps.newSessionProvider === 'claude' ? 'Claude' : 'Codex'}
          onClose={() => setAccountDialogOpen(false)}
          onLogin={handleCreateProviderAccount}
        />
      )}
      {reauthenticationTarget && (
        <AccountDialog
          key="reauthentication"
          providerLabel={reauthenticationTarget.providerId === 'codex' ? 'Codex' : 'Claude'}
          reauthenticate
          onClose={() => setReauthenticationTarget(null)}
          onLogin={handleReauthenticateChatAccount}
        />
      )}
      {projectDialogOpen && (
        <ProjectDialog
          key={editingProjectCwd ?? 'new-project'}
          defaultPath={newSessionCwd}
          projectCwd={editingProjectCwd}
          projects={projects}
          onClose={() => {
            setProjectDialogOpen(false)
            setEditingProjectCwd(null)
          }}
          onSaved={(project, image) => {
            handleProjectSaved(project, image)
            setEditingProjectCwd(null)
          }}
        />
      )}
      {sshEnvironmentDialogOpen && (
        <SshEnvironmentDialog
          key="ssh"
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
        <Suspense
          key="editor"
          fallback={
            <div className="file-editor-overlay">
              <PopupWindow>
                <section
                  className="file-editor-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="File editor"
                >
                  <header className="file-editor-dialog__header">
                    <span role="status">Loading editor…</span>
                    <span />
                    <Button
                      autoFocus
                      aria-label="Close editor"
                      callback={handleCloseFileEditor}
                      icon={<X aria-hidden="true" />}
                      theme="transparent"
                    />
                  </header>
                </section>
              </PopupWindow>
            </div>
          }
        >
          <FileEditorDialog
            diffTargets={fileEditorDiffTargets}
            initialReviewComments={reviewCommentsDraft}
            target={fileEditorTarget}
            onClose={handleCloseFileEditor}
            onContinueReview={handleContinueReview}
            onReviewCommentsChange={handleReviewCommentsChange}
            onSelectTarget={handleSelectFileEditorTarget}
          />
        </Suspense>
      )}
    </AnimatePresence>
  )
}
