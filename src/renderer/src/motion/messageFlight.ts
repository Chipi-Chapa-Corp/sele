import { useReducedMotionPreference } from './useReducedMotionPreference'
import { getChatMessagePresentation } from '../chatMessageResources'
import { useLayoutEffect, type RefObject } from 'react'

type Flight = {
  text: string
  chatKey: string | null
  source: DOMRect
  existingIds: Set<string>
  started: number
  timer: number
  launchFrame: number
  detachFrame: number
  target: HTMLElement | null
  restore: () => void
  ghost: HTMLDivElement | null
  animation: Animation | null
  arrivalAnimation: Animation | null
  stopListening: () => void
}
const flights = new Set<Flight>()
const duration = 360
const landingDuration = 80
const totalDuration = duration + landingDuration
const landingOffset = duration / totalDuration
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const finishFlight = (flight: Flight): void => {
  window.clearTimeout(flight.timer)
  window.cancelAnimationFrame(flight.launchFrame)
  window.cancelAnimationFrame(flight.detachFrame)
  flight.stopListening()
  flight.restore()
  flight.animation?.cancel()
  flight.ghost?.remove()
  flights.delete(flight)
  flight.target = null
  flight.restore = () => {}
}

// Capture only real sends. The flight owns its visual copy independently of
// React's optimistic row, which a provider may replace before the flight lands.
export function captureMessageFlight(
  textarea: HTMLTextAreaElement | null,
  text: string,
  scope: string
): () => void {
  if (!textarea || !text || text.length > 12000 || reducedMotion() || document.hidden)
    return () => {}
  const flight: Flight = {
    text: getChatMessagePresentation(text).content.trim(),
    chatKey: scope.startsWith('new-chat:') ? null : scope,
    source: textarea.getBoundingClientRect(),
    started: Date.now(),
    existingIds: new Set(
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-motion-message-id]'),
        (node) => node.dataset.motionMessageId!
      )
    ),
    timer: 0,
    launchFrame: 0,
    detachFrame: 0,
    target: null,
    restore: () => {},
    ghost: null,
    animation: null,
    arrivalAnimation: null,
    stopListening: () => {}
  }
  const cancel = (): void => finishFlight(flight)
  flight.timer = window.setTimeout(cancel, 1800)
  if (flights.size >= 4) finishFlight(flights.values().next().value!)
  flights.add(flight)
  return cancel
}

function revealLandingTarget(flight: Flight): void {
  if (!flight.target || !flight.animation) return
  flight.arrivalAnimation?.cancel()
  flight.arrivalAnimation = flight.target.animate(
    [{ opacity: 0 }, { opacity: 0, offset: landingOffset }, { opacity: 1 }],
    { duration: totalDuration, fill: 'both' }
  )
  // A provider can replace the row during the handover, too. Continue its fade
  // at the same age instead of briefly exposing or hiding the replacement.
  if (flight.animation.startTime !== null) {
    flight.arrivalAnimation.startTime = flight.animation.startTime
  } else {
    flight.arrivalAnimation.currentTime = flight.animation.currentTime
  }
}

