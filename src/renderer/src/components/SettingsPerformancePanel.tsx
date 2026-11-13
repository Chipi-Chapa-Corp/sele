import {
  appMaxChatsRenderedMin,
  appRecentlyOpenedFilesLimitMax,
  appRecentlyOpenedFilesLimitMin,
  appRecentsMessageLimitMax,
  appRecentsMessageLimitMin
} from '../settings'
import { createSettingsFields, SettingsSection } from './settingsFields'
import type { SettingsPanelProps } from './SettingsPanel.types'

export function SettingsPerformancePanel(props: SettingsPanelProps): React.ReactNode {
  const {
    handleMaxChatsRenderedChange,
    handlePerformancePreferenceChange,
    handleRecentChatCacheLimitChange,
    handleRecentlyOpenedFilesLimitChange,
    handleRecentsMessageLimitChange,
    settingsPanelSettings
  } = props
  const { switchField, numberField } = createSettingsFields(props)
  return (
    <>
      <SettingsSection id="settings-performance-rendering" title="Rendering">
        {switchField(
          { section: 'performance', key: 'disableShadows' },
          'settings-performance-disable-shadows',
          'Disable shadows',
          'Remove box shadows throughout the app.',
          settingsPanelSettings.performance.disableShadows,
          (checked) => handlePerformancePreferenceChange('disableShadows', checked)
        )}
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
      </SettingsSection>
      <SettingsSection id="settings-performance-chat-cache" title="Chat Cache">
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
      </SettingsSection>
    </>
  )
}
