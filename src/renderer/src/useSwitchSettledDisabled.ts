import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export const switchSettleMs = 250

/**
 * Display-only disabled state that does not flicker while a navigation settles.
 *
 * For `holdMs` after `switchKey` changes, a newly disabled control keeps the state it showed
 * before the switch, so checks that are only briefly unresolved while the next chat or
 * project loads never paint as disabled. After the hold the real value applies, so a control
 * that is still disabled changes once. Changes outside a switch apply immediately.
 *
 * Handlers must keep guarding on the real state: during the hold a control may look enabled
 * while its action is still unavailable.
 */
export function useSwitchSettledDisabled(
  disabled: boolean,
  switchKey: unknown,
  holdMs = switchSettleMs
): boolean {
  const [hold, setHold] = useState<{ key: unknown; disabled: boolean } | null>(null)
  const [renderedKey, setRenderedKey] = useState(switchKey)
  // State shown by the last committed render, i.e. what the user saw before a switch.
  const displayedRef = useRef(disabled)
  let activeHold = hold
  if (renderedKey !== switchKey) {
    // Adjusting state during render lets React redo this render before committing, so the
    // switch never writes a transient disabled attribute to the DOM.
    activeHold = { key: switchKey, disabled: displayedRef.current }
    setRenderedKey(switchKey)
    setHold(activeHold)
  }
  const held = activeHold && activeHold.key === switchKey ? activeHold.disabled : null
  const displayed = disabled && held !== null ? held : disabled

  useLayoutEffect(() => {
    displayedRef.current = displayed
  }, [displayed])

  useEffect(() => {
    if (!hold) return
    const timeout = window.setTimeout(
      () => setHold((current) => (current === hold ? null : current)),
      holdMs
    )
    return () => window.clearTimeout(timeout)
  }, [hold, holdMs])

  return displayed
}
