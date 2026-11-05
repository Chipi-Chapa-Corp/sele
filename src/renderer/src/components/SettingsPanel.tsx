import type { SettingsPanelProps } from './SettingsPanel.types'
export type {
  SettingsPanelProps,
  SettingsTab,
  ProviderResourcesLoadState
} from './SettingsPanel.types'
import { LocalAccessSettings } from './LocalAccessSettings'
import { SettingsProvidersPanel } from './SettingsProvidersPanel'
import { SettingsChatSidebarPanel } from './SettingsChatSidebarPanel'
import { SettingsChatPanel } from './SettingsChatPanel'
import { SettingsPerformancePanel } from './SettingsPerformancePanel'
import { SettingsGitPanel } from './SettingsGitPanel'
import { SettingsBrowserPanel } from './SettingsBrowserPanel'
import { SettingsAppearancePanel } from './SettingsAppearancePanel'

export const renderSettingsPanel = (props: SettingsPanelProps): React.ReactNode => {
  switch (props.settingsTab) {
    case 'localNetwork':
      return <LocalAccessSettings />
    case 'providers':
      return <SettingsProvidersPanel {...props} />
    case 'chatSidebar':
      return <SettingsChatSidebarPanel {...props} />
    case 'chat':
      return <SettingsChatPanel {...props} />
    case 'performance':
      return <SettingsPerformancePanel {...props} />
    case 'git':
      return <SettingsGitPanel {...props} />
    case 'browser':
      return <SettingsBrowserPanel {...props} />
    default:
      return <SettingsAppearancePanel {...props} />
  }
}
