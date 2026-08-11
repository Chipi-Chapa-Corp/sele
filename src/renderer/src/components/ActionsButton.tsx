import {
  Blocks,
  Check,
  Gauge,
  GitBranch,
  Package,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  X,
  Zap
} from 'lucide-react'
import {
  type ElementType,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import {
  appActionIconIds,
  type AppAction,
  type AppActionIcon,
  type AppActionScope,
  type AppActionType,
  defaultAppActionIcon,
  getAppActionsForProject,
  getAppActionKeybindingFromEvent,
  normalizeAppActions
} from '../actions'
import { Button, type ButtonDropdownAction } from './Button'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Input } from './Input'
import { SegmentedControl, type SegmentedControlOption } from './SegmentedControl'
import { Switch } from './Switch'
import { Textarea } from './Textarea'
import './ActionsButton.css'

type ActionsButtonProps = {
  actions: AppAction[]
  disabled?: boolean
  label: string
  lastActionId?: string | null
  projectCwd?: string | null
  showLabel?: boolean
  onActionsChange: (actions: AppAction[]) => void
  onLastActionChange: (actionId: string | null) => void
  onRunAction: (action: AppAction) => Promise<void> | void
}

type ActionDraft = {
  id: string | null
  content: string
  closeTerminalOnFinish: boolean
  icon: AppActionIcon
  keybinding: string | null
  name: string
  openInTerminal: boolean
  scope: AppActionScope
  sendInNewChat: boolean
  type: AppActionType
}

const actionIconComponents = {
  blocks: Blocks,
  gauge: Gauge,
  git: GitBranch,
  package: Package,
  play: Play,
  refresh: RefreshCw,
  search: Search,
  sparkles: Sparkles,
  terminal: Terminal,
  zap: Zap
} satisfies Record<AppActionIcon, ElementType>

const actionIconLabels = {
  blocks: 'Blocks',
  gauge: 'Gauge',
  git: 'Git',
  package: 'Package',
  play: 'Play',
  refresh: 'Refresh',
  search: 'Search',
  sparkles: 'Sparkles',
  terminal: 'Terminal',
  zap: 'Action'
} satisfies Record<AppActionIcon, string>

const emptyActionDraft: ActionDraft = {
  id: null,
  content: '',
  closeTerminalOnFinish: false,
  icon: defaultAppActionIcon,
  keybinding: null,
  name: '',
  openInTerminal: true,
  scope: 'global',
  sendInNewChat: false,
  type: 'command'
}

const createActionId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const getDraftFromAction = (action: AppAction | null, defaultScope: AppActionScope): ActionDraft =>
  action
    ? {
        id: action.id,
        content: action.type === 'prompt' ? action.prompt : action.command,
        closeTerminalOnFinish: action.type === 'command' ? action.closeTerminalOnFinish : false,
        icon: action.icon,
        keybinding: action.keybinding,
        name: action.name,
        openInTerminal: action.type === 'command' ? action.openInTerminal : true,
        scope: action.scope,
        sendInNewChat: action.type === 'prompt' ? action.sendInNewChat : false,
        type: action.type
      }
    : { ...emptyActionDraft, scope: defaultScope }

const renderActionIcon = (icon: AppActionIcon): ReactElement => {
  const Icon = actionIconComponents[icon]

  return <Icon aria-hidden="true" />
}

const actionIconOptions: DropdownOption<AppActionIcon>[] = appActionIconIds.map((icon) => ({
  value: icon,
  label: actionIconLabels[icon],
  icon: renderActionIcon(icon)
}))

const actionTypeOptions: SegmentedControlOption<AppActionType>[] = [
  { value: 'command', label: 'Command' },
  { value: 'prompt', label: 'Prompt' }
]

const getActionContent = (action: AppAction): string =>
  action.type === 'prompt' ? action.prompt : action.command

const renderActionMenuLabel = (action: AppAction): ReactNode => (
  <span className="cwd-actions-menu-label">
    <span className="cwd-actions-menu-label__name">{action.name}</span>
    {action.keybinding && <kbd>{action.keybinding}</kbd>}
  </span>
)

