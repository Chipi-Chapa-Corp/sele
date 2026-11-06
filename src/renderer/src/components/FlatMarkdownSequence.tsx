import { memo, useLayoutEffect, useRef } from 'react'
import { scheduleChatTurnMount } from '../chatMountQueue'
import { patchMarkdownFragment } from '../markdownDomPatch'
import { sanitizedFragment } from '../markdownFragment'

type Leaf = { html: string }
type Part = { source: Leaf; host: HTMLDivElement; fragment: DocumentFragment }

// The DOM stays split into bounded parts. A single React boundary owns the run,
// so revealing a cached transcript does not reconnect effects for every part.
export const FlatMarkdownSequence = memo(function FlatMarkdownSequence({
  leaves,
  priority,
  eager,
  sanitized,
  onCommit
}: {
  leaves: Leaf[]
  priority: number
  eager: boolean
  sanitized: boolean
  onCommit: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const committed = useRef<{ host: HTMLDivElement; parts: Part[] } | null>(null)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    if (committed.current?.host !== host) committed.current = { host, parts: [] }
    const parts = committed.current.parts
    let changed = false
    while (parts.length > leaves.length) {
      parts.pop()!.host.remove()
      changed = true
    }
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      const source = leaves[index]
      if (part.source === source) continue
      if (part.source.html !== source.html) {
        const fragment = sanitizedFragment(source.html, 'div', sanitized)
        patchMarkdownFragment(part.host, part.fragment, fragment)
        part.fragment = fragment
        changed = true
      }
      part.source = source
    }
    const mount = (): void => {
      const source = leaves[parts.length]
      const fragment = sanitizedFragment(source.html, 'div', sanitized)
      const node = document.createElement('div')
      node.className = 'chat-detail__markdown-part'
      patchMarkdownFragment(node, null, fragment)
      host.append(node)
      parts.push({ source, host: node, fragment })
      changed = true
    }
    // The first readable part belongs to the reveal commit. Further parts get
    // a paint opportunity just as they did with DeferredChatTurn.
    if (eager) while (parts.length < leaves.length) mount()
    else if (!parts.length && leaves.length) mount()
    if (changed) onCommit()

    let current = true
    let cancel: (() => void) | null = null
    const schedule = (): void => {
      if (parts.length >= leaves.length) return
      cancel = scheduleChatTurnMount((complete) => {
        if (current) {
          mount()
          onCommit()
        }
        complete()
        if (current) schedule()
      }, priority + parts.length)
    }
    schedule()
    return () => {
      current = false
      cancel?.()
    }
  }, [leaves, priority, eager, sanitized, onCommit])
  return <div ref={ref} className="chat-detail__markdown-sequence" />
})
