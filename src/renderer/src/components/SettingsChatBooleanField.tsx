import type { ChatBooleanSettingField, AppProjectSettingPath } from '../appProjectSettings'
import type { SettingsPanelProps } from './SettingsPanel.types'
import { Switch } from './Switch'

type SettingsChatBooleanFieldProps = Pick<
  SettingsPanelProps,
  | 'getSettingsFieldClassName'
  | 'renderProjectSettingAction'
  | 'settingsPanelSettings'
  | 'isScopedSettingControlDisabled'
  | 'handleChatDropdownPreferenceChange'
> & { field: ChatBooleanSettingField }

export function SettingsChatBooleanField({
  field,
  getSettingsFieldClassName,
  renderProjectSettingAction,
  settingsPanelSettings,
  isScopedSettingControlDisabled,
  handleChatDropdownPreferenceChange
}: SettingsChatBooleanFieldProps): React.ReactElement {
  const path = { section: 'chat', key: field.key } satisfies AppProjectSettingPath

  return (
    <div className={getSettingsFieldClassName()} key={field.key}>
      <div className="settings-dialog__field-header">
        <h3 id={field.id}>{field.label}</h3>
        {field.description && <p>{field.description}</p>}
      </div>
      {renderProjectSettingAction(path, field.label)}
      <Switch
        className="settings-switch"
        aria-labelledby={field.id}
        checked={settingsPanelSettings.chat[field.key]}
        disabled={isScopedSettingControlDisabled(path)}
        onChange={(event) =>
          handleChatDropdownPreferenceChange(field.key, event.currentTarget.checked)
        }
      />
    </div>
  )
}
