import { ChevronDown } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Dropdown, type DropdownMenuAction } from './Dropdown'

/** Rows need a trigger immediately; menu hooks and actions only after interaction. */
export function ActionMenu({
  label,
  className,
  content,
  disabled = false,
  actions
}: {
  label: string
  className?: string
  content: ReactNode
  disabled?: boolean
  actions: () => readonly DropdownMenuAction[]
}): React.JSX.Element {
  const [activated, setActivated] = useState(false)
  const host = useRef<HTMLSpanElement>(null)
  const focusTrigger = useRef(false)
  const id = `action-menu-${useId().replace(/:/g, '')}`
  useLayoutEffect(() => {
    if (!activated) return
    const button = host.current?.querySelector('button')
    if (focusTrigger.current) button?.focus({ preventScroll: true })
    button?.click()
  }, [activated])
  return (
    <span ref={host} style={{ display: 'contents' }}>
      {activated ? (
        <Dropdown
          className={className}
          appearance="inline"
          size="small"
          menuAlign="end"
          value=""
          aria-label={label}
          title={label}
          listboxId={id}
          valueContent={content}
          disabled={disabled}
          menuActions={actions()}
          onChange={() => {}}
        />
      ) : (
        <div
          className={`ui-dropdown ui-dropdown--inline ui-dropdown--bottom ui-dropdown--small ui-dropdown--menu-end ui-dropdown--value-label${disabled ? ' ui-dropdown--disabled' : ''}${className ? ` ${className}` : ''}`}
        >
          <button
            type="button"
            className="ui-dropdown__trigger"
            role="combobox"
            aria-label={label}
            title={label}
            aria-controls={id}
            aria-expanded={false}
            aria-haspopup="listbox"
            disabled={disabled}
            onClick={(event) => {
              focusTrigger.current = event.currentTarget === document.activeElement
              setActivated(true)
            }}
            onKeyDown={(event) => {
              if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
              event.preventDefault()
              focusTrigger.current = true
              setActivated(true)
            }}
          >
            <span className="ui-dropdown__value">{content}</span>
            <ChevronDown className="ui-dropdown__chevron" aria-hidden="true" />
          </button>
        </div>
      )}
    </span>
  )
}
