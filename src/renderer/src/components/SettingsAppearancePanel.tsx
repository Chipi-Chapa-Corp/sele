import {
  Apple,
  AppWindow,
  EyeOff,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Sparkles,
  Sun
} from 'lucide-react'
import { type AppearanceFontKey, type AppProjectSettingPath } from '../appProjectSettings'
import { isRemoteClient } from '../runtimeCapabilities'
import {
  appAppearanceZoomPercentMax,
  appAppearanceZoomPercentMin,
  appFontInheritValue,
  appFontMonospaceValue,
  appFontScalePercentMax,
  appFontScalePercentMin,
  appFontSizeToScalePercent,
  appFontSystemValue,
  type AppAppearanceControlStylePreference,
  type AppAppearancePositionPreference,
  type AppAppearanceStylePreference,
  type AppThemePreference
} from '../settings'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Input } from './Input'
import { SegmentedControl } from './SegmentedControl'
import type { SettingsPanelProps } from './SettingsPanel.types'

const themeOptions = [
  {
    value: 'light',
    label: 'Light',
    icon: <Sun aria-hidden="true" />
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: <Moon aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppThemePreference
  label: string
  icon: React.ReactNode
}[]

const appearancePositionOptions = [
  {
    value: 'left',
    label: 'Left',
    icon: <PanelLeft aria-hidden="true" />
  },
  {
    value: 'right',
    label: 'Right',
    icon: <PanelRight aria-hidden="true" />
  },
  {
    value: 'hidden',
    label: 'Hidden',
    icon: <EyeOff aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearancePositionPreference
  label: string
  icon: React.ReactNode
}[]

const appearanceStyleOptions = [
  {
    value: 'sele',
    label: 'Sele',
    icon: <AppWindow aria-hidden="true" />
  },
  {
    value: 'macos',
    label: 'macOS',
    icon: <Apple aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearanceStylePreference
  label: string
  icon: React.ReactNode
}[]

const appearanceControlStyleOptions = [
  {
    value: 'bordered',
    label: 'Bordered',
    icon: <AppWindow aria-hidden="true" />
  },
  {
    value: 'transparent',
    label: 'Transparent',
    icon: <Sparkles aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearanceControlStylePreference
  label: string
  icon: React.ReactNode
}[]

type SettingsAppearancePanelProps = Pick<
  SettingsPanelProps,
  | 'appearanceFontSizeInputDraft'
  | 'appearanceZoomLevelInput'
  | 'getSettingsFieldClassName'
  | 'handleAppearanceControlStyleChange'
  | 'handleAppearanceFontFamilyChange'
  | 'handleAppearanceFontSizeInputBlur'
  | 'handleAppearanceFontSizeInputChange'
  | 'handleAppearancePositionChange'
  | 'handleAppearanceStyleChange'
  | 'handleAppearanceZoomLevelInputBlur'
  | 'handleAppearanceZoomLevelInputChange'
  | 'handleThemePreferenceChange'
  | 'installedFontFamilies'
  | 'installedFontOptions'
  | 'installedFontsLoaded'
  | 'isScopedSettingControlDisabled'
  | 'renderProjectSettingAction'
  | 'settingsPanelSettings'
  | 'settingsScopeKey'
  | 'windowControlsHidden'
>

export function SettingsAppearancePanel(props: SettingsAppearancePanelProps): React.ReactNode {
  const {
    appearanceFontSizeInputDraft,
    appearanceZoomLevelInput,
    getSettingsFieldClassName,
    handleAppearanceControlStyleChange,
    handleAppearanceFontFamilyChange,
    handleAppearanceFontSizeInputBlur,
    handleAppearanceFontSizeInputChange,
    handleAppearancePositionChange,
    handleAppearanceStyleChange,
    handleAppearanceZoomLevelInputBlur,
    handleAppearanceZoomLevelInputChange,
    handleThemePreferenceChange,
    installedFontFamilies,
    installedFontOptions,
    installedFontsLoaded,
    isScopedSettingControlDisabled,
    renderProjectSettingAction,
    settingsPanelSettings,
    settingsScopeKey,
    windowControlsHidden
  } = props
  const appearanceThemePath = {
    section: 'appearance',
    key: 'theme'
  } satisfies AppProjectSettingPath
  const appearanceZoomPath = {
    section: 'appearance',
    key: 'zoomLevel'
  } satisfies AppProjectSettingPath
  const appearancePositionPath = {
    section: 'appearance',
    key: 'position'
  } satisfies AppProjectSettingPath
  const appearanceStylePath = {
    section: 'appearance',
    key: 'style'
  } satisfies AppProjectSettingPath
  const appearanceControlStylePath = {
    section: 'appearance',
    key: 'controlStyle'
  } satisfies AppProjectSettingPath
  const appearanceFontFields = [
    {
      key: 'applicationFont',
      label: 'Application font',
      specialOptions: [{ value: appFontSystemValue, label: 'System Default' }]
    },
    {
      key: 'chatFont',
      label: 'Chat font',
      specialOptions: [
        { value: appFontInheritValue, label: 'Inherit Application' },
        { value: appFontSystemValue, label: 'System Default' }
      ]
    },
    {
      key: 'codeFont',
      label: 'Code font',
      specialOptions: [{ value: appFontMonospaceValue, label: 'System Monospace' }]
    }
  ] satisfies readonly {
    key: AppearanceFontKey
    label: string
    specialOptions: readonly DropdownOption<string>[]
  }[]
  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-appearance"
      role="tabpanel"
      aria-label="Appearance settings"
    >
      <section className="settings-dialog__section" aria-labelledby="settings-appearance-window">
        <h2 className="settings-dialog__section-heading" id="settings-appearance-window">
          {isRemoteClient() ? 'Display' : 'Window'}
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Theme</h3>
            </div>
            {renderProjectSettingAction(appearanceThemePath, 'Theme')}
            <SegmentedControl
              aria-label="Theme"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(appearanceThemePath)}
              options={themeOptions}
              value={settingsPanelSettings.appearance.theme}
              onChange={handleThemePreferenceChange}
            />
          </div>
          {!isRemoteClient() && (
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-appearance-zoom-level"
              >
                <h3>Zoom</h3>
              </label>
              {renderProjectSettingAction(appearanceZoomPath, 'Zoom')}
              <div className="settings-dialog__number-with-unit">
                <Input
                  aria-label="Application zoom percentage"
                  className="settings-dialog__number-input"
                  id="settings-appearance-zoom-level"
                  type="number"
                  min={appAppearanceZoomPercentMin}
                  max={appAppearanceZoomPercentMax}
                  step={1}
                  disabled={isScopedSettingControlDisabled(appearanceZoomPath)}
                  value={appearanceZoomLevelInput}
                  onBlur={handleAppearanceZoomLevelInputBlur}
                  onChange={(event) =>
                    handleAppearanceZoomLevelInputChange(event.currentTarget.value)
                  }
                />
                <span aria-hidden="true" className="settings-dialog__number-unit">
                  %
                </span>
              </div>
            </div>
          )}
        </div>
      </section>
      {!isRemoteClient() && (
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-appearance-window-controls"
        >
          <h2 className="settings-dialog__section-heading" id="settings-appearance-window-controls">
            Window Controls
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Position</h3>
              </div>
              {renderProjectSettingAction(appearancePositionPath, 'Position')}
              <SegmentedControl
                aria-label="Position"
                className="settings-dialog__appearance-toggle"
                disabled={isScopedSettingControlDisabled(appearancePositionPath)}
                options={appearancePositionOptions}
                value={settingsPanelSettings.appearance.position}
                onChange={handleAppearancePositionChange}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Style</h3>
              </div>
              {renderProjectSettingAction(appearanceStylePath, 'Window control style')}
              <SegmentedControl
                aria-label="Window control style"
                className="settings-dialog__appearance-toggle"
                disabled={isScopedSettingControlDisabled(appearanceStylePath, windowControlsHidden)}
                options={appearanceStyleOptions}
                value={settingsPanelSettings.appearance.style}
                onChange={handleAppearanceStyleChange}
              />
            </div>
          </div>
        </section>
      )}
      <section className="settings-dialog__section" aria-labelledby="settings-appearance-buttons">
        <h2 className="settings-dialog__section-heading" id="settings-appearance-buttons">
          Buttons
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Style</h3>
            </div>
            {renderProjectSettingAction(appearanceControlStylePath, 'Button style')}
            <SegmentedControl
              aria-label="Button style"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(appearanceControlStylePath)}
              options={appearanceControlStyleOptions}
              value={settingsPanelSettings.appearance.controlStyle}
              onChange={handleAppearanceControlStyleChange}
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-appearance-fonts">
        <h2 className="settings-dialog__section-heading" id="settings-appearance-fonts">
          Fonts
        </h2>
        <div className="settings-dialog__section-cards">
          {appearanceFontFields.map((field) => {
            const path = {
              section: 'appearance',
              key: field.key
            } satisfies AppProjectSettingPath
            const font = settingsPanelSettings.appearance[field.key]
            const specialValues = new Set(field.specialOptions.map((option) => option.value))
            const selectedFontIsMissing =
              !specialValues.has(font.family) &&
              !installedFontFamilies.some((family) => family === font.family)
            const options = [
              ...field.specialOptions,
              ...(selectedFontIsMissing
                ? [{ value: font.family, label: `${font.family} (Unavailable)` }]
                : []),
              ...installedFontOptions
            ]
            const draftKey = `${settingsScopeKey}:${field.key}`
            const sizeInput =
              appearanceFontSizeInputDraft?.key === draftKey
                ? appearanceFontSizeInputDraft.value
                : String(appFontSizeToScalePercent(font.size))
            const disabled = isScopedSettingControlDisabled(path)

            return (
              <div
                className={getSettingsFieldClassName('settings-dialog__field--inline')}
                key={field.key}
              >
                <div className="settings-dialog__field-header">
                  <h3>{field.label}</h3>
                  {!installedFontsLoaded && <p>Loading installed fonts…</p>}
                </div>
                {renderProjectSettingAction(path, field.label)}
                <div className="settings-dialog__font-controls">
                  <Dropdown
                    aria-label={field.label}
                    className="settings-dialog__font-dropdown"
                    disabled={disabled}
                    options={options}
                    value={font.family}
                    onChange={(family) => handleAppearanceFontFamilyChange(field.key, family)}
                  />
                  <label className="settings-dialog__font-size">
                    <span className="sr-only">{field.label} scale</span>
                    <Input
                      aria-label={`${field.label} scale percentage`}
                      type="number"
                      min={appFontScalePercentMin}
                      max={appFontScalePercentMax}
                      step={2.5}
                      disabled={disabled}
                      value={sizeInput}
                      onBlur={handleAppearanceFontSizeInputBlur}
                      onChange={(event) =>
                        handleAppearanceFontSizeInputChange(field.key, event.currentTarget.value)
                      }
                    />
                    <span aria-hidden="true">%</span>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </section>
  )
}
