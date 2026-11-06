import { AnimatePresence } from 'motion/react'
import { lazy, memo, Suspense, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../components/Button'
import { PopupWindow } from '../../components/PopupWindow'
import '../../components/FileEditorDialog.css'
import type { WorkspaceController } from '../../useWorkspaceController'

const AccountDialog = lazy(() =>
  import('../../components/AccountDialog').then((module) => ({ default: module.AccountDialog }))
)
const ProjectDialog = lazy(() =>
  import('../../components/ProjectDialog').then((module) => ({ default: module.ProjectDialog }))
)
const SettingsDialog = lazy(() =>
  import('../../components/SettingsDialog').then((module) => ({ default: module.SettingsDialog }))
)
const SshEnvironmentDialog = lazy(() =>
  import('../../components/SshEnvironmentDialog').then((module) => ({
    default: module.SshEnvironmentDialog
  }))
)

const FileEditorDialog = lazy(() =>
  import('../../components/FileEditorDialog').then((module) => ({
    default: module.FileEditorDialog
  }))
)

type AppDialogsProps = WorkspaceController['dialogs']

const hasOpenDialog = (props: AppDialogsProps): boolean =>
  Boolean(
    props.settingsOpen ||
      props.accountDialogOpen ||
      props.reauthenticationTarget ||
      props.projectDialogOpen ||
      props.sshEnvironmentDialogOpen ||
      props.fileEditorTarget
  )

export const AppDialogs = memo(
  function AppDialogs(props: AppDialogsProps): ReactElement {
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
          <Suspense key="settings" fallback={null}>
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
          </Suspense>
        )}
        {accountDialogOpen && (
          <Suspense key="accounts" fallback={null}>
            <AccountDialog
              key="accounts"
              providerLabel={
                settingsPanelProps.newSessionProvider === 'claude' ? 'Claude' : 'Codex'
              }
              onClose={() => setAccountDialogOpen(false)}
              onLogin={handleCreateProviderAccount}
            />
          </Suspense>
        )}
        {reauthenticationTarget && (
          <Suspense key="reauthentication" fallback={null}>
            <AccountDialog
              key="reauthentication"
              providerLabel={reauthenticationTarget.providerId === 'codex' ? 'Codex' : 'Claude'}
              reauthenticate
              onClose={() => setReauthenticationTarget(null)}
              onLogin={handleReauthenticateChatAccount}
            />
          </Suspense>
        )}
        {projectDialogOpen && (
          <Suspense key={editingProjectCwd ?? 'new-project'} fallback={null}>
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
          </Suspense>
        )}
        {sshEnvironmentDialogOpen && (
          <Suspense key="ssh" fallback={null}>
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
          </Suspense>
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
  },
  (previous, next) => !hasOpenDialog(previous) && !hasOpenDialog(next)
)
