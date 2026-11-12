import {
  networkRetryCountMax,
  networkRetryDelaySecondsMax,
  networkRetryDelaySecondsMin
} from '../../../shared/networkRetry'
import {
  chatDropdownSettingFields,
  chatProgressSettingFields,
  chatPromptBoxSettingFields,
  chatStoppedSteeredFailedProgressSettingFields,
  type AppProjectSettingPath,
  type ChatBooleanSettingField
} from '../appProjectSettings'
import { type AppChatDropdownSelectionAction, type AppChatDropdownSettings } from '../settings'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Input } from './Input'
import { SegmentedControl } from './SegmentedControl'
import { SettingsChatBooleanField } from './SettingsChatBooleanField'
import type { SettingsPanelProps } from './SettingsPanel.types'

export function SettingsChatPanel(props: SettingsPanelProps): React.ReactNode {
  const {
    forceAccessOptions,
    forceModelOptions,
    forceReasoningOptions,
    forceReviewOptions,
    forceSpeedOptions,
    getSettingsFieldClassName,
    handleChatDropdownSettingChange,
    handleNetworkRetrySettingChange,
    handleContinuePromptChange,
    handleLinkedChatSummaryPromptChange,
    isScopedSettingControlDisabled,
    renderProjectSettingAction,
    settingsPanelSettings
  } = props
  const renderChatBooleanSettingField = (field: ChatBooleanSettingField): React.ReactElement => (
    <SettingsChatBooleanField key={field.key} field={field} {...props} />
  )
  const forceField = <
    Key extends 'forceAccess' | 'forceReview' | 'forceModel' | 'forceReasoning' | 'forceSpeed'
  >(
    key: Key,
    name: string,
    target: string,
    options: DropdownOption<AppChatDropdownSettings[Key]>[],
    disabledWithoutChoice = false
  ): React.ReactElement => {
    const path: AppProjectSettingPath = { section: 'chat', key }
    const label = `Force ${name}`
    return (
      <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
        <div className="settings-dialog__field-header">
          <h3>{label}</h3>
          <p>{`Hide the chat dropdown and always use this ${target}.`}</p>
        </div>
        {renderProjectSettingAction(path, label)}
        <Dropdown
          id={`settings-chat-force-${name}`}
          aria-label={label}
          disabled={isScopedSettingControlDisabled(
            path,
            disabledWithoutChoice && options.length <= 1
          )}
          menuAlign="end"
          options={options}
          value={settingsPanelSettings.chat[key]}
          onChange={(value) => handleChatDropdownSettingChange(key, value)}
        />
      </div>
    )
  }
  const chatSelectionActionPath = {
    section: 'chat',
    key: 'selectionAction'
  } satisfies AppProjectSettingPath
  const chatDefaultActiveActionPath = {
    section: 'chat',
    key: 'defaultActiveAction'
  } satisfies AppProjectSettingPath
  const chatContinuePromptPath = {
    section: 'chat',
    key: 'continuePrompt'
  } satisfies AppProjectSettingPath
  const chatLinkedChatSummaryPromptPath = {
    section: 'chat',
    key: 'linkedChatSummaryPrompt'
  } satisfies AppProjectSettingPath
  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-chat"
      role="tabpanel"
      aria-label="Chat settings"
    >
      <section className="settings-dialog__section" aria-labelledby="settings-chat-prompt-box">
        <h2 className="settings-dialog__section-heading" id="settings-chat-prompt-box">
          Prompt Box
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Default active action</h3>
              <p>Choose how to send messages while a response is active.</p>
            </div>
            {renderProjectSettingAction(chatDefaultActiveActionPath, 'Default active action')}
            <SegmentedControl<AppChatDropdownSettings['defaultActiveAction']>
              aria-label="Default active action"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(chatDefaultActiveActionPath)}
              options={[
                { value: 'queue', label: 'Queue' },
                { value: 'steer', label: 'Steer' }
              ]}
              value={settingsPanelSettings.chat.defaultActiveAction}
              onChange={(value) => handleChatDropdownSettingChange('defaultActiveAction', value)}
            />
          </div>
          {chatPromptBoxSettingFields.map(renderChatBooleanSettingField)}
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-chat-dropdowns">
        <h2 className="settings-dialog__section-heading" id="settings-chat-dropdowns">
          Dropdowns
        </h2>
        <div className="settings-dialog__section-cards">
          {chatDropdownSettingFields
            .filter((field) => field.key === 'presets')
            .map(renderChatBooleanSettingField)}
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Action on selection</h3>
              <p>Choose what happens after selecting a model or another parameter.</p>
            </div>
            {renderProjectSettingAction(chatSelectionActionPath, 'Action on selection')}
            <Dropdown<AppChatDropdownSelectionAction>
              id="settings-chat-selection-action"
              aria-label="Action on selection"
              disabled={isScopedSettingControlDisabled(chatSelectionActionPath)}
              menuAlign="end"
              options={[
                { value: 'stay', label: 'Stay' },
                { value: 'back', label: 'Back' },
                { value: 'close', label: 'Close' }
              ]}
              value={settingsPanelSettings.chat.selectionAction}
              onChange={(value) => handleChatDropdownSettingChange('selectionAction', value)}
            />
          </div>
          {forceField('forceAccess', 'access', 'access mode', forceAccessOptions)}
          {forceField('forceReview', 'review', 'review mode', forceReviewOptions)}
          {forceField('forceModel', 'model', 'model', forceModelOptions, true)}
          {forceField(
            'forceReasoning',
            'reasoning',
            'reasoning effort',
            forceReasoningOptions,
            true
          )}
          {forceField('forceSpeed', 'speed', 'speed', forceSpeedOptions, true)}
          {chatDropdownSettingFields
            .filter((field) => field.key !== 'presets')
            .map(renderChatBooleanSettingField)}
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-chat-progress">
        <h2 className="settings-dialog__section-heading" id="settings-chat-progress">
          Progress
        </h2>
        <div className="settings-dialog__section-cards">
          {chatProgressSettingFields.map(renderChatBooleanSettingField)}
        </div>
      </section>
      <section
        className="settings-dialog__section"
        aria-labelledby="settings-chat-exceptional-progress"
      >
        <h2 className="settings-dialog__section-heading" id="settings-chat-exceptional-progress">
          Stopped, steered, and failed turns
        </h2>
        <div className="settings-dialog__section-cards">
          {chatStoppedSteeredFailedProgressSettingFields.map(renderChatBooleanSettingField)}
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-chat-failure-retries">
        <h2 className="settings-dialog__section-heading" id="settings-chat-failure-retries">
          Failure Retries
        </h2>
        <div className="settings-dialog__section-cards">
          {renderChatBooleanSettingField({
            key: 'continueOnUsageReset',
            id: 'settings-chat-continue-on-usage-reset',
            label: 'Continue on usage reset',
            description:
              'Automatically queue the Continue prompt for the provider’s next known usage reset.'
          })}
          {(
            [
              {
                key: 'networkRetryCount',
                label: 'Retry attempts',
                description: 'Retry interrupted responses this many times. Use 0 to disable.',
                min: 0,
                max: networkRetryCountMax,
                step: 1
              },
              {
                key: 'networkRetryDelaySeconds',
                label: 'Retry interval (seconds)',
                description: 'Wait this many seconds between retry attempts.',
                min: networkRetryDelaySecondsMin,
                max: networkRetryDelaySecondsMax,
                step: 0.1
              }
            ] as const
          ).map((field) => {
            const path = { section: 'chat', key: field.key } satisfies AppProjectSettingPath
            const id = `settings-chat-${field.key}`
            return (
              <div className={getSettingsFieldClassName()} key={field.key}>
                <label className="settings-dialog__field-header" htmlFor={id}>
                  <h3>{field.label}</h3>
                  <p>{field.description}</p>
                </label>
                {renderProjectSettingAction(path, field.label)}
                <Input
                  className="settings-dialog__number-input"
                  id={id}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  disabled={isScopedSettingControlDisabled(path)}
                  value={settingsPanelSettings.chat[field.key]}
                  onChange={(event) =>
                    handleNetworkRetrySettingChange(field.key, event.currentTarget.valueAsNumber)
                  }
                />
              </div>
            )
          })}
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-chat-stopped-turns">
        <h2 className="settings-dialog__section-heading" id="settings-chat-stopped-turns">
          Stopped Turns
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-chat-continue-prompt"
            >
              <h3>Continue prompt</h3>
              <p>Sent when Continue is selected or automatically after a usage limit resets.</p>
            </label>
            {renderProjectSettingAction(chatContinuePromptPath, 'Continue prompt')}
            <textarea
              id="settings-chat-continue-prompt"
              className="settings-dialog__prompt-textarea"
              rows={3}
              disabled={isScopedSettingControlDisabled(chatContinuePromptPath)}
              value={settingsPanelSettings.chat.continuePrompt}
              onChange={(event) => handleContinuePromptChange(event.currentTarget.value)}
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-chat-linked-chats">
        <h2 className="settings-dialog__section-heading" id="settings-chat-linked-chats">
          Linked Chats
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-chat-linked-chat-summary-prompt"
            >
              <h3>Summary prompt</h3>
              <p>
                Sent to a hidden copy of a chat dropped into the composer when its provider has no
                readable compaction summary (Codex). Claude, OpenCode and Copilot use native
                compaction.
              </p>
            </label>
            {renderProjectSettingAction(chatLinkedChatSummaryPromptPath, 'Summary prompt')}
            <textarea
              id="settings-chat-linked-chat-summary-prompt"
              className="settings-dialog__prompt-textarea"
              rows={3}
              disabled={isScopedSettingControlDisabled(chatLinkedChatSummaryPromptPath)}
              value={settingsPanelSettings.chat.linkedChatSummaryPrompt}
              onChange={(event) => handleLinkedChatSummaryPromptChange(event.currentTarget.value)}
            />
          </div>
        </div>
      </section>
    </section>
  )
}
