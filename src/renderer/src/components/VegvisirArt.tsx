import { useEffect, useRef, useState, type ReactElement } from 'react'
import VegvisirWorker from './vegvisir.worker?worker'
import { vegvisirStrokes } from './vegvisirStrokes'

let strokeLengths: number[] | undefined
const getStrokeLengths = (): number[] => {
  // Measure once, outside the animation loop. Detached SVG geometry needs no page layout.
  strokeLengths ??= vegvisirStrokes.map(({ d }) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    return path.getTotalLength()
  })
  return strokeLengths
}

export function VegvisirArt({ active = true }: { active?: boolean }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const [workerUnavailable, setWorkerUnavailable] = useState(
    () => typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function'
  )
  const staticArt = reducedMotion || workerUnavailable

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReducedMotion(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || reducedMotion || !active) return

    const setAngle = (length: number): void => {
      host.style.setProperty('--vegvisir-angle', `${length * 6}deg`)
    }
    const input = document.getElementById('message-input')
    if (input instanceof HTMLTextAreaElement) setAngle(input.value.length)

    const onInput = (event: Event): void => {
      if (event.target instanceof HTMLTextAreaElement && event.target.id === 'message-input') {
        setAngle(event.target.value.length)
      }
    }
    document.addEventListener('input', onInput)
    return () => document.removeEventListener('input', onInput)
  }, [active, reducedMotion])

  useEffect(() => {
    const host = hostRef.current
    if (!host || staticArt) return

    // A transferred canvas cannot be reused, including on Strict Mode's effect replay.
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    host.append(canvas)
    let worker: Worker | undefined
    const dispose = (): void => {
      worker?.terminate()
      if (workerRef.current === worker) workerRef.current = null
      canvas.remove()
    }
    try {
      worker = new VegvisirWorker()
      workerRef.current = worker
      worker.onerror = (event) => {
        console.error('Unable to animate new-chat artwork:', event.message)
        dispose()
        setWorkerUnavailable(true)
      }
      const surface = canvas.transferControlToOffscreen()
      worker.postMessage({ type: 'init', canvas: surface, lengths: getStrokeLengths() }, [surface])
    } catch (error) {
      console.error('Unable to initialize new-chat artwork:', error)
      dispose()
      setWorkerUnavailable(true)
    }
    return dispose
  }, [staticArt])

  useEffect(() => {
    const host = hostRef.current
    const worker = workerRef.current
    if (!host || !worker || staticArt) return
    worker.postMessage({ type: 'active', active })
    if (!active) return
    const updateAppearance = (): void => {
      const size = host.getBoundingClientRect().width
      worker.postMessage({
        type: 'appearance',
        size: Math.min(2048, Math.max(1, Math.round(size * window.devicePixelRatio))),
        color: getComputedStyle(host).color
      })
    }
    // ResizeObserver supplies the initial size after layout. Reading here would
    // force synchronous layout during the conversation-to-composer commit.
    const resizeObserver = new ResizeObserver(updateAppearance)
    resizeObserver.observe(host)
    const themeObserver = new MutationObserver(updateAppearance)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme', 'style', 'class']
    })
    window.addEventListener('resize', updateAppearance)
    return () => {
      worker.postMessage({ type: 'active', active: false })
      resizeObserver.disconnect()
      themeObserver.disconnect()
      window.removeEventListener('resize', updateAppearance)
    }
  }, [active, staticArt])

  return (
    <div ref={hostRef} className="chat-panel__new-chat-vegvisir" aria-hidden="true">
      {staticArt && (
        <svg focusable="false" viewBox="0 0 1024 1024">
          {vegvisirStrokes.map((stroke) => (
            <path
              className="chat-panel__new-chat-vegvisir-stroke"
              d={stroke.d}
              key={stroke.id}
              strokeWidth={stroke.width}
            />
          ))}
        </svg>
      )}
    </div>
  )
}
