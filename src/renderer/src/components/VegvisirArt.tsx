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

export function VegvisirArt(): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
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
    if (!host || reducedMotion) return

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
  }, [reducedMotion])

  useEffect(() => {
    const host = hostRef.current
    if (!host || staticArt) return

    // A transferred canvas cannot be reused, including on Strict Mode's effect replay.
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    host.append(canvas)
    let worker: Worker | undefined
    let resizeObserver: ResizeObserver | undefined
    let themeObserver: MutationObserver | undefined
    const dispose = (): void => {
      worker?.terminate()
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      window.removeEventListener('resize', updateAppearance)
      canvas.remove()
    }
    const updateAppearance = (): void => {
      const size = host.getBoundingClientRect().width
      worker?.postMessage({
        type: 'appearance',
        size: Math.min(2048, Math.max(1, Math.round(size * window.devicePixelRatio))),
        color: getComputedStyle(host).color
      })
    }
    try {
      worker = new VegvisirWorker()
      worker.onerror = (event) => {
        console.error('Unable to animate new-chat artwork:', event.message)
        dispose()
        setWorkerUnavailable(true)
      }
      const surface = canvas.transferControlToOffscreen()
      worker.postMessage({ type: 'init', canvas: surface, lengths: getStrokeLengths() }, [surface])
      updateAppearance()
      resizeObserver = new ResizeObserver(updateAppearance)
      resizeObserver.observe(host)
      themeObserver = new MutationObserver(updateAppearance)
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-color-scheme', 'style', 'class']
      })
      window.addEventListener('resize', updateAppearance)
    } catch (error) {
      console.error('Unable to initialize new-chat artwork:', error)
      dispose()
      setWorkerUnavailable(true)
    }
    return dispose
  }, [staticArt])

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
