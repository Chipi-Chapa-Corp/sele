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
import { SegmentedControl } from './SegmentedControl'
import { createSettingsFields, SettingsSection } from './settingsFields'
import type { SettingsPanelProps } from './SettingsPanel.types'

export function SettingsChatPanel(props: SettingsPanelProps): React.ReactNode {
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
  const { switchField, numberField, promptField } = createSettingsFields(props)
  const renderChatBooleanSettingField = (field: ChatBooleanSettingField): React.ReactElement =>
    switchField(
      { section: 'chat', key: field.key },
      field.id,
      field.label,
      field.description,
      settingsPanelSettings.chat[field.key],
      (checked) => handleChatDropdownPreferenceChange(field.key, checked)
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
  return (
    <>
      <SettingsSection id="settings-chat-prompt-box" title="Prompt Box">
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
      </SettingsSection>
      <SettingsSection id="settings-chat-dropdowns" title="Dropdowns">
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
        {forceField('forceReasoning', 'reasoning', 'reasoning effort', forceReasoningOptions, true)}
        {forceField('forceSpeed', 'speed', 'speed', forceSpeedOptions, true)}
        {chatDropdownSettingFields
          .filter((field) => field.key !== 'presets')
          .map(renderChatBooleanSettingField)}
      </SettingsSection>
      <SettingsSection id="settings-chat-progress" title="Progress">
        {chatProgressSettingFields.map(renderChatBooleanSettingField)}
      </SettingsSection>
      <SettingsSection
        id="settings-chat-exceptional-progress"
        title="Stopped, steered, and failed turns"
      >
        {chatStoppedSteeredFailedProgressSettingFields.map(renderChatBooleanSettingField)}
      </SettingsSection>
      <SettingsSection id="settings-chat-failure-retries" title="Failure Retries">
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
        ).map((field) =>
          numberField(
            { section: 'chat', key: field.key },
            `settings-chat-${field.key}`,
            field.label,
            field.description,
            settingsPanelSettings.chat[field.key],
            (value) => handleNetworkRetrySettingChange(field.key, value),
            field.min,
            field.max,
            field.step
          )
        )}
      </SettingsSection>
      <SettingsSection id="settings-chat-stopped-turns" title="Stopped Turns">
        {promptField(
          { section: 'chat', key: 'continuePrompt' },
          'settings-chat-continue-prompt',
          'Continue prompt',
          3,
          settingsPanelSettings.chat.continuePrompt,
          handleContinuePromptChange,
          <p>Sent when Continue is selected or automatically after a usage limit resets.</p>,
          true
        )}
      </SettingsSection>
      <SettingsSection id="settings-chat-linked-chats" title="Linked Chats">
        {promptField(
          { section: 'chat', key: 'linkedChatSummaryPrompt' },
          'settings-chat-linked-chat-summary-prompt',
          'Summary prompt',
          3,
          settingsPanelSettings.chat.linkedChatSummaryPrompt,
          handleLinkedChatSummaryPromptChange,
          <p>
            Sent to a hidden copy of a chat dropped into the composer when its provider has no
            readable compaction summary (Codex). Claude, OpenCode and Copilot use native compaction.
          </p>,
          true
        )}
      </SettingsSection>
    </>
  )
}
