import { CircleAlert, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { AppContainerTarget } from '../../../shared/app'
import type {
  ProviderConfig,
  ProviderId,
  ProviderConfigValue,
  ProviderConfigFeature
} from '../../../shared/provider'
import { providerApi } from '../providerApi'
import { Switch } from './Switch'
import { SegmentedControl } from './SegmentedControl'
import { Input } from './Input'
import { Button } from './Button'
import { DisclosureToggle } from './DisclosureToggle'
import { ProviderConfigFields } from './ProviderConfigFields'
import { configObject, configFieldLabel } from '../providerConfig'

type Props = {
  providerId: ProviderId
  container: AppContainerTarget
  children: [ReactNode, ReactNode]
}

export function ProviderSettingsContent({ providerId, container, children }: Props): ReactNode {
  const [tab, setTab] = useState('General')
  return (
    <>
      <div className="settings-dialog__provider-configuration">
        <SegmentedControl
          aria-label="Provider sections"
          options={[
            { value: 'General', label: 'General', icon: <Settings2 aria-hidden="true" /> },
            { value: 'Config', label: 'Config', icon: <SlidersHorizontal aria-hidden="true" /> },
            { value: 'Skills', label: 'Skills', icon: <Sparkles aria-hidden="true" /> }
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'General' ? (
        children[0]
      ) : tab === 'Skills' ? (
        children[1]
      ) : (
        <ProviderConfigPanel
          key={`${providerId}:${JSON.stringify(container)}`}
          providerId={providerId}
          container={container}
        />
      )}
    </>
  )
}

function ProviderConfigPanel({ providerId, container }: Omit<Props, 'children'>): ReactNode {
  const [config, setConfig] = useState<ProviderConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showExperimental, setShowExperimental] = useState(false)
  const [reload, setReload] = useState(0)
  const [saved, setSaved] = useState(false)
  const sourceKey = JSON.stringify(container)
  useEffect(() => {
    let active = true
    void providerApi
      .getConfig(providerId, { container: JSON.parse(sourceKey) })
      .then((value) => {
        if (active) setConfig(value)
      })
      .catch((error) => {
        console.error('[caught:ProviderSettingsContent:ProviderConfigPanel]', error)

        if (active) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [providerId, sourceKey, reload])

  const save = async (
    name: string,
    value: ProviderConfigValue,
    path: string[] = []
  ): Promise<void> => {
    setSaving(name)
    setError(null)
    setSaved(false)
    try {
      setConfig(await providerApi.setConfigValue(providerId, name, path, value, { container }))
      setSaved(true)
    } catch (error) {
      console.error('[caught:ProviderSettingsContent:save]', error)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(null)
    }
  }
  const isExperimental = (stage: string): boolean =>
    stage === 'beta' || stage === 'underDevelopment'
  const features =
    config?.features.filter(
      (feature) =>
        feature.stage !== 'removed' &&
        (showExperimental || !isExperimental(feature.stage)) &&
        `${feature.name} ${configFieldLabel(feature.name)} ${feature.displayName ?? ''} ${feature.description ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase())
    ) ?? []
  return (
    <section className="settings-dialog__section" aria-label="Provider configuration settings">
      {error && (
        <div role="alert" className="settings-dialog__field">
          <span>{error}</span>
          <Button
            label="Retry"
            theme="secondary"
            size="small"
            disabled={loading || Boolean(saving)}
            callback={() => {
              setLoading(true)
              setError(null)
              setReload((value) => value + 1)
            }}
          />
        </div>
      )}
      {loading ? (
        <p role="status">Loading configuration…</p>
      ) : config ? (
        <>
          <Input
            type="search"
            aria-label="Search configuration"
            placeholder="Search features…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="settings-dialog__config-toolbar">
            <span role="status">
              {features.length} features{saving ? ' — Saving…' : saved ? ' — Saved' : ''}
            </span>
            <Switch
              label="Experimental"
              checked={showExperimental}
              onChange={(event) => setShowExperimental(event.currentTarget.checked)}
            />
          </div>
          <div className="settings-dialog__section-cards">
            {features.map((feature) => (
              <ConfigFeatureRow
                key={feature.name}
                feature={feature}
                saving={Boolean(saving)}
                onSave={(path, value) => save(feature.name, value, path)}
              />
            ))}
            {features.length === 0 && <p>No matching features.</p>}
          </div>
        </>
      ) : (
        !error && <p>Configuration editing is not available for this provider yet.</p>
      )}
    </section>
  )
}

function ConfigFeatureRow({
  feature,
  saving,
  onSave
}: {
  feature: ProviderConfigFeature
  saving: boolean
  onSave: (path: string[], value: ProviderConfigValue) => Promise<void>
}): ReactNode {
  const [open, setOpen] = useState(false)
  const nested = feature.schema?.type === 'object'
  const enabledField = feature.schema?.properties?.enabled?.type === 'boolean'
  const experimental = feature.stage === 'beta' || feature.stage === 'underDevelopment'
  const disabled = saving || feature.locked || feature.stage === 'deprecated'
  const label = (
    <span className="settings-dialog__skill-title">
      <span title={feature.name}>{feature.displayName || configFieldLabel(feature.name)}</span>
      {experimental && (
        <span title="Experimental feature" className="settings-dialog__nav-icon">
          <CircleAlert role="img" aria-label="Experimental feature" />
        </span>
      )}
    </span>
  )
  const schema = feature.schema
  const fields = schema
    ? {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(schema.properties ?? {}).filter(([key]) => key !== 'enabled')
        )
      }
    : undefined
  const value =
    typeof feature.value === 'object'
      ? feature.value
      : enabledField
        ? { enabled: feature.enabled }
        : {}
  return (
    <div className="settings-dialog__field">
      <div className="settings-dialog__field-header">
        {nested ? (
          <DisclosureToggle
            className="settings-dialog__config-heading"
            open={open}
            aria-controls={`config-fields-${feature.name}`}
            onClick={() => setOpen(!open)}
          >
            {label}
          </DisclosureToggle>
        ) : (
          <h3 id={`config-feature-${feature.name}`}>{label}</h3>
        )}
        {feature.description && <p>{feature.description}</p>}
        {(!nested || enabledField) && typeof feature.defaultEnabled === 'boolean' && (
          <p>Default: {feature.defaultEnabled ? 'on' : 'off'}</p>
        )}
      </div>
      {(!nested || enabledField) && (
        <Switch
          className="settings-switch"
          aria-label={configFieldLabel(feature.name)}
          checked={
            nested && typeof configObject(feature.value).enabled === 'boolean'
              ? configObject(feature.value).enabled === true
              : feature.enabled
          }
          title={
            feature.locked
              ? 'Managed setting'
              : feature.stage === 'deprecated'
                ? 'Deprecated feature'
                : undefined
          }
          disabled={disabled || (feature.structured && !schema)}
          onChange={(event) =>
            void onSave(enabledField ? ['enabled'] : [], event.currentTarget.checked)
          }
        />
      )}
      {nested && open && fields && (
        <div className="settings-dialog__config-nested" id={`config-fields-${feature.name}`}>
          <ProviderConfigFields schema={fields} value={value} disabled={disabled} onSave={onSave} />
        </div>
      )}
    </div>
  )
}
