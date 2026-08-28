import type { RefObject } from 'react'
import { Blocks, Gauge, GitBranch, Globe2, MessageSquare, Sun, X } from 'lucide-react'
import { version as appVersion } from '../../../../package.json'
import { Button } from './Button'
import { SegmentedControl } from './SegmentedControl'
import { renderSettingsPanel, type SettingsPanelProps, type SettingsTab } from './SettingsPanel'

export type SettingsScope = 'global' | 'project'

const settingsTabOptions = [
  {
    value: 'appearance',
    label: 'Appearance',
    icon: <Sun aria-hidden="true" />
  },
  {
    value: 'chat',
    label: 'Chat',
    icon: <MessageSquare aria-hidden="true" />
  },
  {
    value: 'providers',
    label: 'Providers',
    icon: <Blocks aria-hidden="true" />
  },
  {
    value: 'browser',
    label: 'Browser',
    icon: <Globe2 aria-hidden="true" />
  },
  {
    value: 'performance',
    label: 'Performance',
    icon: <Gauge aria-hidden="true" />
  },
  {
    value: 'git',
    label: 'Git',
    icon: <GitBranch aria-hidden="true" />
  }
] satisfies readonly {
  value: SettingsTab
  label: string
  icon: React.ReactNode
}[]

type SettingsDialogProps = {
  closeButtonRef: RefObject<HTMLButtonElement | null>
  open: boolean
  panelProps: SettingsPanelProps
  projectCwd: string | null
  projectLabel: string
  tab: SettingsTab
  viewIsProject: boolean
  onClose: () => void
  onScopeChange: (scope: SettingsScope) => void
  onTabChange: (tab: SettingsTab) => void
}

export const SettingsDialog = ({
  closeButtonRef,
  open,
  panelProps,
  projectCwd,
  projectLabel,
  tab,
  viewIsProject,
  onClose,
  onScopeChange,
  onTabChange
}: SettingsDialogProps): React.ReactElement | null => {
  if (!open) return null

  return (
    <div
      className="settings-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <aside className="settings-dialog__sidebar">
          <div className="settings-dialog__sidebar-top">
            <h2>Settings</h2>
            <Button
              ref={closeButtonRef}
              aria-label="Close settings"
              callback={onClose}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="transparent"
              title="Close settings"
            />
          </div>
          <nav
            className="settings-dialog__nav"
            aria-label="Settings sections"
            aria-orientation="vertical"
            role="tablist"
          >
            {settingsTabOptions.map((option, index) => {
              const selected = option.value === tab

              return (
                <button
                  className={`settings-dialog__nav-item${
                    selected ? ' settings-dialog__nav-item--active' : ''
                  }`}
                  id={`settings-tab-${option.value}`}
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-controls={`settings-panel-${option.value}`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onTabChange(option.value)}
                  onKeyDown={(event) => {
                    let nextIndex: number | null = null
                    if (event.key === 'ArrowDown') {
                      nextIndex = (index + 1) % settingsTabOptions.length
                    } else if (event.key === 'ArrowUp') {
                      nextIndex =
                        (index - 1 + settingsTabOptions.length) % settingsTabOptions.length
                    } else if (event.key === 'Home') {
                      nextIndex = 0
                    } else if (event.key === 'End') {
                      nextIndex = settingsTabOptions.length - 1
                    }
                    if (nextIndex === null) return

                    event.preventDefault()
                    const nextTab = settingsTabOptions[nextIndex]
                    onTabChange(nextTab.value)
                    document
                      .getElementById(`settings-tab-${nextTab.value}`)
                      ?.focus({ preventScroll: true })
                  }}
                >
                  <span className="settings-dialog__nav-icon" aria-hidden="true">
                    {option.icon}
                  </span>
                  <span>{option.label}</span>
                </button>
              )
            })}
          </nav>
          {tab !== 'providers' && (
            <div className="settings-dialog__scope">
              <SegmentedControl<SettingsScope>
                aria-label="Settings scope"
                className="settings-dialog__scope-switcher"
                options={[
                  { value: 'global', label: 'Global' },
                  {
                    value: 'project',
                    label: projectLabel,
                    disabled: !projectCwd,
                    title: projectCwd ?? 'No project selected'
                  }
                ]}
                size="small"
                value={viewIsProject ? 'project' : 'global'}
                onChange={(scope) => {
                  if (scope === 'project' && !projectCwd) return
                  onScopeChange(scope)
                }}
              />
            </div>
          )}
          <p className="settings-dialog__version">Sele v{appVersion}</p>
        </aside>
        <div className="settings-dialog__body">{renderSettingsPanel(panelProps)}</div>
      </section>
    </div>
  )
}
