import { useReducedMotionPreference } from '../motion/useReducedMotionPreference'
import { useEffect, useRef } from 'react'

const hint = 'Use @ for files and $ for skills'

// The timer updates this decorative node only, not MessageBox or its draft.
export function ComposerPlaceholder({
  scope,
  empty
}: {
  scope: string
  empty: boolean
}): React.JSX.Element | null {
  const ref = useRef<HTMLSpanElement>(null)
  const completedScope = useRef<string | null>(null)
  const reduced = useReducedMotionPreference()
  useEffect(() => {
    if (!empty) completedScope.current = scope
    const node = ref.current
    if (!node) return
    if (reduced || completedScope.current === scope) {
      node.textContent = hint
      return
    }
    let index = 0
    node.textContent = ''
    const timer = window.setInterval(() => {
      index += 2
      node.textContent = hint.slice(0, index)
      if (index >= hint.length) {
        completedScope.current = scope
        window.clearInterval(timer)
      }
    }, 30)
    return () => window.clearInterval(timer)
  }, [empty, reduced, scope])
  return empty ? (
    <span ref={ref} className="composer-placeholder" aria-hidden="true">
      {hint}
    </span>
  ) : null
}
