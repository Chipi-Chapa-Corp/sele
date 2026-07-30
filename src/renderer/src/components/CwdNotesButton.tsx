import { Plus, StickyNote, X } from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import type { ProviderCwdNote } from '../../../shared/provider'
import { Button, ButtonMenuRow } from './Button'
import { Input } from './Input'
import './CwdNotesButton.css'

type CwdNotesButtonProps = {
  label: string
  notes: ProviderCwdNote[]
  onNotesChange: (notes: ProviderCwdNote[]) => void
}

const createNoteId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const getNotesMenuStyle = (buttonRect: DOMRect): CSSProperties => {
  const viewportInset = 12
  const menuOffset = 6
  const menuWidth = Math.min(360, window.innerWidth - viewportInset * 2)
  const bottomSpace = window.innerHeight - buttonRect.bottom
  const openUp = bottomSpace < 260 && buttonRect.top > bottomSpace
  const nextMenuStyle: CSSProperties = {
    width: menuWidth,
    right: Math.max(viewportInset, window.innerWidth - buttonRect.right)
  }

  if (openUp) {
    nextMenuStyle.bottom = window.innerHeight - buttonRect.top + menuOffset
  } else {
    nextMenuStyle.top = buttonRect.bottom + menuOffset
  }

  return nextMenuStyle
}

export const CwdNotesButton: React.FC<CwdNotesButtonProps> = ({ label, notes, onNotesChange }) => {
  const reactId = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollAfterAddRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const [draft, setDraft] = useState('')
  const menuId = `cwd-notes-menu-${reactId}`

  const closeMenu = useCallback((): void => {
    setOpen(false)
    setMenuStyle(null)
  }, [])

  const updateMenuPosition = useCallback((): void => {
    const buttonRect = rootRef.current?.getBoundingClientRect()

    if (!buttonRect || buttonRect.bottom < 0 || buttonRect.top > window.innerHeight) {
      closeMenu()
      return
    }

    setMenuStyle(getNotesMenuStyle(buttonRect))
  }, [closeMenu])

  const openMenu = (): void => {
    const buttonRect = rootRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getNotesMenuStyle(buttonRect))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    inputRef.current?.focus({ preventScroll: true })

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node

      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu()
      }
    }

    const handleResize = (): void => updateMenuPosition()
    const handleScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return

      updateMenuPosition()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [closeMenu, open, updateMenuPosition])

  useLayoutEffect(() => {
    if (!scrollAfterAddRef.current) return

    scrollAfterAddRef.current = false
    const items = itemsRef.current
    if (items) items.scrollTop = items.scrollHeight
  }, [notes])

  const handleAddNote = (): void => {
    const text = draft.trim()
    if (!text) return

    scrollAfterAddRef.current = true
    onNotesChange([
      ...notes,
      {
        id: createNoteId(),
        text,
        createdAt: Date.now()
      }
    ])
    setDraft('')
    inputRef.current?.focus({ preventScroll: true })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    handleAddNote()
  }

  const handleRemoveNote = (noteId: string): void => {
    onNotesChange(notes.filter((note) => note.id !== noteId))
  }

  const menu = (
    <div
      ref={menuRef}
      className="cwd-notes-menu"
      hidden={!open}
      id={menuId}
      role="dialog"
      aria-label={`${label} notes`}
      style={menuStyle ?? undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return

        event.preventDefault()
        closeMenu()
      }}
    >
      <div ref={itemsRef} className="cwd-notes-menu__items">
        {notes.length === 0 ? (
          <p className="cwd-notes-menu__empty">No notes yet</p>
        ) : (
          notes.map((note) => (
            <ButtonMenuRow
              className="cwd-notes-menu__item"
              inlineActions={[
                {
                  id: `remove-${note.id}`,
                  ariaLabel: 'Remove note',
                  title: 'Remove note',
                  callback: () => handleRemoveNote(note.id),
                  icon: <X aria-hidden="true" />
                }
              ]}
              key={note.id}
              label={note.text}
              labelClassName="cwd-notes-menu__text"
              title={note.text}
            />
          ))
        )}
      </div>
      <form className="cwd-notes-menu__form" onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          value={draft}
          maxLength={1000}
          placeholder="Add note"
          aria-label={`Add note to ${label}`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          theme="secondary"
          aria-label="Add note"
          title="Add note"
          callback={handleAddNote}
          disabled={!draft.trim()}
          icon={<Plus aria-hidden="true" />}
        />
      </form>
    </div>
  )

  return (
    <span className="cwd-notes" ref={rootRef}>
      <Button
        theme="secondary"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={`${label} notes`}
        title={notes.length > 0 ? `${notes.length} notes` : 'Notes'}
        callback={() => {
          if (open) closeMenu()
          else openMenu()
        }}
        icon={<StickyNote aria-hidden="true" />}
      />
      {createPortal(menu, document.body)}
    </span>
  )
}
