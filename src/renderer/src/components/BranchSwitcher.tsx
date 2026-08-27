import { Check, ChevronDown, GitBranch, Plus, X } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { toCssRem } from '../cssUnits'
import { Button, ButtonMenuRow } from './Button'
import { Input } from './Input'
import './BranchSwitcher.css'

type BranchSwitcherProps = {
  branches: readonly string[]
  busy?: boolean
  canForceDelete?: boolean
  currentBranch: string | null
  deleteWorktreePath?: string | null
  disabled?: boolean
  error?: string | null
  errorActions?: ReactNode
  id?: string
  loading?: boolean
  onClearError?: () => void
  onDelete: (branchName: string) => Promise<void>
  onDeleteWorktree?: () => Promise<void>
  onForceDelete?: () => Promise<void>
  onOpen?: () => void
  onSwitch: (branchName: string, create: boolean) => Promise<boolean>
}

type BranchMenuItem =
  | {
      key: string
      kind: 'branch'
      name: string
    }
  | {
      key: 'create'
      kind: 'create'
      name: string
    }

const maxVisibleBranches = 5

const isValidBranchName = (name: string): boolean => {
  if (!name || name === '@' || name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) {
    return false
  }
  if (
    name.endsWith('.') ||
    name.includes('..') ||
    name.includes('@{') ||
    name.includes('//') ||
    /[ ~^:?*[\]\\]/.test(name) ||
    Array.from(name).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 32 || codePoint === 127
    })
  ) {
    return false
  }

  return name
    .split('/')
    .every(
      (part) =>
        part && part !== '.' && part !== '..' && !part.startsWith('.') && !part.endsWith('.lock')
    )
}

const getMenuStyle = (buttonRect: DOMRect): CSSProperties => {
  const viewportInset = 9.6
  const menuOffset = 4.8
  const width = Math.min(
    Math.max(buttonRect.width, 224),
    Math.max(0, window.innerWidth - viewportInset * 2)
  )
  const left = Math.min(
    Math.max(viewportInset, buttonRect.left),
    Math.max(viewportInset, window.innerWidth - width - viewportInset)
  )

  return {
    left: toCssRem(left),
    top: toCssRem(buttonRect.bottom + menuOffset),
    width: toCssRem(width)
  }
}

