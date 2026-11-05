import { Brain, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

// Keep explicit choices with the chat item, including when a single tool becomes
// a sequence or an enclosing progress disclosure temporarily unmounts its rows.
export const WorkingDisclosureContext = createContext<Map<string, boolean> | null>(null)

export const useWorkingDisclosure = (
  id: string,
  defaultOpen: boolean,
  fallbackId?: string
): [boolean, (open: boolean) => void] => {
  const choices = useContext(WorkingDisclosureContext)
  const [choice, setChoice] = useState(() => ({
    id,
    open: choices?.get(id) ?? (fallbackId ? choices?.get(fallbackId) : undefined)
  }))
  const open = (choice.id === id ? choice.open : choices?.get(id)) ?? defaultOpen
  return [
    open,
    (nextOpen) => {
      choices?.set(id, nextOpen)
      setChoice({ id, open: nextOpen })
    }
  ]
}

export const ThoughtRow: React.FC<{
  id: string
  streaming: boolean
  onDisclosureToggle?: () => void
  children: ReactNode
}> = ({ id, streaming, onDisclosureToggle, children }) => {
  const [open, setOpen] = useWorkingDisclosure(`thought:${id}`, false)

  return (
    <details className="chat-detail__tool-group chat-detail__thought" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault()
          setOpen(!open)
          onDisclosureToggle?.()
        }}
      >
        <span className="chat-detail__tool-icon">
          <Brain aria-hidden="true" />
        </span>
        <span className="chat-detail__tool-label">{streaming ? 'Thinking' : 'Thought'}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div
          className="chat-detail__thought-content"
          role="region"
          aria-label="Thought text"
          tabIndex={0}
        >
          {children}
        </div>
      )}
    </details>
  )
}
