import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { AppLocalImageOptions } from '../../../shared/app'
import { appApi } from '../appApi'
import { Button } from './Button'
import './ImageLightbox.css'

type ImageLightboxProps = {
  dataUrl: string
  name: string
  path?: string | null
  localImageOptions?: Omit<AppLocalImageOptions, 'path'>
  onClose: () => void
}

type CopyState = 'idle' | 'copying' | 'copied' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export const ImageLightbox = ({
  dataUrl,
  name,
  path,
  localImageOptions,
  onClose
}: ImageLightboxProps): React.ReactElement => {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const saveFeedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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
    if (!path || copyState === 'copying') return

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }
    setCopyState('copying')
    try {
      await appApi.copyLocalImage({ ...localImageOptions, path })
      setCopyState('copied')
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        copyFeedbackTimerRef.current = null
        setCopyState('idle')
      }, 1000)
    } catch {
      setCopyState('error')
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
      const savedPath = await appApi.saveLocalImage({ ...localImageOptions, path })
      if (!savedPath) {
        setSaveState('idle')
        return
      }

      setSaveState('saved')
      saveFeedbackTimerRef.current = window.setTimeout(() => {
        saveFeedbackTimerRef.current = null
        setSaveState('idle')
      }, 1000)
    } catch {
      setSaveState('error')
    }
  }

  return createPortal(
    <div
      className="image-lightbox"
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
        <div className="image-lightbox__frame">
          <img src={dataUrl} alt={`${name} preview`} />
          <div className="image-lightbox__actions">
            {path && (
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
                  title={copyState === 'error' ? 'Unable to copy image' : 'Copy image'}
                />
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
                  title={saveState === 'error' ? 'Unable to save image' : 'Save image'}
                />
              </>
            )}
            <Button
              aria-label="Close image preview"
              callback={onClose}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="secondary"
              title="Close"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
