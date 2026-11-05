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

type SettingsPerformancePanelProps = Pick<
  SettingsPanelProps,
  | 'getSettingsFieldClassName'
  | 'handleMaxChatsRenderedChange'
  | 'handlePerformancePreferenceChange'
  | 'handleRecentChatCacheLimitChange'
  | 'handleRecentlyOpenedFilesLimitChange'
  | 'handleRecentsMessageLimitChange'
  | 'isScopedSettingControlDisabled'
  | 'renderProjectSettingAction'
  | 'settingsPanelSettings'
>

export function SettingsPerformancePanel(props: SettingsPerformancePanelProps): React.ReactNode {
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
  const performanceDisableShadowsPath = {
    section: 'performance',
    key: 'disableShadows'
  } satisfies AppProjectSettingPath
  const performanceMaxChatsRenderedPath = {
    section: 'performance',
    key: 'maxChatsRendered'
  } satisfies AppProjectSettingPath
  const performanceRecentsMessageLimitPath = {
    section: 'performance',
    key: 'recentsMessageLimit'
  } satisfies AppProjectSettingPath
  const performanceRecentlyOpenedFilesLimitPath = {
    section: 'performance',
    key: 'recentlyOpenedFilesLimit'
  } satisfies AppProjectSettingPath
  const chatRecentCacheLimitPath = {
    section: 'chat',
    key: 'recentChatCacheLimit'
  } satisfies AppProjectSettingPath
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
            {renderProjectSettingAction(performanceDisableShadowsPath, 'Disable shadows')}
            <Switch
              className="settings-switch"
              aria-labelledby="settings-performance-disable-shadows"
              checked={settingsPanelSettings.performance.disableShadows}
              disabled={isScopedSettingControlDisabled(performanceDisableShadowsPath)}
              onChange={(event) =>
                handlePerformancePreferenceChange('disableShadows', event.currentTarget.checked)
              }
            />
          </div>
          <div className={getSettingsFieldClassName()}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-performance-max-chats-rendered"
            >
              <h3>Max chats rendered</h3>
              <p>
                Render this many chats at a time in each sidebar group. Pinned chats are always
                rendered.
              </p>
            </label>
            {renderProjectSettingAction(performanceMaxChatsRenderedPath, 'Max chats rendered')}
            <Input
              className="settings-dialog__number-input"
              id="settings-performance-max-chats-rendered"
              type="number"
              min={appMaxChatsRenderedMin}
              step={1}
              disabled={isScopedSettingControlDisabled(performanceMaxChatsRenderedPath)}
              value={settingsPanelSettings.performance.maxChatsRendered}
              onChange={(event) => handleMaxChatsRenderedChange(event.currentTarget.valueAsNumber)}
            />
          </div>
          <div className={getSettingsFieldClassName()}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-performance-recents-message-limit"
            >
              <h3>Messages scanned for Recents</h3>
              <p>
                Include links and files from this many latest user messages and final responses.
              </p>
            </label>
            {renderProjectSettingAction(
              performanceRecentsMessageLimitPath,
              'Messages scanned for Recents'
            )}
            <Input
              className="settings-dialog__number-input"
              id="settings-performance-recents-message-limit"
              type="number"
              min={appRecentsMessageLimitMin}
              max={appRecentsMessageLimitMax}
              step={1}
              disabled={isScopedSettingControlDisabled(performanceRecentsMessageLimitPath)}
              value={settingsPanelSettings.performance.recentsMessageLimit}
              onChange={(event) =>
                handleRecentsMessageLimitChange(event.currentTarget.valueAsNumber)
              }
            />
          </div>
          <div className={getSettingsFieldClassName()}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-performance-recently-opened-files-limit"
            >
              <h3>Recently opened files</h3>
              <p>Show this many recently opened or viewed files in the Recents sidebar.</p>
            </label>
            {renderProjectSettingAction(
              performanceRecentlyOpenedFilesLimitPath,
              'Recently opened files'
            )}
            <Input
              className="settings-dialog__number-input"
              id="settings-performance-recently-opened-files-limit"
              type="number"
              min={appRecentlyOpenedFilesLimitMin}
              max={appRecentlyOpenedFilesLimitMax}
              step={1}
              disabled={isScopedSettingControlDisabled(performanceRecentlyOpenedFilesLimitPath)}
              value={settingsPanelSettings.performance.recentlyOpenedFilesLimit}
              onChange={(event) =>
                handleRecentlyOpenedFilesLimitChange(event.currentTarget.valueAsNumber)
              }
            />
          </div>
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
          <div className={getSettingsFieldClassName()}>
            <label className="settings-dialog__field-header" htmlFor="settings-chat-cache-limit">
              <h3>Cache recent chats</h3>
              <p>
                Keep this many recent chats that haven’t been marked done in memory. Use 0 to
                disable.
              </p>
            </label>
            {renderProjectSettingAction(chatRecentCacheLimitPath, 'Cache recent chats')}
            <Input
              className="settings-dialog__number-input"
              id="settings-chat-cache-limit"
              type="number"
              min={0}
              max={50}
              step={1}
              disabled={isScopedSettingControlDisabled(chatRecentCacheLimitPath)}
              value={settingsPanelSettings.chat.recentChatCacheLimit}
              onChange={(event) =>
                handleRecentChatCacheLimitChange(event.currentTarget.valueAsNumber)
              }
            />
          </div>
        </div>
      </section>
    </section>
  )
}