function flyToTarget(flight: Flight): void {
  const target = flight.target
  const viewport = target?.closest('.chat-detail__messages')
  const bubble = target?.querySelector<HTMLElement>('.chat-detail__message--user')
  if (!target?.isConnected || !viewport || !bubble || reducedMotion()) {
    finishFlight(flight)
    return
  }
  // Provider reconciliation rebinds the hidden row, not the trajectory.
  if (flight.ghost) {
    revealLandingTarget(flight)
    return
  }
  const bounds = bubble.getBoundingClientRect()
  const viewBounds = viewport.getBoundingClientRect()
  if (!bounds.width || bounds.bottom <= viewBounds.top || bounds.top >= viewBounds.bottom) {
    finishFlight(flight)
    return
  }
  const ghost = document.createElement('div')
  ghost.className = `${target.className} message-flight`
  const copy = bubble.cloneNode(true) as HTMLElement
  copy.style.maxWidth = 'none'
  copy.style.width = '100%'
  ghost.append(copy)
  ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  const computed = getComputedStyle(target)
  for (const property of ['--lead', '--quiet', '--glass', '--control-bg']) {
    ghost.style.setProperty(property, computed.getPropertyValue(property))
  }
  Object.assign(ghost.style, {
    position: 'fixed',
    margin: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '1000',
    transformOrigin: 'top left',
    willChange: 'transform, opacity',
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    maxHeight: `${Math.min(bounds.height, viewBounds.height)}px`
  })
  document.body.append(ghost)
  flight.ghost = ghost
  window.clearTimeout(flight.timer)
  flight.timer = window.setTimeout(() => finishFlight(flight), totalDuration + 80)
  const cancel = (): void => finishFlight(flight)
  window.addEventListener('wheel', cancel, { passive: true, capture: true })
  window.addEventListener('resize', cancel)
  flight.stopListening = () => {
    window.removeEventListener('wheel', cancel, true)
    window.removeEventListener('resize', cancel)
  }
  flight.animation = ghost.animate(
    [
      {
        transform: `translate(${flight.source.left - bounds.left}px, ${flight.source.top - bounds.top}px)`,
        opacity: 1,
        easing: 'cubic-bezier(0.25, 0.65, 0.3, 1)'
      },
      { transform: 'translate(0, 0)', opacity: 1, offset: landingOffset },
      { transform: 'translate(0, 0)', opacity: 0 }
    ],
    { duration: totalDuration, fill: 'both' }
  )
  // Schedule both sides of the handover now. Provider updates can occupy the
  // renderer when travel ends; only DOM cleanup should wait for JavaScript.
  // The fixed endpoint keeps the path straight even if the live row moves.
  flight.animation.startTime = document.timeline.currentTime
  revealLandingTarget(flight)
  flight.animation.onfinish = () => finishFlight(flight)
}

export function useMessageArrival(
  ref: RefObject<HTMLDivElement | null>,
  message: { id: string; content: string; createdAt?: number | null } | null,
  chatKey?: string | null
): void {
  const reduced = useReducedMotionPreference()
  const id = message?.id
  const content = message?.content
  const createdAt = message?.createdAt
  useLayoutEffect(() => {
    if (!id || !content || !chatKey || reduced) return
    const target = ref.current
    if (!target) return
    const visibleContent = getChatMessagePresentation(content).content.trim()
    const flight = Array.from(flights).find(
      (candidate) =>
        (!candidate.target || candidate.target === target) &&
        candidate.text === visibleContent &&
        !candidate.existingIds.has(id) &&
        (candidate.chatKey === chatKey ||
          (candidate.chatKey === null &&
            createdAt != null &&
            createdAt >= candidate.started - 1000))
    )
    if (!flight) return
    window.cancelAnimationFrame(flight.detachFrame)
    flight.restore()
    flight.target = target
    flight.chatKey = chatKey
    const originalOpacity = target.style.opacity
    target.style.opacity = '0'
    flight.restore = () => {
      flight.arrivalAnimation?.cancel()
      flight.arrivalAnimation = null
      target.style.opacity = originalOpacity
    }
    revealLandingTarget(flight)
    // Existing scroll-to-latest and composer resizing get their normal commit.
    // The flight owns this wait so optimistic/provider row replacements cannot
    // restart it on every frame. Launch toward whichever row is bound then.
    if (!flight.ghost && !flight.launchFrame) {
      flight.launchFrame = window.requestAnimationFrame(() => {
        flight.launchFrame = window.requestAnimationFrame(() => {
          flight.launchFrame = 0
          if (flights.has(flight) && flight.target) flyToTarget(flight)
        })
      })
    }
    return () => {
      if (flight.target !== target) return
      flight.restore()
      flight.target = null
      if (reducedMotion()) {
        finishFlight(flight)
        return
      }
      // A replacement row (or Strict Mode replay) can claim the same flight in
      // this commit. Navigation/unmount without a replacement cancels it.
      flight.detachFrame = window.requestAnimationFrame(() => {
        flight.detachFrame = window.requestAnimationFrame(() => {
          if (!flight.target) finishFlight(flight)
        })
      })
    }
  }, [chatKey, content, createdAt, id, reduced, ref])
}