export const ActionsButton = ({
  actions,
  disabled = false,
  label,
  lastActionId = null,
  projectCwd = null,
  showLabel = false,
  onActionsChange,
  onLastActionChange,
  onRunAction
}: ActionsButtonProps): ReactElement => {
  const reactId = useId().replace(/:/g, '')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [runningActionId, setRunningActionId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [keybindingFocused, setKeybindingFocused] = useState(false)
  const nameInputId = `cwd-actions-name-${reactId}`
  const contentInputId = `cwd-actions-content-${reactId}`
  const keybindingDescriptionId = `cwd-actions-keybinding-description-${reactId}`
  const normalizedProjectCwd = projectCwd?.trim() || null
  const visibleActions = getAppActionsForProject(actions, normalizedProjectCwd)
  const primaryAction =
    visibleActions.find((action) => action.id === lastActionId) ?? visibleActions[0] ?? null
  const draftOpen = draft !== null
  const editing = Boolean(draft?.id)

  useEffect(() => {
    if (!draftOpen) return

    const frame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus({ preventScroll: true })
      nameInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [draftOpen])

  const openDraftDialog = (action: AppAction | null): void => {
    setDialogError(null)
    setDraft(getDraftFromAction(action, normalizedProjectCwd ? 'project' : 'global'))
  }

  const closeDraftDialog = (): void => {
    setDraft(null)
    setDialogError(null)
  }

  const updateDraft = (update: Partial<ActionDraft>): void => {
    setDraft((currentDraft) => (currentDraft ? { ...currentDraft, ...update } : currentDraft))
    setDialogError(null)
  }

  const handleSaveDraft = (): void => {
    if (!draft) return

    const name = draft.name.trim()
    const content = draft.content.trim()
    if (!name) {
      setDialogError('Name is required.')
      return
    }
    if (!content) {
      setDialogError(`${draft.type === 'prompt' ? 'Prompt' : 'Command'} is required.`)
      return
    }

    const duplicateKeybinding = draft.keybinding
      ? actions.find((action) => action.id !== draft.id && action.keybinding === draft.keybinding)
      : null
    if (duplicateKeybinding) {
      setDialogError(`${draft.keybinding} is already used by ${duplicateKeybinding.name}.`)
      return
    }

    const savedActionBase = {
      id: draft.id ?? createActionId(),
      icon: draft.icon,
      keybinding: draft.keybinding,
      name,
      scope: draft.scope,
      projectCwd: draft.scope === 'project' ? normalizedProjectCwd : null
    }
    const savedAction: AppAction =
      draft.type === 'prompt'
        ? {
            ...savedActionBase,
            type: 'prompt',
            prompt: content,
            sendInNewChat: draft.sendInNewChat
          }
        : {
            ...savedActionBase,
            type: 'command',
            command: content,
            closeTerminalOnFinish: draft.openInTerminal && draft.closeTerminalOnFinish,
            openInTerminal: draft.openInTerminal
          }
    const nextActions = draft.id
      ? actions.map((action) => (action.id === draft.id ? savedAction : action))
      : [...actions, savedAction]

    onActionsChange(normalizeAppActions(nextActions))
    closeDraftDialog()
  }

  const handleDraftSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    handleSaveDraft()
  }

  const handleDeleteAction = (actionId: string): void => {
    const nextActions = actions.filter((action) => action.id !== actionId)
    onActionsChange(nextActions)
    if (lastActionId === actionId) {
      onLastActionChange(getAppActionsForProject(nextActions, normalizedProjectCwd)[0]?.id ?? null)
    }
  }

  const handleRunAction = async (action: AppAction): Promise<void> => {
    if (runningActionId) return

    setActionError(null)
    setRunningActionId(action.id)
    try {
      await onRunAction(action)
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Unable to run action.'
      setActionError(message)
    } finally {
      setRunningActionId(null)
    }
  }

  const handlePrimaryAction = (): void => {
    if (!primaryAction) {
      openDraftDialog(null)
      return
    }

    void handleRunAction(primaryAction)
  }

  const handleKeybindingKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Backspace' || event.key === 'Delete') {
      updateDraft({ keybinding: null })
      return
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur()
      return
    }

    const nextKeybinding = getAppActionKeybindingFromEvent(event)
    if (nextKeybinding) updateDraft({ keybinding: nextKeybinding })
  }

  const dropdownActions: ButtonDropdownAction[] = [
    ...(actionError
      ? [
          {
            id: 'action-error',
            label: actionError,
            disabled: true,
            icon: <X aria-hidden="true" />,
            callback: () => {}
          }
        ]
      : []),
    ...visibleActions.map((action): ButtonDropdownAction => ({
      id: `run-${action.id}`,
      label: renderActionMenuLabel(action),
      title: getActionContent(action),
      disabled: Boolean(runningActionId),
      icon: renderActionIcon(action.icon),
      callback: () => handleRunAction(action),
      inlineActions: [
        {
          id: `edit-${action.id}`,
          ariaLabel: `Edit ${action.name}`,
          title: `Edit ${action.name}`,
          icon: <Pencil aria-hidden="true" />,
          callback: () => openDraftDialog(action)
        },
        {
          id: `delete-${action.id}`,
          ariaLabel: `Delete ${action.name}`,
          title: `Delete ${action.name}`,
          icon: <X aria-hidden="true" />,
          callback: () => handleDeleteAction(action.id)
        }
      ]
    })),
    {
      id: 'create-action',
      label: 'Create action',
      buttonTheme: 'secondary',
      icon: <Plus aria-hidden="true" />,
      callback: () => openDraftDialog(null)
    }
  ]

  const dialog = draft ? (
    <div
      className="cwd-actions-dialog-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeDraftDialog()
      }}
    >
      <form
        className="cwd-actions-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit action' : 'Create action'}
        onSubmit={handleDraftSubmit}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return

          event.preventDefault()
          closeDraftDialog()
        }}
      >
        <div className="cwd-actions-dialog__body">
          <div className="cwd-actions-dialog__field">
            <div className="cwd-actions-dialog__label-row">
              <label htmlFor={nameInputId}>Name</label>
              <Button
                theme="transparent"
                size="small"
                aria-label="Close action window"
                title="Close"
                callback={closeDraftDialog}
                icon={<X aria-hidden="true" />}
              />
            </div>
            <div className="cwd-actions-dialog__name-row">
              <Dropdown
                className="cwd-actions-dialog__icon-picker"
                aria-label="Action icon"
                menuAlign="start"
                options={actionIconOptions}
                title={`Icon: ${actionIconLabels[draft.icon]}`}
                value={draft.icon}
                onChange={(icon) => updateDraft({ icon })}
              />
              <Input
                id={nameInputId}
                ref={nameInputRef}
                value={draft.name}
                maxLength={80}
                onChange={(event) => updateDraft({ name: event.currentTarget.value })}
              />
            </div>
          </div>
          <div className="cwd-actions-dialog__field">
            <span>Create for</span>
            <SegmentedControl<AppActionScope>
              aria-label="Create for"
              className="cwd-actions-dialog__scope"
              options={[
                { value: 'global', label: 'Global' },
                {
                  value: 'project',
                  label,
                  disabled: !normalizedProjectCwd,
                  title: normalizedProjectCwd ?? 'No project selected'
                }
              ]}
              size="small"
              value={draft.scope}
              onChange={(scope) => updateDraft({ scope })}
            />
          </div>
          <label className="cwd-actions-dialog__field">
            <span>Keybinding</span>
            <button
              className="cwd-actions-dialog__keybinding"
              type="button"
              aria-describedby={keybindingDescriptionId}
              onBlur={() => setKeybindingFocused(false)}
              onFocus={() => setKeybindingFocused(true)}
              onKeyDown={handleKeybindingKeyDown}
            >
              {draft.keybinding ? (
                <kbd>{draft.keybinding}</kbd>
              ) : (
                <span>{keybindingFocused ? 'Recording' : 'Optional'}</span>
              )}
            </button>
            <span className="sr-only" id={keybindingDescriptionId}>
              Press a key combination. Press Backspace to remove the keybinding.
            </span>
          </label>
          <div className="cwd-actions-dialog__field">
            <SegmentedControl
              aria-label="Action type"
              className="cwd-actions-dialog__type"
              options={actionTypeOptions}
              size="small"
              value={draft.type}
              onChange={(type) => updateDraft({ type })}
            />
            <label className="sr-only" htmlFor={contentInputId}>
              {draft.type === 'prompt' ? 'Prompt' : 'Command'}
            </label>
            <Textarea
              id={contentInputId}
              className="cwd-actions-dialog__command"
              value={draft.content}
              rows={4}
              spellCheck={draft.type === 'prompt'}
              onChange={(event) => updateDraft({ content: event.currentTarget.value })}
            />
          </div>
          {draft.type === 'prompt' ? (
            <Switch
              className="cwd-actions-dialog__switch-row"
              label="Send in a new chat"
              checked={draft.sendInNewChat}
              onChange={(event) => updateDraft({ sendInNewChat: event.currentTarget.checked })}
            />
          ) : (
            <>
              <Switch
                className="cwd-actions-dialog__switch-row"
                label="Open in terminal"
                checked={draft.openInTerminal}
                onChange={(event) =>
                  updateDraft({
                    openInTerminal: event.currentTarget.checked,
                    closeTerminalOnFinish:
                      event.currentTarget.checked && draft.closeTerminalOnFinish
                  })
                }
              />
              <Switch
                className="cwd-actions-dialog__switch-row"
                label="Close terminal on finish"
                disabled={!draft.openInTerminal}
                checked={draft.openInTerminal && draft.closeTerminalOnFinish}
                onChange={(event) =>
                  updateDraft({ closeTerminalOnFinish: event.currentTarget.checked })
                }
              />
            </>
          )}
          {dialogError && (
            <p className="cwd-actions-dialog__error" role="alert">
              {dialogError}
            </p>
          )}
        </div>
        <footer className="cwd-actions-dialog__footer">
          <Button theme="secondary" label="Cancel" callback={closeDraftDialog} />
          <Button theme="primary" label="Save" callback={handleSaveDraft} icon={<Check />} />
        </footer>
      </form>
    </div>
  ) : null

  return (
    <span className="cwd-actions">
      <Button
        theme="secondary"
        aria-label={primaryAction ? `Run ${primaryAction.name}` : `${label} actions`}
        title={primaryAction ? primaryAction.name : 'Create action'}
        disabled={disabled || Boolean(runningActionId)}
        dropdownActions={dropdownActions}
        dropdownLabel="Actions"
        dropdownMenuAlign="end"
        dropdownPlacement="top"
        callback={handlePrimaryAction}
        icon={
          primaryAction
            ? renderActionIcon(primaryAction.icon)
            : renderActionIcon(defaultAppActionIcon)
        }
        label={showLabel && primaryAction ? primaryAction.name : null}
      />
      {dialog && createPortal(dialog, document.body)}
    </span>
  )
}
