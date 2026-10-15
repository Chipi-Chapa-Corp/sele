import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Download, X } from 'lucide-react'
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
  onClose
}: ImageLightboxProps): React.ReactElement => {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef(true)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const saveFeedbackTimerRef = useRef<number | null>(null)

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
    if (copyState === 'copying' || (mediaType === 'video' ? !path : !imageRef.current)) return

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }
    setCopyState('copying')
    try {
      if (mediaType === 'video' && path) {
        await appApi.copyLocalVideo({ ...localImageOptions, path })
      } else if (imageRef.current) {
        await copyRenderedImage(imageRef.current)
      }
      if (!activeRef.current) return
      setCopyState('copied')
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        copyFeedbackTimerRef.current = null
        setCopyState('idle')
      }, 1000)
    } catch (error) {
      console.error('[caught:ImageLightbox:handleCopy]', error)
      if (activeRef.current) setCopyState('error')
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
      const savedPath = await (mediaType === 'video'
        ? appApi.saveLocalVideo
        : appApi.saveLocalImage)({ ...localImageOptions, path })
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

  return createPortal(
    <div
      className="image-lightbox"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`${name} preview`}
      aria-modal="true"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="image-lightbox__preview"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div className="image-lightbox__stage">
          <PopupWindow>
            <div className="image-lightbox__frame">
              {loading || error ? (
                <div className="image-lightbox__status" role={error ? 'alert' : 'status'}>
                  {error ?? `Loading ${name}…`}
                </div>
              ) : mediaType === 'video' ? (
                <video
                  src={imageUrl}
                  aria-label={`${name} preview`}
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <img ref={imageRef} src={imageUrl} alt={`${name} preview`} />
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
                        ) : (
                          <Copy aria-hidden="true" />
                        )
                      }
                      size="small"
                      theme="secondary"
                      title={
                        copyState === 'error' ? `Unable to copy ${mediaType}` : `Copy ${mediaType}`
                      }
                    />
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
      {count > 1 && (
        <div className="image-lightbox__position" role="status" aria-live="polite">
          {position} / {count}
        </div>
      )}
    </div>,
    document.body
  )
}
