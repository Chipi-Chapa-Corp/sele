import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, Trash2, X } from 'lucide-react'
import type { AppContainerTarget } from '../../../../shared/app'
import type { ProviderConnection } from '../../../../shared/providerConnections'
import { Dropdown } from '../../components/Dropdown'
import { Button } from '../../components/Button'
import { PopupWindow } from '../../components/PopupWindow'
import { ProviderIcon } from '../../components/ProviderIcon'
import { ProviderConnectionsPanel } from '../../components/ProviderConnectionsPanel'
import { providerApi } from '../../providerApi'
import '../../components/AccountDialog.css'

export type OpenCodeProviderPicker = {
  loading?: boolean
  providers: ProviderConnection[]
  selectedId: string
  onSelect: (id: string) => void
  onChanged: (connectedProviderId?: string) => void
  error: string | null
  manageOpen: boolean
  onManage: () => void
  onClose: () => void
}

type OpenCodeProviderProps = OpenCodeProviderPicker & {
  container: AppContainerTarget | null
  available: boolean
}

// Expose the provider actions independently so the sidebar can retain one trigger.
export function useSidebarOpenCodeProvider(
  picker: OpenCodeProviderPicker | undefined,
  container: AppContainerTarget | null,
  available: boolean
) {
  const {
    loading = false,
    providers = [],
    selectedId = '',
    onSelect,
    onChanged,
    error,
    manageOpen,
    onManage,
    onClose
  } = picker ?? {}
  const sourceKey = JSON.stringify([Boolean(picker), container])
  const [deletingSource, setDeletingSource] = useState<string | null>(null)
  const deleting = deletingSource === sourceKey
  const [failure, setFailure] = useState<{ sourceKey: string; message: string } | null>(null)
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!manageOpen) return
    const previousFocus = document.activeElement
    dialog.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [manageOpen])
  const selected = providers.find((provider) => provider.id === selectedId)
  const remove = async (provider: ProviderConnection): Promise<void> => {
    if (deleting || !window.confirm(`Delete the ${provider.name} connection?`)) return
    setDeletingSource(sourceKey)
    setFailure(null)
    try {
      for (const connection of provider.connections)
        if (connection.type === 'credential')
          await providerApi.deleteConnection('opencode', connection.id, { container })
      onChanged?.()
    } catch (error) {
      setFailure({
        sourceKey,
        message: error instanceof Error ? error.message : 'Unable to delete connection.'
      })
    } finally {
      setDeletingSource(null)
    }
  }
  const dropdownProps: ComponentProps<typeof Dropdown<string>> = {
    'aria-label': 'OpenCode provider',
    value: selectedId,
    disabled: !available || deleting,
    menuActions: [
      {
        id: 'manage-providers',
        label: 'Manage Providers',
        icon: <Settings2 aria-hidden="true" />,
        callback: () => onManage?.()
      }
    ],
    options: providers.map((provider) => ({
      value: provider.id,
      label: provider.name,
      inlineActions: provider.connections.some((connection) => connection.type === 'credential')
        ? [
            {
              id: 'delete-connection',
              ariaLabel: `Delete ${provider.name} connection`,
              title: 'Delete connection',
              icon: <Trash2 aria-hidden="true" />,
              disabled: deleting,
              callback: () => remove(provider)
            }
          ]
        : []
    })),
    onChange: (id) => onSelect?.(id)
  }
  const message = (failure?.sourceKey === sourceKey ? failure.message : null) || error
  const content = (
    <>
      {message && (
        <p className="chat__status" role="alert">
          {message}
        </p>
      )}
      {manageOpen &&
        createPortal(
          <div
            className="account-dialog-overlay"
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) onClose?.()
            }}
          >
            <PopupWindow>
              <section
                ref={dialog}
                tabIndex={-1}
                className="account-dialog opencode-connections-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Manage Providers"
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Escape') onClose?.()
                }}
              >
                <ProviderConnectionsPanel
                  key={sourceKey}
                  container={container ?? { kind: 'host' }}
                  onChanged={onChanged}
                  renderHeader={(refreshButton) => (
                    <div className="account-dialog__header">
                      <span>Manage Providers</span>
                      <div className="account-dialog__header-actions">
                        {refreshButton}
                        <Button
                          aria-label="Close connections window"
                          icon={<X />}
                          theme="transparent"
                          size="small"
                          callback={() => onClose?.()}
                        />
                      </div>
                    </div>
                  )}
                />
              </section>
            </PopupWindow>
          </div>,
          document.body
        )}
    </>
  )
  return { label: selected?.name ?? (loading ? null : 'Providers'), dropdownProps, content }
}

export function SidebarOpenCodeProvider({
  container,
  available,
  ...picker
}: OpenCodeProviderProps): ReactElement {
  const { label, dropdownProps, content } = useSidebarOpenCodeProvider(picker, container, available)
  return (
    <div aria-label="Current OpenCode provider">
      <Dropdown
        {...dropdownProps}
        fill
        placement="top"
        valueLabel={label ?? 'Providers'}
        valueContent={
          <>
            <span className="ui-dropdown__value-icon" aria-hidden="true">
              <ProviderIcon providerId="opencode" />
            </span>
            <span className="ui-dropdown__value-label">{label ?? 'Providers'}</span>
          </>
        }
      />
      {content}
    </div>
  )
}
