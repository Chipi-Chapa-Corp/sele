import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronUp, Minus } from 'lucide-react'
import './ChatPlan.css'

export type ChatPlanItem = {
  status: 'pending' | 'in_progress' | 'completed'
  step: string
}

export type ChatPlanData = {
  contextKey: string
  explanation: string | null
  items: ChatPlanItem[]
  signature: string
}

type ChatPlanProps = {
  plan: ChatPlanData | null
}

export const ChatPlan: React.FC<ChatPlanProps> = ({ plan }) => {
  const drawerId = useId().replace(/:/g, '')
  const [openContextKey, setOpenContextKey] = useState<string | null>(null)
  const [seenSignatures, setSeenSignatures] = useState<Record<string, string>>({})
  const controlRef = useRef<HTMLElement>(null)
  const open = Boolean(plan && openContextKey === plan.contextKey)
  const updated = plan !== null && !open && seenSignatures[plan.contextKey] !== plan.signature

  useEffect(() => {
    if (!plan || !open) return

    let active = true
    const contextKey = plan.contextKey
    const signature = plan.signature

    queueMicrotask(() => {
      if (!active) return
      setSeenSignatures((currentSignatures) =>
        currentSignatures[contextKey] === signature
          ? currentSignatures
          : { ...currentSignatures, [contextKey]: signature }
      )
    })

    return () => {
      active = false
    }
  }, [open, plan])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && controlRef.current?.contains(target)) return

      setOpenContextKey(null)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenContextKey(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!plan) return null

  const completedItemCount = plan.items.filter((item) => item.status === 'completed').length
  const currentItem =
    plan.items.find((item) => item.status === 'in_progress') ??
    plan.items.find((item) => item.status === 'pending') ??
    null
  const progressLabel = `${completedItemCount} of ${plan.items.length} completed`

  return (
    <section className="chat-plan" ref={controlRef}>
      <button
        type="button"
        className="chat-plan__toggle"
        aria-controls={`chat-plan-${drawerId}`}
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} plan, ${progressLabel}${updated ? ', updated' : ''}`}
        title={open ? 'Hide plan' : 'Show plan'}
        onClick={() => setOpenContextKey(open ? null : plan.contextKey)}
      >
        <span className="chat-plan__title">
          <span>Plan</span>
          {updated && <span className="chat-plan__updated-dot" aria-hidden="true" />}
        </span>
        {currentItem && (
          <span className="chat-plan__current" aria-hidden="true">
            {currentItem.step}
          </span>
        )}
        <span className="chat-plan__progress" aria-hidden="true">
          {completedItemCount}/{plan.items.length}
        </span>
        <ChevronUp className="chat-plan__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="chat-plan__drawer"
          id={`chat-plan-${drawerId}`}
          role="region"
          aria-label="Plan items"
        >
          <ol className="chat-plan__list">
            {plan.items.map((item, index) => (
              <li
                className={`chat-plan__item chat-plan__item--${item.status}`}
                aria-current={item.status === 'in_progress' ? 'step' : undefined}
                key={`${item.step}:${index}`}
              >
                <span className="chat-plan__status" aria-hidden="true">
                  {item.status === 'completed' ? (
                    <Check />
                  ) : item.status === 'in_progress' ? (
                    <ArrowRight />
                  ) : (
                    <Minus />
                  )}
                </span>
                <span className="sr-only">
                  {item.status === 'completed'
                    ? 'Completed: '
                    : item.status === 'in_progress'
                      ? 'In progress: '
                      : 'Pending: '}
                </span>
                <span>{item.step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
