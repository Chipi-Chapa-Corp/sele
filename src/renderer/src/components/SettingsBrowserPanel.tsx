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
import './SettingsBrowserPanel.css'

const browserViewOptions = [
  { value: 'chat', label: 'Per chat' },
  { value: 'project', label: 'Per project' },
  { value: 'global', label: 'Global' }
] satisfies readonly DropdownOption<AppBrowserView>[]

type SettingsBrowserPanelProps = Pick<
  SettingsPanelProps,
  | 'browserDefaultScaleInput'
  | 'changesContainer'
  | 'changesContainerKey'
  | 'getSettingsFieldClassName'
  | 'handleBrowserDefaultScaleChange'
  | 'handleBrowserEnabledChange'
  | 'handleBrowserViewChange'
  | 'handleNativeChromeChange'
  | 'isScopedSettingControlDisabled'
  | 'renderProjectSettingAction'
  | 'setBrowserDefaultScaleInputDraft'
  | 'settingsPanelSettings'
>

export function SettingsBrowserPanel(props: SettingsBrowserPanelProps): React.ReactNode {
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
      className="settings-dialog__panel browser-settings"
      id="settings-panel-browser"
      role="tabpanel"
      aria-label="Browser settings"
    >
      <DesktopAutomationSettings />
      <section className="settings-dialog__section" aria-labelledby="settings-browser-behavior">
        <h2 className="settings-dialog__section-heading" id="settings-browser-behavior">
          Built-in browser
        </h2>
        <div className={getSettingsFieldClassName('browser-settings__compact-row')}>
          <div className="settings-dialog__field-header">
            <h3 id="settings-browser-enabled">Open links inside Sele</h3>
            <p>Use Browser tabs in the app.</p>
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
        <details className="browser-settings__disclosure">
          <summary>Browser options</summary>
          <div className="browser-settings__disclosure-body">
            <div className="settings-dialog__section-cards">
              <div
                className={getSettingsFieldClassName(
                  'settings-dialog__field--inline',
                  'browser-settings__wide-control'
                )}
              >
                <div className="settings-dialog__field-header">
                  <h3>Tab sharing</h3>
                  <p>Choose where built-in tabs are shared.</p>
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
              <div
                className={getSettingsFieldClassName(
                  'settings-dialog__field--inline',
                  'browser-settings__compact-row'
                )}
              >
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-browser-default-scale"
                >
                  <h3>Default zoom</h3>
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
            <BrowserImportSettings
              key={changesContainerKey}
              currentEnvironment={changesContainer}
            />
          </div>
        </details>
      </section>
      <details className="browser-settings__disclosure browser-settings__section-disclosure">
        <summary id="settings-native-chrome">Official Chrome integrations</summary>
        <div className="browser-settings__disclosure-body">
          <p className="browser-settings__note">
            Optional provider extensions, configured separately from Sele’s extension.
          </p>
          <div className="settings-dialog__section-cards">
            {(['claude', 'codex'] as const).map((provider) => (
              <div className="settings-dialog__field browser-settings__compact-row" key={provider}>
                <div className="settings-dialog__field-header">
                  <h3 id={`settings-native-chrome-${provider}`}>
                    {provider === 'claude' ? 'Claude in Chrome' : 'Codex in Chrome'}
                  </h3>
                  <a
                    className="browser-settings__help-link"
                    href={
                      provider === 'claude'
                        ? 'https://code.claude.com/docs/en/chrome'
                        : 'https://developers.openai.com/codex/app/chrome-extension'
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Setup instructions
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
        </div>
      </details>
    </section>
  )
}
