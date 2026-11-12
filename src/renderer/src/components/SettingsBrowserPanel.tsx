import { type AppProjectSettingPath } from '../appProjectSettings'
import {
  appBrowserDefaultScaleMax,
  appBrowserDefaultScaleMin,
  type AppBrowserView
} from '../settings'
import { BrowserImportSettings } from './BrowserImportSettings'
import { DesktopAutomationSettings } from './DesktopAutomationSettings'
import { type DropdownOption } from './Dropdown'
import { Input } from './Input'
import { SegmentedControl } from './SegmentedControl'
import type { SettingsPanelProps } from './SettingsPanel.types'
import { Switch } from './Switch'

const browserViewOptions = [
  { value: 'chat', label: 'Per chat' },
  { value: 'project', label: 'Per project' },
  { value: 'global', label: 'Global' }
] satisfies readonly DropdownOption<AppBrowserView>[]

export function SettingsBrowserPanel(props: SettingsPanelProps): React.ReactNode {
  const {
    browserDefaultScaleInput,
    changesContainer,
    changesContainerKey,
    getSettingsFieldClassName,
    handleBrowserDefaultScaleChange,
    handleBrowserEnabledChange,
    handleBrowserViewChange,
    handleNativeChromeChange,
    isScopedSettingControlDisabled,
    renderProjectSettingAction,
    setBrowserDefaultScaleInputDraft,
    settingsPanelSettings
  } = props
  const browserEnabledPath = {
    section: 'browser',
    key: 'enabled'
  } satisfies AppProjectSettingPath
  const browserDefaultScalePath = {
    section: 'browser',
    key: 'defaultScale'
  } satisfies AppProjectSettingPath
  const browserViewPath = {
    section: 'browser',
    key: 'view'
  } satisfies AppProjectSettingPath
  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-browser"
      role="tabpanel"
      aria-label="Browser settings"
    >
      <section className="settings-dialog__section" aria-labelledby="settings-browser-behavior">
        <h2 className="settings-dialog__section-heading" id="settings-browser-behavior">
          Browser
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName()}>
            <div className="settings-dialog__field-header">
              <h3 id="settings-browser-enabled">Built-in browser</h3>
              <p>
                Open web links in Browser tabs inside Sele. When off, links open in your default
                browser.
              </p>
            </div>
            {renderProjectSettingAction(browserEnabledPath, 'Built-in browser')}
            <Switch
              className="settings-switch"
              aria-labelledby="settings-browser-enabled"
              checked={settingsPanelSettings.browser.enabled}
              disabled={isScopedSettingControlDisabled(browserEnabledPath)}
              onChange={(event) => handleBrowserEnabledChange(event.currentTarget.checked)}
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>View</h3>
              <p>Choose which conversations share a set of Browser tabs.</p>
            </div>
            {renderProjectSettingAction(browserViewPath, 'Browser view')}
            <SegmentedControl<AppBrowserView>
              aria-label="Browser view"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(browserViewPath)}
              options={browserViewOptions}
              value={settingsPanelSettings.browser.view}
              onChange={handleBrowserViewChange}
            />
          </div>
        </div>
      </section>
      <section
        className="settings-dialog__section"
        aria-labelledby="settings-browser-accessibility"
      >
        <h2 className="settings-dialog__section-heading" id="settings-browser-accessibility">
          Accessibility
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-browser-default-scale"
            >
              <h3>Default Scale</h3>
              <p>Set the default zoom for Browser pages.</p>
            </label>
            {renderProjectSettingAction(browserDefaultScalePath, 'Default Scale')}
            <div className="settings-dialog__number-with-unit">
              <Input
                aria-label="Default browser scale percentage"
                className="settings-dialog__number-input"
                id="settings-browser-default-scale"
                type="number"
                min={appBrowserDefaultScaleMin}
                max={appBrowserDefaultScaleMax}
                step={5}
                disabled={isScopedSettingControlDisabled(browserDefaultScalePath)}
                value={browserDefaultScaleInput}
                onBlur={() => setBrowserDefaultScaleInputDraft(null)}
                onChange={(event) => handleBrowserDefaultScaleChange(event.currentTarget.value)}
              />
              <span aria-hidden="true" className="settings-dialog__number-unit">
                %
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-native-chrome">
        <h2 className="settings-dialog__section-heading" id="settings-native-chrome">
          Your Chrome
        </h2>
        <p>
          Keep using your existing browser setup, including connections without an extension.
          Official Chrome extensions are optional and keep other browser connections available.
        </p>
        <details
          open={
            settingsPanelSettings.providers.claude.nativeChrome ||
            settingsPanelSettings.providers.codex.nativeChrome
          }
        >
          <summary>Official Chrome extensions (optional)</summary>
          <div className="settings-dialog__section-cards">
            {(['claude', 'codex'] as const).map((provider) => (
              <div className="settings-dialog__field" key={provider}>
                <div className="settings-dialog__field-header">
                  <h3 id={`settings-native-chrome-${provider}`}>
                    {provider === 'claude' ? 'Claude in Chrome' : 'Codex in Chrome'}
                  </h3>
                  <p>
                    {provider === 'claude'
                      ? 'Add the official Claude in Chrome integration for local, writable chats on their next turn. Requires Anthropic’s Chrome extension. When off, Claude follows its existing configuration.'
                      : 'Enable installed official Chrome plugins for local, writable chats on their next turn. Uses the official extension setup. When off, Codex follows its existing configuration.'}
                  </p>
                  <a
                    href={
                      provider === 'claude'
                        ? 'https://code.claude.com/docs/en/chrome'
                        : 'https://developers.openai.com/codex/app/chrome-extension'
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Optional integration setup
                  </a>
                </div>
                <Switch
                  className="settings-switch"
                  aria-labelledby={`settings-native-chrome-${provider}`}
                  checked={settingsPanelSettings.providers[provider].nativeChrome}
                  onChange={(event) =>
                    handleNativeChromeChange(provider, event.currentTarget.checked)
                  }
                />
              </div>
            ))}
          </div>
        </details>
      </section>
      <BrowserImportSettings key={changesContainerKey} currentEnvironment={changesContainer} />
      <DesktopAutomationSettings />
    </section>
  )
}
