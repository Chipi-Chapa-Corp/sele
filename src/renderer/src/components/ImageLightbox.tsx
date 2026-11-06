import { type ReactNode, type ReactEventHandler, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  LoaderCircle,
  X
} from 'lucide-react'
import { createPortal } from 'react-dom'
import type { AppLocalImageOptions } from '../../../shared/app'
import { appApi } from '../appApi'
import { copyRenderedImage } from '../imageClipboard'
import { Button } from './Button'
import { PopupWindow } from './PopupWindow'
import './ImageLightbox.css'

type ImageLightboxProps = {
  mediaType?: 'image' | 'video'
  imageUrl: string
  name: string
  path?: string | null
  localImageOptions?: Omit<AppLocalImageOptions, 'path'>
  loading?: boolean
  error?: string
  onPrevious?: () => void
  onNext?: () => void
  position?: number
  count?: number
  editor?: {
    tools: ReactNode
    overlay: ReactNode
    onLoad: ReactEventHandler<HTMLImageElement>
    copy: () => Promise<void>
    save: () => Promise<string | null>
    status?: string | null
  }
  onClose: () => void
}

type CopyState = 'idle' | 'copying' | 'copied' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export const ImageLightbox = ({
  mediaType = 'image',
  imageUrl,
  name,
  path,
  localImageOptions,
  loading = false,
  error,
  onPrevious,
  onNext,
  position = 1,
  count = 1,
  editor,
  onClose
}: ImageLightboxProps): React.ReactElement => {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [copyError, setCopyError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [revealError, setRevealError] = useState<string | null>(null)
  const [mediaSize, setMediaSize] = useState<{ url: string; width: number; height: number } | null>(
    null
  )
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef(true)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const saveFeedbackTimerRef = useRef<number | null>(null)

  const fittedSize = !editor && mediaSize?.url === imageUrl ? mediaSize : null

  const handleBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    if (
      event.target.closest(
        'button, video, .image-lightbox__tools, .image-lightbox__status, .image-annotations, .popup-window__resize-handle'
      )
    )
      return
    const image = imageRef.current
    if (image?.naturalWidth && image.naturalHeight) {
      const bounds = image.getBoundingClientRect()
      const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      const left = bounds.left + (bounds.width - width) / 2
      const top = bounds.top + (bounds.height - height) / 2
      if (
        event.clientX >= left &&
        event.clientX <= left + width &&
        event.clientY >= top &&
        event.clientY <= top + height
      )
        return
    }
    onClose()
  }

  useEffect(() => {
    activeRef.current = true
    const previousFocus = document.activeElement
    dialogRef.current?.focus()
    return () => {
      activeRef.current = false
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable="true"]')
      )
        return
      if (count > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'ArrowLeft') onPrevious?.()
        else onNext?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, onPrevious, onNext, count])

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
      if (saveFeedbackTimerRef.current !== null) {
        window.clearTimeout(saveFeedbackTimerRef.current)
      }
    },
    []
  )

  const handleCopy = async (): Promise<void> => {
    if (copyState === 'copying') return

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }
    setCopyError(null)
    setCopyState('copying')
    try {
      if (mediaType === 'video' && path) {
        await appApi.copyLocalVideo({ ...localImageOptions, path })
      } else if (editor) {
        await editor.copy()
      } else if (imageRef.current) {
        await copyRenderedImage(imageRef.current)
      } else {
        throw new Error('The preview is not ready. Try copying again.')
      }
      if (!activeRef.current) return
      setCopyState('copied')
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        copyFeedbackTimerRef.current = null
        setCopyState('idle')
      }, 1000)
    } catch (error) {
      console.error('[caught:ImageLightbox:handleCopy]', error)
      if (activeRef.current) {
        const message =
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()
            : ''
        setCopyError(message || `Unable to copy this ${mediaType}. Try copying again.`)
        setCopyState('error')
      }
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!path || saveState === 'saving') return

    if (saveFeedbackTimerRef.current !== null) {
      window.clearTimeout(saveFeedbackTimerRef.current)
      saveFeedbackTimerRef.current = null
    }
    setSaveState('saving')
    try {
      const savedPath = await (editor
        ? editor.save()
        : (mediaType === 'video' ? appApi.saveLocalVideo : appApi.saveLocalImage)({
            ...localImageOptions,
            path
          }))
      if (!activeRef.current) return
      if (!savedPath) {
        setSaveState('idle')
        return
      }

      setSaveState('saved')
      saveFeedbackTimerRef.current = window.setTimeout(() => {
        saveFeedbackTimerRef.current = null
        setSaveState('idle')
      }, 1000)
    } catch (error) {
      console.error('[caught:ImageLightbox:handleSave]', error)
      if (activeRef.current) setSaveState('error')
    }
  }

  const container = localImageOptions?.container
  const canReveal = Boolean(path) && !(container?.kind === 'container' && container.tool === 'ssh')

  const handleReveal = async (): Promise<void> => {
    if (!path) return

    setRevealError(null)
    try {
      await appApi.showFileInFolder({ ...localImageOptions, path })
    } catch (error) {
      console.error('[caught:ImageLightbox:handleReveal]', error)
      if (activeRef.current) {
        setRevealError(
          (error instanceof Error &&
            error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')) ||
            `Unable to show this ${mediaType} in the file manager`
        )
      }
    }
  }

  return createPortal(
    <div
      className="image-lightbox"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`${name} preview`}
      aria-modal="true"
      onPointerDown={handleBackdropPointerDown}
    >
      <div className="image-lightbox__preview">
        <div className="image-lightbox__stage">
          <PopupWindow>
            <div
              className="image-lightbox__frame"
              style={
                fittedSize
                  ? {
                      width: `min(${fittedSize.width}px, var(--image-lightbox-max-width), calc(var(--image-lightbox-max-height) * ${fittedSize.width / fittedSize.height}))`
                    }
                  : undefined
              }
            >
              {loading || error ? (
                <div
                  className="image-lightbox__status"
                  role={error ? 'alert' : 'status'}
                  aria-label={error ? undefined : `Loading ${name}`}
                >
                  {error}
                </div>
              ) : mediaType === 'video' ? (
                <video
                  src={imageUrl}
                  aria-label={`${name} preview`}
                  controls
                  autoPlay
                  playsInline
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget
                    if (video.videoWidth && video.videoHeight)
                      setMediaSize({
                        url: imageUrl,
                        width: video.videoWidth,
                        height: video.videoHeight
                      })
                  }}
                />
              ) : editor ? (
                <div className="image-lightbox__editable-image">
                  <img
                    ref={imageRef}
                    src={imageUrl}
                    alt={`${name} preview`}
                    onLoad={editor.onLoad}
                    draggable={false}
                  />
                  {editor.overlay}
                </div>
              ) : (
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt={`${name} preview`}
                  onLoad={(event) => {
                    const image = event.currentTarget
                    setMediaSize({
                      url: imageUrl,
                      width: image.naturalWidth,
                      height: image.naturalHeight
                    })
                  }}
                />
              )}
              {editor && (
                <div
                  className="image-lightbox__tools"
                  role="toolbar"
                  aria-label="Image annotation tools"
                >
                  {editor.tools}
                </div>
              )}
              <div className="image-lightbox__actions">
                {!loading && !error && (mediaType === 'image' || path) && (
                  <>
                    <Button
                      disabled={copyState === 'copying'}
                      aria-label={`Copy ${name}`}
                      callback={handleCopy}
                      icon={
                        copyState === 'copied' ? (
                          <Check aria-hidden="true" />
                        ) : copyState === 'copying' ? (
                          <LoaderCircle className="app-loading-spinner" aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )
                      }
                      size="small"
                      theme="secondary"
                      title={copyError ?? `Copy ${mediaType}`}
                    />
                    {canReveal && (
                      <Button
                        aria-label={`Show ${name} in file manager`}
                        callback={handleReveal}
                        icon={<FolderOpen aria-hidden="true" />}
                        size="small"
                        theme="secondary"
                        title={revealError ?? 'Show in file manager'}
                      />
                    )}
                    {path && (
                      <Button
                        disabled={saveState === 'saving'}
                        aria-label={`Save ${name}`}
                        callback={handleSave}
                        icon={
                          saveState === 'saved' ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Download aria-hidden="true" />
                          )
                        }
                        size="small"
                        theme="secondary"
                        title={
                          saveState === 'error'
                            ? `Unable to save ${mediaType}`
                            : `Save ${mediaType}`
                        }
                      />
                    )}
                  </>
                )}
                <Button
                  aria-label={`Close ${mediaType} preview`}
                  callback={onClose}
                  icon={<X aria-hidden="true" />}
                  size="small"
                  theme="secondary"
                  title="Close"
                />
              </div>
            </div>
          </PopupWindow>
          {onPrevious && (
            <div className="image-lightbox__previous">
              <Button
                aria-label="Previous media"
                title="Previous (←)"
                callback={onPrevious}
                icon={<ChevronLeft aria-hidden="true" />}
                theme="secondary"
              />
            </div>
          )}
          {onNext && (
            <div className="image-lightbox__next">
              <Button
                aria-label="Next media"
                title="Next (→)"
                callback={onNext}
                icon={<ChevronRight aria-hidden="true" />}
                theme="secondary"
              />
            </div>
          )}
        </div>
      </div>
      {editor?.status && (
        <div className="image-lightbox__copy-feedback" role="status">
          {editor.status}
        </div>
      )}
      {!editor?.status && copyState !== 'idle' && (
        <div className="image-lightbox__copy-feedback" role={copyError ? 'alert' : 'status'}>
          {copyError ?? (copyState === 'copying' ? `Copying ${mediaType}…` : 'Copied to clipboard')}
        </div>
      )}
      {count > 1 && (
        <div className="image-lightbox__position" role="status" aria-live="polite">
          {position} / {count}
        </div>
      )}
    </div>,
    document.body
  )
}