export const BranchSwitcher: React.FC<BranchSwitcherProps> = ({
  branches,
  busy = false,
  canForceDelete = false,
  currentBranch,
  deleteWorktreePath = null,
  disabled = false,
  error = null,
  errorActions = null,
  id,
  loading = false,
  onClearError,
  onDelete,
  onDeleteWorktree,
  onForceDelete,
  onOpen,
  onSwitch
}) => {
  const reactId = useId().replace(/:/g, '')
  const buttonId = id ?? `branch-switcher-${reactId}`
  const listboxId = `${buttonId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const switchInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<'delete' | 'switch' | 'worktree' | null>(null)
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const queryName = query.trim()
  const normalizedQuery = queryName.toLocaleLowerCase()
  const availableBranches = currentBranch
    ? [currentBranch, ...branches.filter((branch) => branch !== currentBranch)]
    : branches
  const filteredBranches = (
    normalizedQuery
      ? availableBranches.filter((branch) => branch.toLocaleLowerCase().includes(normalizedQuery))
      : availableBranches
  ).slice(0, maxVisibleBranches)
  const canCreate =
    isValidBranchName(queryName) && !availableBranches.some((branch) => branch === queryName)
  const menuItems = filteredBranches.map((name): BranchMenuItem => ({
    key: `branch:${name}`,
    kind: 'branch',
    name
  }))
  if (canCreate) {
    menuItems.push({
      key: 'create',
      kind: 'create',
      name: queryName
    })
  }
  const currentBranchKey = currentBranch ? `branch:${currentBranch}` : null
  const defaultActiveKey =
    !normalizedQuery && currentBranchKey && menuItems.some((item) => item.key === currentBranchKey)
      ? currentBranchKey
      : (menuItems[0]?.key ?? null)
  const effectiveActiveKey =
    activeKey && menuItems.some((item) => item.key === activeKey) ? activeKey : defaultActiveKey
  const activeIndex = menuItems.findIndex((item) => item.key === effectiveActiveKey)
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined

  const closeMenu = useCallback((focusTrigger = false): void => {
    setOpen(false)
    setQuery('')
    setActiveKey(null)
    setMenuStyle(null)
    if (focusTrigger) buttonRef.current?.focus({ preventScroll: true })
  }, [])

  const openMenu = (): void => {
    if (disabled || typeof window === 'undefined') return

    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    onClearError?.()
    onOpen?.()
    setQuery('')
    setActiveKey(currentBranchKey)
    setMenuStyle(getMenuStyle(buttonRect))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    inputRef.current?.focus({ preventScroll: true })

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node

      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu()
    }
    const handleResize = (): void => closeMenu()
    const handleScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return

      closeMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [closeMenu, open])

  const selectItem = async (item: BranchMenuItem): Promise<void> => {
    if (busy || switchInFlightRef.current) return

    switchInFlightRef.current = true
    setBusyAction('switch')

    try {
      const switched = await onSwitch(item.name, item.kind === 'create')
      if (switched) closeMenu(true)
    } finally {
      switchInFlightRef.current = false
      setBusyAction(null)
    }
  }

  const deleteBranch = async (branchName: string): Promise<void> => {
    if (busy || deleteInFlightRef.current) return

    deleteInFlightRef.current = true
    setBusyAction('delete')
    onClearError?.()

    try {
      await onDelete(branchName)
    } finally {
      deleteInFlightRef.current = false
      setBusyAction(null)
    }
  }

  const forceDeleteBranch = async (): Promise<void> => {
    if (busy || deleteInFlightRef.current || !onForceDelete) return

    deleteInFlightRef.current = true
    setBusyAction('delete')

    try {
      await onForceDelete()
    } finally {
      deleteInFlightRef.current = false
      setBusyAction(null)
    }
  }

  const deleteWorktree = async (): Promise<void> => {
    if (busy || deleteInFlightRef.current || !onDeleteWorktree) return

    deleteInFlightRef.current = true
    setBusyAction('worktree')

    try {
      await onDeleteWorktree()
    } finally {
      deleteInFlightRef.current = false
      setBusyAction(null)
    }
  }

  const moveActiveItem = (direction: 1 | -1): void => {
    if (menuItems.length === 0) return

    const nextIndex =
      activeIndex < 0
        ? direction === 1
          ? 0
          : menuItems.length - 1
        : (activeIndex + direction + menuItems.length) % menuItems.length

    setActiveKey(menuItems[nextIndex].key)
    document
      .getElementById(`${listboxId}-option-${nextIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const menu = open ? (
    <div
      ref={menuRef}
      className="branch-switcher__menu"
      style={menuStyle ?? undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return

        event.preventDefault()
        event.stopPropagation()
        closeMenu(true)
      }}
    >
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-activedescendant={activeOptionId}
        aria-controls={listboxId}
        aria-expanded="true"
        aria-label="Search branches"
        autoComplete="off"
        disabled={busy}
        placeholder="Search branches"
        value={query}
        onChange={(event) => {
          onClearError?.()
          setQuery(event.target.value)
          setActiveKey(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            moveActiveItem(event.key === 'ArrowDown' ? 1 : -1)
            return
          }

          if (event.key === 'Home' || event.key === 'End') {
            if (menuItems.length === 0) return
            event.preventDefault()
            setActiveKey(
              event.key === 'Home' ? menuItems[0].key : menuItems[menuItems.length - 1].key
            )
            return
          }

          if (event.key === 'Enter') {
            const activeItem = menuItems[activeIndex]
            if (!activeItem) return
            event.preventDefault()
            void selectItem(activeItem)
          }
        }}
      />
      <div className="branch-switcher__list" id={listboxId} role="listbox">
        {menuItems.map((item, index) => {
          const selected = item.kind === 'branch' && item.name === currentBranch

          return (
            <ButtonMenuRow
              className={[
                'branch-switcher__option-row',
                item.key === effectiveActiveKey ? 'branch-switcher__option-row--active' : null,
                item.kind === 'create' ? 'branch-switcher__option-row--create' : null
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={busy}
              endAdornment={
                selected ? <Check className="branch-switcher__option-check" /> : undefined
              }
              icon={item.kind === 'create' ? <Plus /> : <GitBranch />}
              inlineActions={
                item.kind === 'branch'
                  ? [
                      {
                        id: `delete-${item.name}`,
                        ariaLabel: `Delete ${item.name}`,
                        callback: () => deleteBranch(item.name),
                        icon: <X aria-hidden="true" />,
                        title: `Delete ${item.name}`
                      }
                    ]
                  : []
              }
              key={item.key}
              label={
                item.kind === 'create' ? (
                  <>
                    Create <strong>{item.name}</strong> and switch
                  </>
                ) : (
                  item.name
                )
              }
              labelClassName="branch-switcher__option-label"
              mainAriaSelected={selected}
              mainId={`${listboxId}-option-${index}`}
              mainRole="option"
              onSelect={() => selectItem(item)}
              title={item.name}
              onMouseEnter={() => setActiveKey(item.key)}
            />
          )
        })}
        {loading && menuItems.length === 0 && (
          <p className="branch-switcher__message">Loading branches…</p>
        )}
        {!loading && menuItems.length === 0 && !queryName && (
          <p className="branch-switcher__message">No local branches found.</p>
        )}
        {!loading && menuItems.length === 0 && queryName && (
          <p className="branch-switcher__message">
            {isValidBranchName(queryName)
              ? 'No matching branches.'
              : 'Enter a valid Git branch name.'}
          </p>
        )}
      </div>
      {busy && (
        <p className="branch-switcher__status">
          {busyAction === 'worktree'
            ? 'Deleting worktree…'
            : busyAction === 'delete'
              ? 'Deleting branch…'
              : 'Switching branch…'}
        </p>
      )}
      {error && (
        <div className="branch-switcher__error" role="status">
          {error}
        </div>
      )}
      {error && (canForceDelete || deleteWorktreePath || errorActions) && (
        <div className="branch-switcher__error-actions">
          {canForceDelete && onForceDelete && (
            <Button
              theme="secondary"
              disabled={busy}
              label="Force Delete"
              callback={forceDeleteBranch}
            />
          )}
          {deleteWorktreePath && onDeleteWorktree && (
            <Button
              theme="secondary"
              disabled={busy}
              label="Delete Worktree"
              title={`Delete worktree at ${deleteWorktreePath}`}
              callback={deleteWorktree}
            />
          )}
          {errorActions}
        </div>
      )}
    </div>
  ) : null

  return (
    <div
      className={[
        'branch-switcher',
        open ? 'branch-switcher--open' : null,
        disabled ? 'branch-switcher--disabled' : null
      ]
        .filter(Boolean)
        .join(' ')}
      ref={rootRef}
    >
      <button
        ref={buttonRef}
        className="branch-switcher__trigger"
        id={buttonId}
        type="button"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        title={currentBranch ?? 'No branch'}
        onClick={() => {
          if (open) closeMenu()
          else openMenu()
        }}
      >
        <span className="branch-switcher__value">
          <GitBranch aria-hidden="true" />
          <span>{currentBranch ?? 'No branch'}</span>
        </span>
        <ChevronDown className="branch-switcher__chevron" aria-hidden="true" />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  )
}
