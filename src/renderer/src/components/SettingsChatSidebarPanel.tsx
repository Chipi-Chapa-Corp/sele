import { type AppProjectSettingPath } from '../appProjectSettings'
import { chatSidebarFilters } from '../chatSidebarFilter'
import { type AppChatUsageDisplay } from '../settings'
import { SettingsSection } from './settingsFields'
import type { SettingsPanelProps } from './SettingsPanel.types'
import { Switch } from './Switch'

const chatUsageDisplayOptions = [
  { value: 'context', label: 'Context' },
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' }
] satisfies readonly { value: keyof AppChatUsageDisplay; label: string }[]

export function SettingsChatSidebarPanel(props: SettingsPanelProps): React.ReactNode {
  const {
    getSettingsFieldClassName,
    handleChatUsageDisplayChange,
    isScopedSettingControlDisabled,
    renderProjectSettingAction,
    settingsPanelSettings
  } = props
  const chatDisplayUsagePath = {
    section: 'chat',
    key: 'displayUsage'
  } satisfies AppProjectSettingPath
  return (
    <>
      <SettingsSection id="settings-chat-sidebar-grouping" title="Conversations">
        <div className={getSettingsFieldClassName()}>
          <div className="settings-dialog__field-header">
            <h3 id="settings-group-chats-by-project">Group by project</h3>
          </div>
          <Switch
            className="settings-switch"
            aria-labelledby="settings-group-chats-by-project"
            checked={props.groupChatsByProject}
            onChange={(event) => props.handleGroupChatsByProjectChange(event.currentTarget.checked)}
          />
        </div>
      </SettingsSection>
      <SettingsSection id="settings-chat-sidebar-tabs" title="Header tabs">
        {chatSidebarFilters
          .filter(({ value }) => !props.showWorkingAtBottom || value !== 'working')
          .map(({ value, label, description }) => (
            <div className={getSettingsFieldClassName()} key={value}>
              <div className="settings-dialog__field-header">
                <h3 id={`settings-sidebar-tab-${value}`}>{label}</h3>
                <p>
                  {value === 'sleeping'
                    ? 'Show the Sleeping tab and Sleep and Wake up buttons.'
                    : description}
                </p>
              </div>
              <Switch
                className="settings-switch"
                aria-labelledby={`settings-sidebar-tab-${value}`}
                checked={props.chatSidebarTabs[value]}
                onChange={(event) =>
                  props.handleChatSidebarTabChange(value, event.currentTarget.checked)
                }
              />
            </div>
          ))}
      </SettingsSection>
      <SettingsSection id="settings-show-working-at-bottom" title="Show working at the bottom">
        <div className={getSettingsFieldClassName()}>
          <div className="settings-dialog__field-header">
            <p>Group working chats by project below Done.</p>
          </div>
          <Switch
            className="settings-switch"
            aria-labelledby="settings-show-working-at-bottom"
            checked={props.showWorkingAtBottom}
            onChange={(event) => props.handleShowWorkingAtBottomChange(event.currentTarget.checked)}
          />
        </div>
      </SettingsSection>
      <SettingsSection id="settings-chat-sidebar-limits" title="Limits">
        <div className={getSettingsFieldClassName()}>
          <div className="settings-dialog__field-header">
            <h3>Which limits to show</h3>
          </div>
          {renderProjectSettingAction(chatDisplayUsagePath, 'Which limits to show')}
          <div className="settings-dialog__limit-toggles">
            {chatUsageDisplayOptions.map(({ value, label }) => (
              <label className="settings-dialog__limit-toggle" key={value}>
                <span>{label}</span>
                <Switch
                  className="settings-switch"
                  aria-label={label}
                  checked={settingsPanelSettings.chat.displayUsage[value]}
                  disabled={isScopedSettingControlDisabled(chatDisplayUsagePath)}
                  onChange={(event) =>
                    handleChatUsageDisplayChange({
                      ...settingsPanelSettings.chat.displayUsage,
                      [value]: event.currentTarget.checked
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </SettingsSection>
    </>
  )
}
