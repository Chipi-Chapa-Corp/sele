import { PackagePlus, X } from 'lucide-react'
import { type AppProjectSettingPath } from '../appProjectSettings'
import { type AppGitCommitPromptSettings } from '../settings'
import { Dropdown } from './Dropdown'
import { Input } from './Input'
import type { SettingsPanelProps } from './SettingsPanel.types'
import { Switch } from './Switch'

const gitCommitPromptFieldOptions = [
  {
    key: 'instructions',
    label: 'Instructions',
    rows: 6
  },
  {
    key: 'workflow',
    label: 'Workflow',
    rows: 9
  },
  {
    key: 'commitStep',
    label: 'Commit step',
    rows: 2
  },
  {
    key: 'extraInstructionsPrefix',
    label: 'Extra instructions prefix',
    rows: 1
  }
] satisfies readonly {
  key: keyof AppGitCommitPromptSettings
  label: string
  rows: number
}[]

type SettingsGitPanelProps = Pick<
  SettingsPanelProps,
  | 'containerOptions'
  | 'getSettingsFieldClassName'
  | 'gitCommitModelOptions'
  | 'gitCommitModelValue'
  | 'gitSettingsModelCatalogLoading'
  | 'gitSettingsModelsCurrent'
  | 'gitSettingsModelsReady'
  | 'handleGitCommitMessageGenerationChange'
  | 'handleGitCommitModelChange'
  | 'handleGitCommitPromptChange'
  | 'handleGitErrorResolutionPromptChange'
  | 'handleGitQuickActionsChange'
  | 'handleGitUntrackedFilesPromptChange'
  | 'handleGitWorktreeChange'
  | 'handleNewSessionContainerChange'
  | 'isScopedSettingControlDisabled'
  | 'newSessionContainerValue'
  | 'newSessionProvider'
  | 'newSessionProviderOptions'
  | 'newSessionProviderValueContent'
  | 'newSessionSourceAvailabilityReady'
  | 'renderProjectSettingAction'
  | 'setEditingSshEnvironment'
  | 'setNewSessionProvider'
  | 'setSshEnvironmentDialogOpen'
  | 'setSshEnvironmentError'
  | 'settingsPanelSettings'
  | 'sshEnvironmentError'
>

