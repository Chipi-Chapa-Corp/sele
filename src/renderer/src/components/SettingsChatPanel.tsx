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
import { Dropdown } from './Dropdown'
import { Input } from './Input'
import { SegmentedControl } from './SegmentedControl'
import { SettingsChatBooleanField } from './SettingsChatBooleanField'
import type { SettingsPanelProps } from './SettingsPanel.types'

type SettingsChatPanelProps = Pick<
  SettingsPanelProps,
  | 'forceAccessOptions'
  | 'forceModelOptions'
  | 'forceReasoningOptions'
  | 'forceReviewOptions'
  | 'forceSpeedOptions'
  | 'getSettingsFieldClassName'
  | 'handleChatDropdownPreferenceChange'
  | 'handleChatDropdownSettingChange'
  | 'handleNetworkRetrySettingChange'
  | 'handleContinuePromptChange'
  | 'handleLinkedChatSummaryPromptChange'
  | 'isScopedSettingControlDisabled'
  | 'renderProjectSettingAction'
  | 'settingsPanelSettings'
>

export function SettingsChatPanel(props: SettingsChatPanelProps): React.ReactNode {
  const {
    forceAccessOptions,
    forceModelOptions,
    forceReasoningOptions,
    forceReviewOptions,
    forceSpeedOptions,
    getSettingsFieldClassName,
    handleChatDropdownPreferenceChange,
    handleChatDropdownSettingChange,
    handleNetworkRetrySettingChange,
    handleContinuePromptChange,
    handleLinkedChatSummaryPromptChange,
    isScopedSettingControlDisabled,
    renderProjectSettingAction,
    settingsPanelSettings
  } = props
  const renderChatBooleanSettingField = (field: ChatBooleanSettingField): React.ReactElement => (
    <SettingsChatBooleanField
      key={field.key}
      field={field}
      getSettingsFieldClassName={getSettingsFieldClassName}
      renderProjectSettingAction={renderProjectSettingAction}
      settingsPanelSettings={settingsPanelSettings}
      isScopedSettingControlDisabled={isScopedSettingControlDisabled}
      handleChatDropdownPreferenceChange={handleChatDropdownPreferenceChange}
    />
  )
  const chatSelectionActionPath = {
    section: 'chat',
    key: 'selectionAction'
  } satisfies AppProjectSettingPath
  const chatDefaultActiveActionPath = {
    section: 'chat',
    key: 'defaultActiveAction'
  } satisfies AppProjectSettingPath
  const chatForceAccessPath = {
    section: 'chat',
    key: 'forceAccess'
  } satisfies AppProjectSettingPath
  const chatForceReviewPath = {
    section: 'chat',
    key: 'forceReview'
  } satisfies AppProjectSettingPath
  const chatForceModelPath = {
    section: 'chat',
    key: 'forceModel'
  } satisfies AppProjectSettingPath
  const chatForceReasoningPath = {
    section: 'chat',
    key: 'forceReasoning'
  } satisfies AppProjectSettingPath
  const chatForceSpeedPath = {
    section: 'chat',
    key: 'forceSpeed'
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
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Force access</h3>
              <p>Hide the chat dropdown and always use this access mode.</p>
            </div>
            {renderProjectSettingAction(chatForceAccessPath, 'Force access')}
            <Dropdown
              id="settings-chat-force-access"
              aria-label="Force access"
              disabled={isScopedSettingControlDisabled(chatForceAccessPath)}
              menuAlign="end"
              options={forceAccessOptions}
              value={settingsPanelSettings.chat.forceAccess}
              onChange={(value) => handleChatDropdownSettingChange('forceAccess', value)}
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Force review</h3>
              <p>Hide the chat dropdown and always use this review mode.</p>
            </div>
            {renderProjectSettingAction(chatForceReviewPath, 'Force review')}
            <Dropdown
              id="settings-chat-force-review"
              aria-label="Force review"
              disabled={isScopedSettingControlDisabled(chatForceReviewPath)}
              menuAlign="end"
              options={forceReviewOptions}
              value={settingsPanelSettings.chat.forceReview}
              onChange={(value) => handleChatDropdownSettingChange('forceReview', value)}
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Force model</h3>
              <p>Hide the chat dropdown and always use this model.</p>
            </div>
            {renderProjectSettingAction(chatForceModelPath, 'Force model')}
            <Dropdown
              id="settings-chat-force-model"
              aria-label="Force model"
              disabled={isScopedSettingControlDisabled(
                chatForceModelPath,
                forceModelOptions.length <= 1
              )}
              menuAlign="end"
              options={forceModelOptions}
              value={settingsPanelSettings.chat.forceModel}
              onChange={(value) => handleChatDropdownSettingChange('forceModel', value)}
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Force reasoning</h3>
              <p>Hide the chat dropdown and always use this reasoning effort.</p>
            </div>
            {renderProjectSettingAction(chatForceReasoningPath, 'Force reasoning')}
            <Dropdown
              id="settings-chat-force-reasoning"
              aria-label="Force reasoning"
              disabled={isScopedSettingControlDisabled(
                chatForceReasoningPath,
                forceReasoningOptions.length <= 1
              )}
              menuAlign="end"
              options={forceReasoningOptions}
              value={settingsPanelSettings.chat.forceReasoning}
              onChange={(value) => handleChatDropdownSettingChange('forceReasoning', value)}
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Force speed</h3>
              <p>Hide the chat dropdown and always use this speed.</p>
            </div>
            {renderProjectSettingAction(chatForceSpeedPath, 'Force speed')}
            <Dropdown
              id="settings-chat-force-speed"
              aria-label="Force speed"
              disabled={isScopedSettingControlDisabled(
                chatForceSpeedPath,
                forceSpeedOptions.length <= 1
              )}
              menuAlign="end"
              options={forceSpeedOptions}
              value={settingsPanelSettings.chat.forceSpeed}
              onChange={(value) => handleChatDropdownSettingChange('forceSpeed', value)}
            />
          </div>
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
