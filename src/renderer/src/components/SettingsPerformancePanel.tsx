import { type AppProjectSettingPath } from '../appProjectSettings'
import {
  appMaxChatsRenderedMin,
  appRecentlyOpenedFilesLimitMax,
  appRecentlyOpenedFilesLimitMin,
  appRecentsMessageLimitMax,
  appRecentsMessageLimitMin
} from '../settings'
import { Input } from './Input'
import type { SettingsPanelProps } from './SettingsPanel.types'
import { Switch } from './Switch'

export function SettingsPerformancePanel(props: SettingsPanelProps): React.ReactNode {
  const {
    getSettingsFieldClassName,
    handleMaxChatsRenderedChange,
    handlePerformancePreferenceChange,
    handleRecentChatCacheLimitChange,
    handleRecentlyOpenedFilesLimitChange,
    handleRecentsMessageLimitChange,
    isScopedSettingControlDisabled,
    renderProjectSettingAction,
    settingsPanelSettings
  } = props
  const shadowsPath: AppProjectSettingPath = { section: 'performance', key: 'disableShadows' }
  const numberField = (
    path: AppProjectSettingPath,
    id: string,
    label: string,
    description: string,
    value: number,
    onChange: (value: number) => void,
    min: number,
    max?: number
  ): React.ReactElement => (
    <div className={getSettingsFieldClassName()}>
      <label className="settings-dialog__field-header" htmlFor={id}>
        <h3>{label}</h3>
        <p>{description}</p>
      </label>
      {renderProjectSettingAction(path, label)}
      <Input
        className="settings-dialog__number-input"
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        disabled={isScopedSettingControlDisabled(path)}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </div>
  )
  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-performance"
      role="tabpanel"
      aria-label="Performance settings"
    >
      <section
        className="settings-dialog__section"
        aria-labelledby="settings-performance-rendering"
      >
        <h2 className="settings-dialog__section-heading" id="settings-performance-rendering">
          Rendering
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName()}>
            <div className="settings-dialog__field-header">
              <h3 id="settings-performance-disable-shadows">Disable shadows</h3>
              <p>Remove box shadows throughout the app.</p>
            </div>
            {renderProjectSettingAction(shadowsPath, 'Disable shadows')}
            <Switch
              className="settings-switch"
              aria-labelledby="settings-performance-disable-shadows"
              checked={settingsPanelSettings.performance.disableShadows}
              disabled={isScopedSettingControlDisabled(shadowsPath)}
              onChange={(event) =>
                handlePerformancePreferenceChange('disableShadows', event.currentTarget.checked)
              }
            />
          </div>
          {numberField(
            { section: 'performance', key: 'maxChatsRendered' },
            'settings-performance-max-chats-rendered',
            'Max chats rendered',
            'Render this many chats at a time in each sidebar group. Pinned chats are always rendered.',
            settingsPanelSettings.performance.maxChatsRendered,
            handleMaxChatsRenderedChange,
            appMaxChatsRenderedMin
          )}
          {numberField(
            { section: 'performance', key: 'recentsMessageLimit' },
            'settings-performance-recents-message-limit',
            'Messages scanned for Recents',
            'Include links and files from this many latest user messages and final responses.',
            settingsPanelSettings.performance.recentsMessageLimit,
            handleRecentsMessageLimitChange,
            appRecentsMessageLimitMin,
            appRecentsMessageLimitMax
          )}
          {numberField(
            { section: 'performance', key: 'recentlyOpenedFilesLimit' },
            'settings-performance-recently-opened-files-limit',
            'Recently opened files',
            'Show this many recently opened or viewed files in the Recents sidebar.',
            settingsPanelSettings.performance.recentlyOpenedFilesLimit,
            handleRecentlyOpenedFilesLimitChange,
            appRecentlyOpenedFilesLimitMin,
            appRecentlyOpenedFilesLimitMax
          )}
        </div>
      </section>
      <section
        className="settings-dialog__section"
        aria-labelledby="settings-performance-chat-cache"
      >
        <h2 className="settings-dialog__section-heading" id="settings-performance-chat-cache">
          Chat Cache
        </h2>
        <div className="settings-dialog__section-cards">
          {numberField(
            { section: 'chat', key: 'recentChatCacheLimit' },
            'settings-chat-cache-limit',
            'Cache recent chats',
            'Keep this many recent chats that haven’t been marked done in memory. Use 0 to disable.',
            settingsPanelSettings.chat.recentChatCacheLimit,
            handleRecentChatCacheLimitChange,
            0,
            50
          )}
        </div>
      </section>
    </section>
  )
}
