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

const settingsPanels = {
  providers: ['Provider', SettingsProvidersPanel],
  chatSidebar: ['Chat sidebar', SettingsChatSidebarPanel],
  chat: ['Chat', SettingsChatPanel],
  performance: ['Performance', SettingsPerformancePanel],
  git: ['Git', SettingsGitPanel],
  browser: ['Browser', SettingsBrowserPanel],
  appearance: ['Appearance', SettingsAppearancePanel]
} as const

export const renderSettingsPanel = (props: SettingsPanelProps): React.ReactNode => {
  if (props.settingsTab === 'localNetwork') return <LocalAccessSettings />
  const [label, Panel] = settingsPanels[props.settingsTab]
  return (
    <section
      key={props.settingsTab}
      className="settings-dialog__panel"
      id={`settings-panel-${props.settingsTab}`}
      role="tabpanel"
      aria-label={`${label} settings`}
    >
      <Panel {...props} />
    </section>
  )
}
