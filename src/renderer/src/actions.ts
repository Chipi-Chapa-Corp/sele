export const appActionIconIds = [
  'play',
  'terminal',
  'package',
  'git',
  'refresh',
  'search',
  'gauge',
  'blocks',
  'sparkles',
  'zap'
] as const

export type AppActionIcon = (typeof appActionIconIds)[number]

export const appActionTypes = ['command', 'prompt'] as const

export type AppActionType = (typeof appActionTypes)[number]

export const appActionScopes = ['global', 'project'] as const

export type AppActionScope = (typeof appActionScopes)[number]

type AppActionBase = {
  id: string
  name: string
  icon: AppActionIcon
  keybinding: string | null
  scope: AppActionScope
  projectCwd: string | null
}

export type AppCommandAction = AppActionBase & {
  type: 'command'
  command: string
  openInTerminal: boolean
  closeTerminalOnFinish: boolean
}

export type AppPromptAction = AppActionBase & {
  type: 'prompt'
  prompt: string
  sendInNewChat: boolean
}

export type AppAction = AppCommandAction | AppPromptAction

type KeyboardEventLike = {
  altKey: boolean
  code: string
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

const modifierKeys = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift', 'OS', 'Fn', 'FnLock'])
const maxActionCount = 100
const maxActionIdLength = 128
const maxActionNameLength = 80
const maxActionContentLength = 20_000
const maxActionKeybindingLength = 80
const maxActionProjectCwdLength = 4_096

export const defaultAppActionIcon = 'play' satisfies AppActionIcon

export const isAppActionIcon = (value: unknown): value is AppActionIcon =>
  appActionIconIds.includes(value as AppActionIcon)

const normalizeActionString = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''

const getKeyboardEventKeyLabel = (event: KeyboardEventLike): string | null => {
  if (modifierKeys.has(event.key)) return null

  if (event.code.startsWith('Key') && event.code.length === 4) return event.code.slice(3)
  if (event.code.startsWith('Digit') && event.code.length === 6) return event.code.slice(5)
  if (/^F\d{1,2}$/.test(event.key)) return event.key

  if (event.key === ' ') return 'Space'
  if (event.key.startsWith('Arrow')) return event.key.replace(/^Arrow/, '')
  if (event.key.length === 1) return event.key.toLocaleUpperCase()

  return event.key || null
}

export const getAppActionKeybindingFromEvent = (event: KeyboardEventLike): string | null => {
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return null

  const key = getKeyboardEventKeyLabel(event)
  if (!key) return null

  return [
    event.ctrlKey ? 'Ctrl' : null,
    event.metaKey ? 'Meta' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    key
  ]
    .filter(Boolean)
    .join('+')
}

export const getAppActionsForProject = (
  actions: AppAction[],
  projectCwd: string | null | undefined
): AppAction[] => {
  const normalizedProjectCwd = normalizeActionString(projectCwd, maxActionProjectCwdLength)

  return actions.filter(
    (action) =>
      action.scope === 'global' ||
      (Boolean(normalizedProjectCwd) && action.projectCwd === normalizedProjectCwd)
  )
}

export const normalizeAppActions = (value: unknown): AppAction[] => {
  if (!Array.isArray(value)) return []

  const ids = new Set<string>()
  const keybindings = new Set<string>()
  const actions: AppAction[] = []

  for (let index = 0; index < value.length && actions.length < maxActionCount; index += 1) {
    const action = value[index]
    if (!action || typeof action !== 'object') continue

    const candidate = action as Record<string, unknown>
    const type: AppActionType = candidate.type === 'prompt' ? 'prompt' : 'command'
    const name = normalizeActionString(candidate.name, maxActionNameLength)
    const content = normalizeActionString(
      type === 'prompt' ? candidate.prompt : candidate.command,
      maxActionContentLength
    )
    if (!name || !content) continue

    let id = normalizeActionString(candidate.id, maxActionIdLength)
    if (!id) id = `${Date.now()}-${index}`
    if (ids.has(id)) id = `${id}-${index}`.slice(0, maxActionIdLength)
    ids.add(id)

    const keybinding = normalizeActionString(candidate.keybinding, maxActionKeybindingLength)
    const uniqueKeybinding = keybinding && !keybindings.has(keybinding) ? keybinding : null
    if (uniqueKeybinding) keybindings.add(uniqueKeybinding)
    const projectCwd = normalizeActionString(candidate.projectCwd, maxActionProjectCwdLength)
    const scope: AppActionScope = candidate.scope === 'project' && projectCwd ? 'project' : 'global'

    const normalizedAction = {
      id,
      name,
      icon: isAppActionIcon(candidate.icon) ? candidate.icon : defaultAppActionIcon,
      keybinding: uniqueKeybinding,
      scope,
      projectCwd: scope === 'project' ? projectCwd : null
    }

    if (type === 'prompt') {
      actions.push({
        ...normalizedAction,
        type,
        prompt: content,
        sendInNewChat: Boolean(candidate.sendInNewChat)
      })
    } else {
      const openInTerminal = Boolean(candidate.openInTerminal)
      actions.push({
        ...normalizedAction,
        type,
        command: content,
        openInTerminal,
        closeTerminalOnFinish: openInTerminal && Boolean(candidate.closeTerminalOnFinish)
      })
    }
  }

  return actions
}
