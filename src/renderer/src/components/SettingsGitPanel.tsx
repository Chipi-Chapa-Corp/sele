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

export function SettingsGitPanel(props: SettingsPanelProps): React.ReactNode {
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
    handleGitPullRequestsEnabledChange,
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
  const gitCommitModelsPath: AppProjectSettingPath = { section: 'git', key: 'commitModels' }
  const gitCommitGenerationPrefixPath = {
    section: 'gitCommitMessageGeneration',
    key: 'aiInstructionsPrefix'
  } satisfies AppProjectSettingPath
  const switchField = (
    path: AppProjectSettingPath,
    id: string,
    label: string,
    description: string,
    checked: boolean,
    onChange: (checked: boolean) => void
  ): React.ReactElement => (
    <div className={getSettingsFieldClassName()}>
      <div className="settings-dialog__field-header">
        <h3 id={id}>{label}</h3>
        <p>{description}</p>
      </div>
      {renderProjectSettingAction(path, label)}
      <Switch
        className="settings-switch"
        aria-labelledby={id}
        checked={checked}
        disabled={isScopedSettingControlDisabled(path)}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </div>
  )
  const promptField = (
    path: AppProjectSettingPath,
    id: string,
    label: string,
    rows: number,
    value: string,
    onChange: (value: string) => void,
    description?: React.ReactElement
  ): React.ReactElement => (
    <div className={getSettingsFieldClassName('settings-dialog__field--stack')} key={id}>
      <label className="settings-dialog__field-header" htmlFor={id}>
        <h3>{label}</h3>
        {description}
      </label>
      {renderProjectSettingAction(path, label)}
      <textarea
        id={id}
        className="settings-dialog__prompt-textarea"
        rows={rows}
        spellCheck={false}
        disabled={isScopedSettingControlDisabled(path)}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  )
  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-git"
      role="tabpanel"
      aria-label="Git settings"
    >
      <section className="settings-dialog__section" aria-labelledby="settings-git-features">
        <h2 className="settings-dialog__section-heading" id="settings-git-features">
          Features
        </h2>
        <div className="settings-dialog__section-cards">
          {switchField(
            { section: 'git', key: 'enablePullRequests' },
            'settings-git-enable-pull-requests',
            'Enable pull requests',
            'Show the Commit / PR switcher in the Git sidebar.',
            settingsPanelSettings.git.enablePullRequests,
            handleGitPullRequestsEnabledChange
          )}
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-quick-actions">
        <h2 className="settings-dialog__section-heading" id="settings-git-quick-actions">
          Quick actions
        </h2>
        <div className="settings-dialog__section-cards">
          {switchField(
            { section: 'gitQuickActions', key: 'showManualCommit' },
            'settings-git-show-manual-commit',
            'Show manual commit',
            'Show commit name generation and the manual Commit button.',
            settingsPanelSettings.git.quickActions.showManualCommit,
            (checked) => handleGitQuickActionsChange('showManualCommit', checked)
          )}
          {switchField(
            { section: 'gitQuickActions', key: 'showAiInstructionsInput' },
            'settings-git-show-ai-instructions-input',
            'Show AI instructions input',
            'Show an input for optional instructions sent to AI commit actions.',
            settingsPanelSettings.git.quickActions.showAiInstructionsInput,
            (checked) => handleGitQuickActionsChange('showAiInstructionsInput', checked)
          )}
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
          {promptField(
            { section: 'git', key: 'errorResolutionPrompt' },
            'settings-git-error-resolution-prompt',
            'Resolve with AI prompt',
            7,
            settingsPanelSettings.git.errorResolutionPrompt,
            (value) => handleGitErrorResolutionPromptChange('errorResolutionPrompt', value),
            <p>
              Available variables: {'{cwd}'}, {'{operation}'}, and {'{error}'}.
            </p>
          )}
          {promptField(
            { section: 'git', key: 'permanentErrorResolutionPrompt' },
            'settings-git-permanent-error-resolution-prompt',
            'Permanent AI fix prompt',
            7,
            settingsPanelSettings.git.permanentErrorResolutionPrompt,
            (value) =>
              handleGitErrorResolutionPromptChange('permanentErrorResolutionPrompt', value),
            <p>Sent from the Resolve with AI dropdown.</p>
          )}
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-untracked-files">
        <h2 className="settings-dialog__section-heading" id="settings-git-untracked-files">
          Untracked files
        </h2>
        <div className="settings-dialog__section-cards">
          {promptField(
            { section: 'git', key: 'untrackedFilesPrompt' },
            'settings-git-untracked-files-prompt',
            'Solve with AI prompt',
            3,
            settingsPanelSettings.git.untrackedFilesPrompt,
            handleGitUntrackedFilesPromptChange,
            <p>Sent when resolving a large set of untracked files from the Git tab.</p>
          )}
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-git-ai-chat-commit">
        <h2 className="settings-dialog__section-heading" id="settings-git-ai-chat-commit">
          AI Chat Commit
        </h2>
        <div className="settings-dialog__section-cards">
          {gitCommitPromptFieldOptions.map((field) =>
            promptField(
              { section: 'gitCommitPrompt', key: field.key },
              `settings-git-commit-prompt-${field.key}`,
              field.label,
              field.rows,
              settingsPanelSettings.git.commitPrompt[field.key],
              (value) => handleGitCommitPromptChange(field.key, value)
            )
          )}
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
          {promptField(
            { section: 'gitCommitMessageGeneration', key: 'prompt' },
            'settings-git-commit-generation-prompt',
            'Generation prompt',
            4,
            settingsPanelSettings.git.commitMessageGeneration.prompt,
            (value) => handleGitCommitMessageGenerationChange('prompt', value)
          )}
          {promptField(
            { section: 'gitCommitMessageGeneration', key: 'largeChangePrompt' },
            'settings-git-commit-large-change-prompt',
            'Large-change prompt',
            6,
            settingsPanelSettings.git.commitMessageGeneration.largeChangePrompt,
            (value) => handleGitCommitMessageGenerationChange('largeChangePrompt', value)
          )}
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
          {promptField(
            { section: 'gitWorktree', key: 'branchNamePrompt' },
            'settings-git-worktree-branch-name-prompt',
            'Branch name prompt',
            4,
            settingsPanelSettings.git.worktree.branchNamePrompt,
            (value) => handleGitWorktreeChange('branchNamePrompt', value)
          )}
        </div>
      </section>
    </section>
  )
}
