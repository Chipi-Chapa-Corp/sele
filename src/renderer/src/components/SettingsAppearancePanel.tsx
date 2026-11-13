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
import { SegmentedControl, type SegmentedControlOption } from './SegmentedControl'
import { SettingsSection } from './settingsFields'
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
] satisfies readonly SegmentedControlOption<AppThemePreference>[]

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
] satisfies readonly SegmentedControlOption<AppAppearancePositionPreference>[]

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
] satisfies readonly SegmentedControlOption<AppAppearanceStylePreference>[]

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
] satisfies readonly SegmentedControlOption<AppAppearanceControlStylePreference>[]

export function SettingsAppearancePanel(props: SettingsPanelProps): React.ReactNode {
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
  const toggleField = <Value extends string>(
    path: AppProjectSettingPath,
    heading: string,
    label: string,
    options: readonly SegmentedControlOption<Value>[],
    value: Value,
    onChange: (value: Value) => void,
    disabled?: boolean
  ): React.ReactElement => (
    <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
      <div className="settings-dialog__field-header">
        <h3>{heading}</h3>
      </div>
      {renderProjectSettingAction(path, label)}
      <SegmentedControl
        aria-label={label}
        className="settings-dialog__appearance-toggle"
        disabled={isScopedSettingControlDisabled(path, disabled)}
        options={options}
        value={value}
        onChange={onChange}
      />
    </div>
  )
  const appearanceZoomPath = {
    section: 'appearance',
    key: 'zoomLevel'
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
    <>
      <SettingsSection
        id="settings-appearance-window"
        title={isRemoteClient() ? 'Display' : 'Window'}
      >
        {toggleField(
          { section: 'appearance', key: 'theme' },
          'Theme',
          'Theme',
          themeOptions,
          settingsPanelSettings.appearance.theme,
          handleThemePreferenceChange
        )}
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
      </SettingsSection>
      {!isRemoteClient() && (
        <SettingsSection id="settings-appearance-window-controls" title="Window Controls">
          {toggleField(
            { section: 'appearance', key: 'position' },
            'Position',
            'Position',
            appearancePositionOptions,
            settingsPanelSettings.appearance.position,
            handleAppearancePositionChange
          )}
          {toggleField(
            { section: 'appearance', key: 'style' },
            'Style',
            'Window control style',
            appearanceStyleOptions,
            settingsPanelSettings.appearance.style,
            handleAppearanceStyleChange,
            windowControlsHidden
          )}
        </SettingsSection>
      )}
      <SettingsSection id="settings-appearance-buttons" title="Buttons">
        {toggleField(
          { section: 'appearance', key: 'controlStyle' },
          'Style',
          'Button style',
          appearanceControlStyleOptions,
          settingsPanelSettings.appearance.controlStyle,
          handleAppearanceControlStyleChange
        )}
      </SettingsSection>
      <SettingsSection id="settings-appearance-fonts" title="Fonts">
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
      </SettingsSection>
    </>
  )
}
