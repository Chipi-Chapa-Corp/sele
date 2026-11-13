import { PackagePlus, X } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import type { AppProjectSettingPath } from '../appProjectSettings'
import { Input } from './Input'
import type { SettingsPanelProps } from './SettingsPanel.types'
import { Switch } from './Switch'

export function SettingsSection({
  id,
  title,
  children
}: {
  id: string
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="settings-dialog__section" aria-labelledby={id}>
      <h2 className="settings-dialog__section-heading" id={id}>
        {title}
      </h2>
      <div className="settings-dialog__section-cards">{children}</div>
    </section>
  )
}

export const sshEnvironmentMenuActions = (
  {
    setEditingSshEnvironment,
    setSshEnvironmentDialogOpen,
    setSshEnvironmentError,
    sshEnvironmentError
  }: SettingsPanelProps,
  idPrefix: string
) => [
  ...(sshEnvironmentError
    ? [
        {
          id: `${idPrefix}-environment-error`,
          label: sshEnvironmentError,
          title: sshEnvironmentError,
          disabled: true,
          icon: <X aria-hidden="true" />,
          callback: () => {}
        }
      ]
    : []),
  {
    id: `${idPrefix}-add-environment`,
    label: 'Add environment',
    title: 'Add environment',
    icon: <PackagePlus aria-hidden="true" />,
    callback: () => {
      setEditingSshEnvironment(null)
      setSshEnvironmentError(null)
      setSshEnvironmentDialogOpen(true)
    }
  }
]

export const createSettingsFields = ({
  getSettingsFieldClassName,
  isScopedSettingControlDisabled,
  renderProjectSettingAction
}: SettingsPanelProps) => ({
  switchField: (
    path: AppProjectSettingPath,
    id: string,
    label: string,
    description: string | undefined,
    checked: boolean,
    onChange: (checked: boolean) => void
  ): ReactElement => (
    <div className={getSettingsFieldClassName()} key={id}>
      <div className="settings-dialog__field-header">
        <h3 id={id}>{label}</h3>
        {description && <p>{description}</p>}
      </div>
      {renderProjectSettingAction(path, label)}
      <Switch
        className="settings-switch"
        aria-labelledby={id}
        checked={checked}
        disabled={isScopedSettingControlDisabled(path)}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </div>
  ),
  numberField: (
    path: AppProjectSettingPath,
    id: string,
    label: string,
    description: string,
    value: number,
    onChange: (value: number) => void,
    min: number,
    max?: number,
    step = 1
  ): ReactElement => (
    <div className={getSettingsFieldClassName()} key={id}>
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
        step={step}
        disabled={isScopedSettingControlDisabled(path)}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </div>
  ),
  promptField: (
    path: AppProjectSettingPath,
    id: string,
    label: string,
    rows: number,
    value: string,
    onChange: (value: string) => void,
    description?: ReactElement,
    checkSpelling = false
  ): ReactElement => (
    <div className={getSettingsFieldClassName('settings-dialog__field--stack')} key={id}>
      <label className="settings-dialog__field-header" htmlFor={id}>
        <h3>{label}</h3>
        {description}
      </label>
      {renderProjectSettingAction(path, label)}
      <textarea
        id={id}
        className="settings-dialog__prompt-textarea"
        rows={rows}
        spellCheck={checkSpelling ? undefined : false}
        disabled={isScopedSettingControlDisabled(path)}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  )
})
