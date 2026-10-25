import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { scheduleChatTurnMount } from '../chatMountQueue'

// Show the latest turn immediately, then mount the earlier loaded turns one at
// a time. Keep their existing keys/order and retain all subsequent live updates.
export function DeferredChatTurn({
  children,
  eager,
  priority,
  onMount
}: {
  children: ReactNode
  eager: boolean
  priority: number
  onMount?: () => void
}): ReactNode {
  const [mounted, setMounted] = useState(eager)
  const wasShown = useRef(mounted)
  const notifiedMount = useRef(false)
  const complete = useRef<(() => void) | null>(null)
  const ready = eager || mounted || wasShown.current
  useLayoutEffect(() => {
    if (!ready) return
    wasShown.current = true
    // Correct the viewport in this commit; a ResizeObserver may run after the
    // compositor has already prepared a frame for the newly inserted history.
    // Activity reconnects effects when a cached chat is revealed. Its DOM is
    // already mounted; replaying every turn/item's correction forces repeated
    // layouts during a single chat switch. Selection owns the reveal scroll.
    if (!notifiedMount.current) {
      notifiedMount.current = true
      onMount?.()
    }
    complete.current?.()
    complete.current = null
  }, [ready, onMount])
  useEffect(() => {
    if (ready) return
    return scheduleChatTurnMount((done) => {
      complete.current = done
      startTransition(() => setMounted(true))
    }, priority)
  }, [ready, priority])
  return ready ? children : null
}
