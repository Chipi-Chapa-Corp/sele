import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DeferredChatTurn } from './DeferredChatTurn'

export type InitialSidebarMount = { deferred: boolean; pending: number; completed: boolean }

// New filter results can replace a viewport of expensive rows. Mount that
// batch between paints; afterward ordinary scrolling mounts rows immediately.
export function InitialSidebarRow({
  policy,
  priority,
  children
}: {
  policy: InitialSidebarMount
  priority: number
  children: ReactNode
}): ReactNode {
  const [deferred] = useState(policy.deferred)
  const pending = useRef(false)
  const mounted = useRef(false)
  const release = useCallback(() => {
    if (!pending.current) return
    pending.current = false
    policy.pending--
    if (policy.completed && policy.pending === 0) policy.deferred = false
  }, [policy])
  useLayoutEffect(() => {
    if (!deferred || mounted.current) return
    pending.current = true
    policy.pending++
    return release
  }, [deferred, policy, release])
  const onMount = useCallback(() => {
    if (!deferred || mounted.current) return
    mounted.current = true
    policy.completed = true
    release()
  }, [deferred, policy, release])
  return (
    <div className="chat-sidebar__deferred-row">
      <DeferredChatTurn eager={!deferred} priority={priority} onMount={onMount}>
        {children}
      </DeferredChatTurn>
    </div>
  )
}
