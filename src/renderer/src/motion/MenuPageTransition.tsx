import { animate } from 'motion/react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useReducedMotionPreference } from './useReducedMotionPreference'

// Keep the current page live immediately so focus/search never waits for an exit.
export function MenuPageTransition({
  page,
  children
}: {
  page: string
  children: ReactNode
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previous = useRef<{ page: string; height: number } | null>(null)
  const reduced = useReducedMotionPreference()
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const before = previous.current
    const height = content.offsetHeight
    previous.current = { page, height }
    const observer = new ResizeObserver(() => {
      // Search results can change the outgoing page's height between navigations.
      if (previous.current?.page === page) previous.current.height = content.offsetHeight
    })
    observer.observe(content)
    if (!before || before.page === page || reduced) return () => observer.disconnect()
    viewport.scrollTop = 0
    const size = animate(
      viewport,
      { height: [before.height, height] },
      {
        duration: 0.2,
        ease: 'easeOut',
        onComplete: () => {
          size.cancel()
          viewport.style.height = ''
        }
      }
    )
    const slide = animate(
      content,
      { x: [page === 'root' ? -18 : 18, 0], opacity: [0.45, 1] },
      {
        duration: 0.2,
        ease: 'easeOut'
      }
    )
    return () => {
      observer.disconnect()
      if (previous.current?.page === page) previous.current.height = viewport.offsetHeight
      size.cancel()
      slide.cancel()
      viewport.style.height = ''
    }
  }, [page, reduced])
  return (
    <div ref={viewportRef} className="menu-page-transition">
      <div ref={contentRef} data-menu-page={page}>
        {children}
      </div>
    </div>
  )
}
