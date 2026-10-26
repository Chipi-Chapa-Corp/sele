import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AppContainerTarget } from '../../../../shared/app'
import type { ProviderAccountConfiguration, ProviderId } from '../../../../shared/provider'
import { useSidebarOpenCodeProvider, type OpenCodeProviderPicker } from './SidebarOpenCodeProvider'
import { Dropdown } from '../../components/Dropdown'
import { ProviderIcon } from '../../components/ProviderIcon'
import { providerApi } from '../../providerApi'
import { providerLabels } from '../../providerSettings'
import { useFeedbackMotion } from '../../motion/useFeedbackMotion'
import { Plus, Trash2 } from 'lucide-react'
import { AccountDialog, type AccountAuthorizationSession } from '../../components/AccountDialog'

type SidebarProviderAccountProps = {
  providerId: ProviderId
  chatId?: string
  openCode?: OpenCodeProviderPicker
  refreshKey?: string
  container: AppContainerTarget | null
  available: boolean
  updating: boolean
  hasVisibleLimits: boolean
  onSelect: (accountId: string) => Promise<void>
  onCreate: () => Promise<AccountAuthorizationSession>
  onDelete: (accountId: string) => Promise<void>
}

export function SidebarProviderAccount({
  providerId,
  chatId,
  openCode,
  refreshKey,
  container,
  available,
  updating,
  hasVisibleLimits,
  onSelect,
  onCreate,
  onDelete
}: SidebarProviderAccountProps): ReactElement | null {
  const isOpenCode = providerId === 'opencode' && Boolean(openCode)
  const openCodeControl = useSidebarOpenCodeProvider(
    isOpenCode ? openCode : undefined,
    container,
    available
  )
  const [configurations, setConfigurations] = useState<
    Record<string, ProviderAccountConfiguration>
  >({})
  const [failure, setFailure] = useState<{ sourceKey: string; message: string } | null>(null)
  const sourceKey = JSON.stringify([providerId, container, chatId])
  const configuration = configurations[sourceKey] ?? null
  const error = failure?.sourceKey === sourceKey ? failure.message : null
  const labelRef = useRef<HTMLSpanElement>(null)
  const previousLabel = useRef<string | null>(null)
  const sourceRevision = useRef(0)
  const [addTarget, setAddTarget] = useState<{
    providerId: ProviderId
    create: typeof onCreate
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey requests revalidation without remounting the control.
  useEffect(() => {
    sourceRevision.current += 1
    if (!available || isOpenCode) return
    if (failure !== null) setFailure(null)
    let active = true
    void providerApi
      .getAccounts(providerId, {
        container: JSON.parse(sourceKey)[1],
        chatId: JSON.parse(sourceKey)[2] ?? undefined
      })
      .then((configuration) => {
        if (!active) return
        setConfigurations((current) => ({ ...current, [sourceKey]: configuration }))
      })
      .catch((reason: unknown) => {
        console.error('Unable to load the sidebar provider account.', reason)
        if (active)
          setFailure({
            sourceKey,
            message: reason instanceof Error ? reason.message : String(reason)
          })
      })
    return () => {
      active = false
      sourceRevision.current += 1
    }
  }, [providerId, sourceKey, available, refreshKey, isOpenCode])

  const account = configuration?.accounts.find((candidate) => candidate.active)
  const accountName = (candidate: {
    login?: string | null
    displayName?: string | null
  }): string =>
    providerId === 'opencode'
      ? 'Default Account'
      : candidate.displayName || candidate.login || 'Default Account'
  const label = !available
    ? 'Provider unavailable'
    : isOpenCode
      ? (openCodeControl.label ?? previousLabel.current ?? 'Providers')
      : configuration
        ? account
          ? accountName(account)
          : configuration.available
            ? 'No account selected'
            : 'Default Account'
        : error
          ? (previousLabel.current ?? 'Account unavailable')
          : (previousLabel.current ?? 'Loading account…')

  useFeedbackMotion(labelRef, label)
  useEffect(() => {
    if (configuration || (isOpenCode && openCodeControl.label)) previousLabel.current = label
  }, [configuration, isOpenCode, openCodeControl.label, label])

  const refreshNames = (): void => {
    const revision = sourceRevision.current
    void providerApi
      .getAccounts(providerId, { container, chatId })
      .then((next) => {
        if (revision === sourceRevision.current)
          setConfigurations((current) => ({ ...current, [sourceKey]: next }))
      })
      .catch(() => {
        // Keep the current names after a transient lookup failure.
      })
  }

  const selectAccount = async (accountId: string): Promise<void> => {
    if (accountId === account?.id || updating) return
    setFailure(null)
    try {
      await onSelect(accountId)
      const next = await providerApi.getAccounts(providerId, { container, chatId })
      setConfigurations((current) => ({ ...current, [sourceKey]: next }))
    } catch (reason) {
      console.error('Unable to switch the sidebar provider account.', reason)
      setFailure({ sourceKey, message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  const disabled =
    !available ||
    !configuration?.available ||
    !configuration.accounts.length ||
    updating ||
    deleting
  const unavailable =
    !available ||
    (configuration
      ? !configuration.available || configuration.accounts.length === 0
      : Boolean(error) || !previousLabel.current)
  if (!isOpenCode && unavailable && !hasVisibleLimits && !addTarget) return null

  const deleteAccount = async (
    candidate: NonNullable<typeof configuration>['accounts'][number]
  ): Promise<void> => {
    if (updating || deleting || !window.confirm(`Delete the account “${accountName(candidate)}”?`))
      return
    setDeleting(true)
    setFailure(null)
    try {
      await onDelete(candidate.id)
      const next = await providerApi.getAccounts(providerId, { container, chatId })
      setConfigurations((current) => ({ ...current, [sourceKey]: next }))
    } catch (reason) {
      setFailure({ sourceKey, message: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div aria-label={isOpenCode ? 'Current OpenCode provider' : 'Current provider account'}>
      <Dropdown
        aria-label={isOpenCode ? 'OpenCode provider' : `${providerLabels[providerId]} account`}
        fill
        placement="top"
        value={isOpenCode ? openCodeControl.dropdownProps.value : (account?.id ?? '')}
        valueLabel={label}
        valueContent={
          <>
            <span className="ui-dropdown__value-icon" aria-hidden="true">
              <ProviderIcon providerId={providerId} />
            </span>
            <span ref={labelRef} className="ui-dropdown__value-label">
              {label}
            </span>
          </>
        }
        title={`${providerLabels[providerId]} · ${label}`}
        disabled={isOpenCode ? openCodeControl.dropdownProps.disabled : disabled}
        menuActions={
          isOpenCode
            ? openCodeControl.dropdownProps.menuActions
            : configuration?.available
              ? [
                  {
                    id: 'add-account',
                    label: 'Add account',
                    icon: <Plus aria-hidden="true" />,
                    disabled: updating || deleting,
                    callback: () => setAddTarget({ providerId, create: onCreate })
                  }
                ]
              : []
        }
        options={
          isOpenCode
            ? openCodeControl.dropdownProps.options
            : configuration?.accounts.map((candidate) => ({
                value: candidate.id,
                label: accountName(candidate),
                inlineActions:
                  candidate.id !== 'default' && configuration.available
                    ? [
                        {
                          id: 'delete-account',
                          ariaLabel: `Delete account ${accountName(candidate)}`,
                          title: 'Delete account',
                          icon: <Trash2 aria-hidden="true" />,
                          disabled: updating || deleting,
                          callback: () => deleteAccount(candidate)
                        }
                      ]
                    : []
              }))
        }
        onOpen={isOpenCode ? undefined : refreshNames}
        onChange={
          isOpenCode
            ? openCodeControl.dropdownProps.onChange
            : (accountId) => void selectAccount(accountId)
        }
      />
      {addTarget && (
        <AccountDialog
          providerLabel={providerLabels[addTarget.providerId]}
          onClose={() => {
            setAddTarget(null)
            refreshNames()
          }}
          onLogin={addTarget.create}
        />
      )}
      {isOpenCode && openCodeControl.content}
      {!isOpenCode && error && (
        <p className="chat__status" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
