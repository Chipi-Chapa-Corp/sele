import { configFieldLabel, configObject } from '../providerConfig'
import { useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ProviderConfigField, ProviderConfigValue } from '../../../shared/provider'
import { Button } from './Button'
import { Input } from './Input'
import { Switch } from './Switch'
import { Dropdown } from './Dropdown'
import { DisclosureToggle } from './DisclosureToggle'

const initialValue = (field: ProviderConfigField): ProviderConfigValue =>
  field.default ??
  field.enum?.[0] ??
  (field.type === 'boolean'
    ? false
    : field.type === 'object'
      ? {}
      : field.type === 'array'
        ? []
        : field.type === 'number' || field.type === 'integer'
          ? (field.minimum ?? 0)
          : '')

type EditorProps = {
  field: ProviderConfigField
  value: ProviderConfigValue | undefined
  label: string
  disabled: boolean
  onChange: (value: ProviderConfigValue) => void
}

function ConfigValueInput({ field, value, label, disabled, onChange }: EditorProps): ReactNode {
  const [newKey, setNewKey] = useState('')
  if (field.enum)
    return (
      <Dropdown
        aria-label={label}
        disabled={disabled}
        value={
          value === undefined
            ? ''
            : String(
                field.enum.findIndex((option) => JSON.stringify(option) === JSON.stringify(value))
              )
        }
        valueContent={value === undefined ? 'Not set' : undefined}
        options={field.enum.map((option, index) => ({
          value: String(index),
          label: String(option)
        }))}
        onChange={(index) => onChange(field.enum![Number(index)])}
      />
    )
  if (field.type === 'boolean')
    return (
      <Switch
        aria-label={label}
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    )
  if (field.type === 'string' || field.type === 'number' || field.type === 'integer')
    return (
      <Input
        aria-label={label}
        disabled={disabled}
        type={field.type === 'string' ? 'text' : 'number'}
        step={field.type === 'integer' ? 1 : 'any'}
        min={field.minimum}
        max={field.maximum}
        placeholder="Not set"
        value={value == null ? '' : String(value)}
        onChange={(event) =>
          onChange(
            field.type === 'string'
              ? event.target.value
              : event.target.value === ''
                ? null
                : event.target.valueAsNumber
          )
        }
      />
    )
  if (field.type === 'array' && field.items) {
    const items = Array.isArray(value) ? value : []
    return (
      <div className="settings-dialog__config-fields">
        {items.map((item, index) => (
          <div className="settings-dialog__config-array-item" key={index}>
            <ConfigValueInput
              field={field.items!}
              value={item}
              label={`${label} ${index + 1}`}
              disabled={disabled}
              onChange={(next) =>
                onChange(items.map((existing, i) => (i === index ? next : existing)))
              }
            />
            <Button
              aria-label={`Remove ${label} ${index + 1}`}
              icon={<Trash2 aria-hidden="true" />}
              theme="transparent"
              size="small"
              disabled={disabled}
              callback={() => onChange(items.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        <Button
          label="Add item"
          icon={<Plus aria-hidden="true" />}
          size="small"
          theme="secondary"
          disabled={disabled}
          callback={() => onChange([...items, initialValue(field.items!)])}
        />
      </div>
    )
  }
  if (field.type === 'object') {
    const object = configObject(value)
    const fields = {
      ...field.properties,
      ...Object.fromEntries(
        Object.keys(object)
          .filter((key) => !field.properties?.[key] && field.additionalProperties)
          .map((key) => [key, field.additionalProperties!])
      )
    }
    return (
      <div className="settings-dialog__config-fields">
        {Object.entries(fields).map(([key, child]) => (
          <div key={key} className="settings-dialog__config-fields">
            <span>{configFieldLabel(key)}</span>
            <ConfigValueInput
              field={child}
              value={object[key]}
              label={`${label} ${key}`}
              disabled={disabled}
              onChange={(next) => onChange({ ...object, [key]: next })}
            />
            {!field.properties?.[key] && (
              <Button
                label={`Remove ${key}`}
                theme="transparent"
                size="small"
                disabled={disabled}
                callback={() => {
                  const next = { ...object }
                  delete next[key]
                  onChange(next)
                }}
              />
            )}
          </div>
        ))}
        {field.additionalProperties && (
          <div className="settings-dialog__config-array-item">
            <Input
              aria-label={`New ${label} key`}
              placeholder="New key"
              value={newKey}
              disabled={disabled}
              onChange={(event) => setNewKey(event.target.value)}
            />
            <Button
              label="Add"
              theme="secondary"
              size="small"
              disabled={
                disabled ||
                !newKey.trim() ||
                Object.hasOwn(object, newKey.trim()) ||
                ['__proto__', 'prototype', 'constructor'].includes(newKey.trim())
              }
              callback={() => {
                onChange({ ...object, [newKey.trim()]: initialValue(field.additionalProperties!) })
                setNewKey('')
              }}
            />
          </div>
        )}
      </div>
    )
  }
  return <span>This field is not supported by the editor.</span>
}

type FieldsProps = {
  schema: ProviderConfigField
  value: ProviderConfigValue | undefined
  path?: string[]
  disabled: boolean
  onSave: (path: string[], value: ProviderConfigValue) => Promise<void>
}

export function ProviderConfigFields({
  schema,
  value,
  path = [],
  disabled,
  onSave
}: FieldsProps): ReactNode {
  const object = configObject(value)
  return (
    <div className="settings-dialog__config-fields">
      {Object.entries(schema.properties ?? {}).map(([name, field]) => (
        <ConfigField
          key={
            field.type === 'object' && !field.additionalProperties
              ? name
              : `${name}:${JSON.stringify(object[name])}`
          }
          name={name}
          field={field}
          value={object[name]}
          path={[...path, name]}
          disabled={disabled}
          onSave={onSave}
        />
      ))}
    </div>
  )
}

function ConfigField({
  name,
  field,
  value,
  path,
  disabled,
  onSave
}: {
  name: string
  field: ProviderConfigField
  value: ProviderConfigValue | undefined
  path: string[]
  disabled: boolean
  onSave: FieldsProps['onSave']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const label = configFieldLabel(name)
  if (field.type === 'object' && !field.additionalProperties)
    return (
      <div className="settings-dialog__config-fields">
        <DisclosureToggle
          className="settings-dialog__config-heading"
          open={open}
          onClick={() => setOpen(!open)}
        >
          {label}
        </DisclosureToggle>
        {field.description && <p>{field.description}</p>}
        {open && (
          <ProviderConfigFields
            schema={field}
            value={value}
            path={path}
            disabled={disabled}
            onSave={onSave}
          />
        )}
      </div>
    )
  const immediate = field.type === 'boolean' || Boolean(field.enum)
  return (
    <div
      className={`settings-dialog__config-fields${immediate ? ' settings-dialog__config-fields--inline' : ''}`}
    >
      <div className="settings-dialog__field-header">
        <h3 title={path.join('.')}>{label}</h3>
        {field.description && <p>{field.description}</p>}
        {value === undefined && (
          <p>
            {field.default === undefined ? 'Not set' : `Default: ${JSON.stringify(field.default)}`}
          </p>
        )}
      </div>
      <ConfigValueInput
        field={field}
        value={immediate ? (value ?? field.default) : draft}
        label={label}
        disabled={disabled}
        onChange={(next) => {
          if (immediate) void onSave(path, next)
          else setDraft(next)
        }}
      />
      {!immediate && field.type !== 'unsupported' && (
        <Button
          label="Save"
          size="small"
          theme="secondary"
          disabled={
            disabled ||
            draft === undefined ||
            draft === null ||
            JSON.stringify(draft) === JSON.stringify(value)
          }
          callback={() => onSave(path, draft!)}
        />
      )}
    </div>
  )
}
