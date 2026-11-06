import { ArrowUp10, Brush, ListOrdered, MoveUp, Undo } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { AppSelectedImage } from '../../../shared/app'
import { appApi } from '../appApi'
import { Button } from '../components/Button'
import { ImageLightbox } from '../components/ImageLightbox'
import { useLocalMedia } from '../useLocalMedia'
import {
  annotationGeometry,
  annotationLength,
  constrainArrow,
  extendAnnotation,
  nextAnnotationNumber,
  type AnnotationPoint,
  type AnnotationTool,
  type ImageAnnotation
} from './imageAnnotations'
import { readPastedImage } from './pastedImage'
import { renderAnnotatedImage } from './renderAnnotatedImage'
import './ComposerImageLightbox.css'

const tools = [
  { tool: 'brush', label: 'Draw with brush', Icon: Brush },
  { tool: 'arrow', label: 'Draw arrows', Icon: MoveUp },
  { tool: 'numbered-arrow', label: 'Draw numbered arrows', Icon: ArrowUp10 },
  { tool: 'number', label: 'Draw numbers', Icon: ListOrdered }
] as const

export function ComposerImageLightbox({
  image,
  onClose,
  onSave
}: {
  image: AppSelectedImage
  onClose(): void
  onSave(image: AppSelectedImage): void
}): React.JSX.Element {
  const full = useLocalMedia(image.previewOnly ? { path: image.path } : null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const surfaceRef = useRef<SVGSVGElement | null>(null)
  const gestureRef = useRef<{ pointerId: number; annotation: ImageAnnotation } | null>(null)
  const busyRef = useRef(false)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [tool, setTool] = useState<AnnotationTool | null>(null)
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([])
  const [preview, setPreview] = useState<ImageAnnotation | null>(null)
  const [size, setSize] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current
    gestureRef.current = null
    setPreview(null)
    if (gesture && surfaceRef.current?.hasPointerCapture(gesture.pointerId)) {
      surfaceRef.current.releasePointerCapture(gesture.pointerId)
    }
  }, [])

  const undo = useCallback(() => {
    if (busyRef.current) return
    if (gestureRef.current) cancelGesture()
    else setAnnotations((current) => current.slice(0, -1))
    setError(null)
  }, [cancelGesture])

  useEffect(() => {
    const handleShift = (event: KeyboardEvent): void => {
      if (event.key !== 'Shift' || !gestureRef.current) return
      setPreview(constrainArrow(gestureRef.current.annotation, event.shiftKey))
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      handleShift(event)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.stopImmediatePropagation()
        undo()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', handleShift, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', handleShift, true)
    }
  }, [undo])

  useLayoutEffect(() => {
    if (!dimensions.width) return
    const surface = surfaceRef.current
    const image = imageRef.current
    const parent = surface?.parentElement
    if (!surface || !image || !parent) return
    // A resized popup can letterbox its image. Keep the drawing surface on the
    // actual pixels, so pointer coordinates and exported marks always agree.
    const alignSurface = (): void => {
      const bounds = image.getBoundingClientRect()
      const container = parent.getBoundingClientRect()
      const scale = Math.min(bounds.width / dimensions.width, bounds.height / dimensions.height)
      const width = dimensions.width * scale
      const height = dimensions.height * scale
      Object.assign(surface.style, {
        left: `${bounds.left - container.left + (bounds.width - width) / 2}px`,
        top: `${bounds.top - container.top + (bounds.height - height) / 2}px`,
        width: `${width}px`,
        height: `${height}px`
      })
    }
    const observer = new ResizeObserver(alignSurface)
    observer.observe(image)
    observer.observe(parent)
    alignSurface()
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (!busyRef.current && event.deltaY) {
        setSize((current) => Math.max(1, Math.min(10, current + (event.deltaY < 0 ? 1 : -1))))
      }
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      surface.removeEventListener('wheel', onWheel)
    }
  }, [dimensions.width, dimensions.height])

  const point = (event: { clientX: number; clientY: number }, bounds: DOMRect): AnnotationPoint => {
    return {
      x: Math.max(
        0,
        Math.min(
          dimensions.width,
          ((event.clientX - bounds.left) * dimensions.width) / bounds.width
        )
      ),
      y: Math.max(
        0,
        Math.min(
          dimensions.height,
          ((event.clientY - bounds.top) * dimensions.height) / bounds.height
        )
      )
    }
  }

  const advanceGesture = (
    event: PointerEvent<SVGSVGElement>,
    final = false
  ): ImageAnnotation | null => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return null
    const bounds = event.currentTarget.getBoundingClientRect()
    const coalesced = final ? [] : (event.nativeEvent.getCoalescedEvents?.() ?? [])
    const samples = (coalesced.length ? coalesced : [event.nativeEvent]).map((sample) =>
      point(sample, bounds)
    )
    gesture.annotation = extendAnnotation(
      gesture.annotation,
      samples,
      final ? 0 : (dimensions.width / bounds.width) * 0.75
    )
    return constrainArrow(gesture.annotation, event.shiftKey)
  }

  const exportImage = async (): Promise<Blob> => {
    if (!imageRef.current) throw new Error('The image is not ready.')
    return renderAnnotatedImage(imageRef.current, annotations)
  }

  const persistImage = async (): Promise<AppSelectedImage> => {
    const png = await exportImage()
    const name = `${image.name.replace(/\.[^.]+$/, '')}.png`
    const saved = await readPastedImage(new File([png], name, { type: 'image/png' }))
    if (!saved) throw new Error('Unable to save the edited image.')
    return { ...saved, name }
  }

  const close = async (): Promise<void> => {
    if (busyRef.current) return
    cancelGesture()
    if (!annotations.length) {
      onClose()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      onSave(await persistImage())
      onClose()
    } catch (error) {
      console.error('[caught:ComposerImageLightbox:close]', error)
      setError(
        error instanceof Error ? error.message : 'Unable to save the edited image. Close to retry.'
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <ImageLightbox
      imageUrl={full?.url ?? image.dataUrl}
      name={image.name}
      path={image.path}
      loading={Boolean(image.previewOnly && !full?.url && !full?.error)}
      error={full?.error}
      onClose={() => void close()}
      editor={{
        onLoad: (event) => {
          imageRef.current = event.currentTarget
          setDimensions({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight
          })
        },
        tools: (
          <>
            {tools.map(({ tool: value, label, Icon }) => (
              <Button
                key={value}
                aria-label={label}
                title={`${label}${value === 'arrow' || value === 'numbered-arrow' ? ' · Hold Shift for a straight arrow' : ''} · Scroll to adjust thickness and font weight`}
                aria-pressed={tool === value}
                disabled={busy || !dimensions.width}
                callback={() => {
                  cancelGesture()
                  setTool((current) => (current === value ? null : value))
                }}
                icon={<Icon aria-hidden="true" />}
                size="small"
                theme="secondary"
              />
            ))}
            <Button
              aria-label="Undo annotation"
              title="Undo (Ctrl+Z)"
              disabled={busy || (!annotations.length && !preview)}
              callback={undo}
              icon={<Undo aria-hidden="true" />}
              size="small"
              theme="secondary"
            />
          </>
        ),
        overlay: dimensions.width > 0 && (
          <svg
            ref={surfaceRef}
            className={`image-annotations${tool ? ' image-annotations--drawing' : ''}`}
            viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
            aria-label="Image annotation surface"
            role="img"
            data-thickness={size}
            onPointerDown={(event) => {
              if (event.button !== 0 || !tool || busyRef.current || gestureRef.current) return
              event.preventDefault()
              const bounds = event.currentTarget.getBoundingClientRect()
              const start = point(event, bounds)
              const scale = dimensions.width / bounds.width
              const annotation: ImageAnnotation = {
                tool,
                start,
                end: start,
                points: [start],
                width: size * scale,
                fontSize: (18 + size * 2) * scale,
                fontWeight: Math.min(900, 400 + size * 50),
                ...(tool === 'number' || tool === 'numbered-arrow'
                  ? { number: nextAnnotationNumber(annotations) }
                  : {})
              }
              setError(null)
              if (tool === 'number') setAnnotations((current) => [...current, annotation])
              else {
                gestureRef.current = { pointerId: event.pointerId, annotation }
                event.currentTarget.setPointerCapture(event.pointerId)
                setPreview(constrainArrow(annotation, event.shiftKey))
              }
            }}
            onPointerMove={(event) => {
              const annotation = advanceGesture(event)
              if (annotation) setPreview(annotation)
            }}
            onPointerUp={(event) => {
              const annotation = advanceGesture(event, true)
              if (!annotation) return
              if (annotation.tool === 'brush' || annotationLength(annotation) >= annotation.width) {
                setAnnotations((current) => [...current, annotation])
              }
              cancelGesture()
            }}
            onPointerCancel={cancelGesture}
            onLostPointerCapture={cancelGesture}
          >
            {[...annotations, ...(preview ? [preview] : [])].map((annotation, index) => {
              const { shaft, head, label } = annotationGeometry(annotation, dimensions)
              return (
                <g
                  key={index}
                  fill="#ff0000"
                  stroke="#ff0000"
                  strokeWidth={annotation.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {annotation.tool !== 'number' && (
                    <>
                      <path d={shaft} fill="none" />
                      {head && <path d={head} stroke="none" />}
                    </>
                  )}
                  {annotation.number !== undefined && (
                    <text
                      x={label.x}
                      y={label.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily="sans-serif"
                      fontSize={annotation.fontSize}
                      fontWeight={annotation.fontWeight}
                      stroke="white"
                      strokeWidth={annotation.fontSize / 10}
                      paintOrder="stroke"
                    >
                      {annotation.number}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        ),
        copy: async () => {
          await appApi.writeClipboardImage(await (await exportImage()).arrayBuffer())
        },
        save: async () => {
          if (busyRef.current) return null
          busyRef.current = true
          setBusy(true)
          try {
            const saved = annotations.length ? await persistImage() : image
            return await appApi.saveLocalImage({ path: saved.path })
          } finally {
            busyRef.current = false
            setBusy(false)
          }
        },
        status: error ?? (busy ? 'Saving image…' : null)
      }}
    />
  )
}