export function SettingsGitPanel(props: SettingsGitPanelProps): React.ReactNode {
  const {
    containerOptions,
    getSettingsFieldClassName,
    gitCommitModelOptions,
    gitCommitModelValue,
    gitSettingsModelCatalogLoading,
    gitSettingsModelsCurrent,
    gitSettingsModelsReady,
    handleGitCommitMessageGenerationChange,
    handleGitCommitModelChange,
    handleGitCommitPromptChange,
    handleGitErrorResolutionPromptChange,
    handleGitQuickActionsChange,
    handleGitUntrackedFilesPromptChange,
    handleGitWorktreeChange,
    handleNewSessionContainerChange,
    isScopedSettingControlDisabled,
    newSessionContainerValue,
    newSessionProvider,
    newSessionProviderOptions,
    newSessionProviderValueContent,
    newSessionSourceAvailabilityReady,
    renderProjectSettingAction,
    setEditingSshEnvironment,
    setNewSessionProvider,
    setSshEnvironmentDialogOpen,
    setSshEnvironmentError,
    settingsPanelSettings,
    sshEnvironmentError
  } = props
  const gitCommitModelsPath = {
    section: 'git',
    key: 'commitModels'
  } satisfies AppProjectSettingPath
  const gitUntrackedFilesPromptPath = {
    section: 'git',
    key: 'untrackedFilesPrompt'
  } satisfies AppProjectSettingPath
  const gitErrorResolutionPromptPath = {
    section: 'git',
    key: 'errorResolutionPrompt'
  } satisfies AppProjectSettingPath
  const gitPermanentErrorResolutionPromptPath = {
    section: 'git',
    key: 'permanentErrorResolutionPrompt'
  } satisfies AppProjectSettingPath
  const gitShowManualCommitPath = {
    section: 'gitQuickActions',
    key: 'showManualCommit'
  } satisfies AppProjectSettingPath
  const gitShowAiInstructionsInputPath = {
    section: 'gitQuickActions',
    key: 'showAiInstructionsInput'
  } satisfies AppProjectSettingPath
  const gitCommitGenerationPromptPath = {
    section: 'gitCommitMessageGeneration',
    key: 'prompt'
  } satisfies AppProjectSettingPath
  const gitCommitLargeChangePromptPath = {
    section: 'gitCommitMessageGeneration',
    key: 'largeChangePrompt'
  } satisfies AppProjectSettingPath
  const gitCommitGenerationPrefixPath = {
    section: 'gitCommitMessageGeneration',
    key: 'aiInstructionsPrefix'
  } satisfies AppProjectSettingPath
  const gitWorktreeBranchPromptPath = {
    section: 'gitWorktree',
    key: 'branchNamePrompt'
  } satisfies AppProjectSettingPath
  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-git"
      role="tabpanel"
      aria-label="Git settings"
    >
      <section className="settings-dialog__section" aria-labelledby="settings-git-quick-actions">
        <h2 className="settings-dialog__section-heading" id="settings-git-quick-actions">
          Quick actions
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName()}>
            <div className="settings-dialog__field-header">
              <h3 id="settings-git-show-manual-commit">Show manual commit</h3>
              <p>Show commit name generation and the manual Commit button.</p>
            </div>
            {renderProjectSettingAction(gitShowManualCommitPath, 'Show manual commit')}
            <Switch
              className="settings-switch"
              aria-labelledby="settings-git-show-manual-commit"
              checked={settingsPanelSettings.git.quickActions.showManualCommit}
              disabled={isScopedSettingControlDisabled(gitShowManualCommitPath)}
              onChange={(event) =>
                handleGitQuickActionsChange('showManualCommit', event.currentTarget.checked)
              }
            />
          </div>
          <div className={getSettingsFieldClassName()}>
            <div className="settings-dialog__field-header">
              <h3 id="settings-git-show-ai-instructions-input">Show AI instructions input</h3>
              <p>Show an input for optional instructions sent to AI commit actions.</p>
            </div>
            {renderProjectSettingAction(
              gitShowAiInstructionsInputPath,
              'Show AI instructions input'
            )}
            <Switch
              className="settings-switch"
              aria-labelledby="settings-git-show-ai-instructions-input"
              checked={settingsPanelSettings.git.quickActions.showAiInstructionsInput}
              disabled={isScopedSettingControlDisabled(gitShowAiInstructionsInputPath)}
              onChange={(event) =>
                handleGitQuickActionsChange('showAiInstructionsInput', event.currentTarget.checked)
              }
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-model">
        <h2 className="settings-dialog__section-heading" id="settings-git-model">
          AI model
        </h2>
        <div className="settings-dialog__section-cards">
          <div className="settings-dialog__field settings-dialog__field--inline">
            <div
              className="settings-dialog__provider-configuration settings-dialog__provider-configuration--row"
              role="group"
              aria-label="Git model configuration"
            >
              <span>Configure</span>
              <Dropdown
                aria-label="Git model provider"
                disabled={newSessionProviderOptions.length === 0}
                emptyContent="No providers found"
                options={newSessionProviderOptions}
                size="small"
                value={newSessionProvider}
                valueContent={newSessionProviderValueContent}
                onChange={setNewSessionProvider}
              />
              <span>in</span>
              <Dropdown
                aria-label="Git model environment"
                menuActions={[
                  ...(sshEnvironmentError
                    ? [
                        {
                          id: 'git-model-environment-error',
                          label: sshEnvironmentError,
                          title: sshEnvironmentError,
                          disabled: true,
                          icon: <X aria-hidden="true" />,
                          callback: () => {}
                        }
                      ]
                    : []),
                  {
                    id: 'git-model-add-environment',
                    label: 'Add environment',
                    title: 'Add environment',
                    icon: <PackagePlus aria-hidden="true" />,
                    callback: () => {
                      setEditingSshEnvironment(null)
                      setSshEnvironmentError(null)
                      setSshEnvironmentDialogOpen(true)
                    }
                  }
                ]}
                options={containerOptions}
                size="small"
                value={newSessionContainerValue}
                valueContent={!newSessionSourceAvailabilityReady ? 'Checking' : undefined}
                onChange={handleNewSessionContainerChange}
              />
            </div>
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Commit model</h3>
            </div>
            {renderProjectSettingAction(gitCommitModelsPath, 'Commit model')}
            <Dropdown
              id="settings-git-commit-model"
              aria-label="Commit model"
              disabled={isScopedSettingControlDisabled(
                gitCommitModelsPath,
                !gitSettingsModelsReady ||
                  !gitSettingsModelsCurrent ||
                  gitSettingsModelCatalogLoading
              )}
              menuAlign="end"
              options={gitCommitModelOptions}
              value={gitCommitModelValue}
              onChange={handleGitCommitModelChange}
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-error-resolution">
        <h2 className="settings-dialog__section-heading" id="settings-git-error-resolution">
          Git error resolution
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-git-error-resolution-prompt"
            >
              <h3>Resolve with AI prompt</h3>
              <p>
                Available variables: {'{cwd}'}, {'{operation}'}, and {'{error}'}.
              </p>
            </label>
            {renderProjectSettingAction(gitErrorResolutionPromptPath, 'Resolve with AI prompt')}
            <textarea
              id="settings-git-error-resolution-prompt"
              className="settings-dialog__prompt-textarea"
              rows={7}
              spellCheck={false}
              disabled={isScopedSettingControlDisabled(gitErrorResolutionPromptPath)}
              value={settingsPanelSettings.git.errorResolutionPrompt}
              onChange={(event) =>
                handleGitErrorResolutionPromptChange(
                  'errorResolutionPrompt',
                  event.currentTarget.value
                )
              }
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-git-permanent-error-resolution-prompt"
            >
              <h3>Permanent AI fix prompt</h3>
              <p>Sent from the Resolve with AI dropdown.</p>
            </label>
            {renderProjectSettingAction(
              gitPermanentErrorResolutionPromptPath,
              'Permanent AI fix prompt'
            )}
            <textarea
              id="settings-git-permanent-error-resolution-prompt"
              className="settings-dialog__prompt-textarea"
              rows={7}
              spellCheck={false}
              disabled={isScopedSettingControlDisabled(gitPermanentErrorResolutionPromptPath)}
              value={settingsPanelSettings.git.permanentErrorResolutionPrompt}
              onChange={(event) =>
                handleGitErrorResolutionPromptChange(
                  'permanentErrorResolutionPrompt',
                  event.currentTarget.value
                )
              }
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-untracked-files">
        <h2 className="settings-dialog__section-heading" id="settings-git-untracked-files">
          Untracked files
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-git-untracked-files-prompt"
            >
              <h3>Solve with AI prompt</h3>
              <p>Sent when resolving a large set of untracked files from the Git tab.</p>
            </label>
            {renderProjectSettingAction(gitUntrackedFilesPromptPath, 'Solve with AI prompt')}
            <textarea
              id="settings-git-untracked-files-prompt"
              className="settings-dialog__prompt-textarea"
              rows={3}
              spellCheck={false}
              disabled={isScopedSettingControlDisabled(gitUntrackedFilesPromptPath)}
              value={settingsPanelSettings.git.untrackedFilesPrompt}
              onChange={(event) => handleGitUntrackedFilesPromptChange(event.currentTarget.value)}
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-ai-chat-commit">
        <h2 className="settings-dialog__section-heading" id="settings-git-ai-chat-commit">
          AI Chat Commit
        </h2>
        <div className="settings-dialog__section-cards">
          {gitCommitPromptFieldOptions.map((field) => {
            const fieldId = `settings-git-commit-prompt-${field.key}`
            const path = {
              section: 'gitCommitPrompt',
              key: field.key
            } satisfies AppProjectSettingPath

            return (
              <div
                className={getSettingsFieldClassName('settings-dialog__field--stack')}
                key={field.key}
              >
                <label className="settings-dialog__field-header" htmlFor={fieldId}>
                  <h3>{field.label}</h3>
                </label>
                {renderProjectSettingAction(path, field.label)}
                <textarea
                  id={fieldId}
                  className="settings-dialog__prompt-textarea"
                  rows={field.rows}
                  spellCheck={false}
                  disabled={isScopedSettingControlDisabled(path)}
                  value={settingsPanelSettings.git.commitPrompt[field.key]}
                  onChange={(event) =>
                    handleGitCommitPromptChange(field.key, event.currentTarget.value)
                  }
                />
              </div>
            )
          })}
        </div>
      </section>
      <section
        className="settings-dialog__section"
        aria-labelledby="settings-git-commit-name-generation"
      >
        <h2 className="settings-dialog__section-heading" id="settings-git-commit-name-generation">
          Commit name generation
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-git-commit-generation-prompt"
            >
              <h3>Generation prompt</h3>
            </label>
            {renderProjectSettingAction(gitCommitGenerationPromptPath, 'Generation prompt')}
            <textarea
              id="settings-git-commit-generation-prompt"
              className="settings-dialog__prompt-textarea"
              rows={4}
              spellCheck={false}
              disabled={isScopedSettingControlDisabled(gitCommitGenerationPromptPath)}
              value={settingsPanelSettings.git.commitMessageGeneration.prompt}
              onChange={(event) =>
                handleGitCommitMessageGenerationChange('prompt', event.currentTarget.value)
              }
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-git-commit-large-change-prompt"
            >
              <h3>Large-change prompt</h3>
            </label>
            {renderProjectSettingAction(gitCommitLargeChangePromptPath, 'Large-change prompt')}
            <textarea
              id="settings-git-commit-large-change-prompt"
              className="settings-dialog__prompt-textarea"
              rows={6}
              spellCheck={false}
              disabled={isScopedSettingControlDisabled(gitCommitLargeChangePromptPath)}
              value={settingsPanelSettings.git.commitMessageGeneration.largeChangePrompt}
              onChange={(event) =>
                handleGitCommitMessageGenerationChange(
                  'largeChangePrompt',
                  event.currentTarget.value
                )
              }
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-git-ai-instructions-prefix"
            >
              <h3>AI instructions prefix</h3>
            </label>
            {renderProjectSettingAction(gitCommitGenerationPrefixPath, 'AI instructions prefix')}
            <Input
              id="settings-git-ai-instructions-prefix"
              disabled={isScopedSettingControlDisabled(gitCommitGenerationPrefixPath)}
              value={settingsPanelSettings.git.commitMessageGeneration.aiInstructionsPrefix}
              onChange={(event) =>
                handleGitCommitMessageGenerationChange(
                  'aiInstructionsPrefix',
                  event.currentTarget.value
                )
              }
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-worktree">
        <h2 className="settings-dialog__section-heading" id="settings-git-worktree">
          Worktree
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-git-worktree-branch-name-prompt"
            >
              <h3>Branch name prompt</h3>
            </label>
            {renderProjectSettingAction(gitWorktreeBranchPromptPath, 'Branch name prompt')}
            <textarea
              id="settings-git-worktree-branch-name-prompt"
              className="settings-dialog__prompt-textarea"
              rows={4}
              spellCheck={false}
              disabled={isScopedSettingControlDisabled(gitWorktreeBranchPromptPath)}
              value={settingsPanelSettings.git.worktree.branchNamePrompt}
              onChange={(event) =>
                handleGitWorktreeChange('branchNamePrompt', event.currentTarget.value)
              }
            />
          </div>
        </div>
      </section>
    </section>
  )
}
