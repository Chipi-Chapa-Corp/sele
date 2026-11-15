import { useEffect, useRef, useState } from 'react'
import { isRemoteClient } from '../runtimeCapabilities'
import { resolveRemoteUrl } from '../remoteUrl'
import { consumeTouchClick } from '../touchInput'
import { appApi } from '../appApi'
import { Button } from './Button'
import './MobileLinkActions.css'

/** WebViews do not supply the browser's usual link context menu. */
export function MobileLinkActions(): React.JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!isRemoteClient()) return
    let press: {
      id: number
      x: number
      y: number
      timer: ReturnType<typeof setTimeout>
      held: boolean
    } | null = null
    const cancel = (): void => {
      if (press) clearTimeout(press.timer)
      press = null
    }
    const link = (target: EventTarget | null): string | null => {
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor) return null
      try {
        const parsed = new URL(anchor.href)
        return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)
          ? resolveRemoteUrl(anchor.href)
          : null
      } catch {
        return null
      }
    }
    const show = (address: string): void => {
      setError(null)
      setUrl(address)
      consumeTouchClick(document)
    }
    const down = (event: PointerEvent): void => {
      cancel()
      const address = link(event.target)
      if (event.pointerType !== 'touch' || !event.isPrimary || !address) return
      const current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        held: false,
        timer: setTimeout(() => {
          current.held = true
          show(address)
        }, 450)
      }
      press = current
    }
    const move = (event: PointerEvent): void => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) cancel()
    }
    const up = (event: PointerEvent): void => {
      if (press?.held && press.id === event.pointerId) {
        consumeTouchClick(document)
        event.preventDefault()
      }
      cancel()
    }
    const context = (event: MouseEvent): void => {
      const address = link(event.target)
      if (!address || (!press && !matchMedia('(pointer: coarse)').matches)) return
      event.preventDefault()
      cancel()
      show(address)
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', cancel, true)
    document.addEventListener('scroll', cancel, true)
    document.addEventListener('contextmenu', context)
    return () => {
      cancel()
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', cancel, true)
      document.removeEventListener('scroll', cancel, true)
      document.removeEventListener('contextmenu', context)
    }
  }, [])
  useEffect(() => {
    if (url && !dialog.current?.open) dialog.current?.showModal()
  }, [url])
  if (!url) return null
  return (
    <dialog
      ref={dialog}
      className="mobile-link-actions"
      aria-label="Link actions"
      onCancel={() => setUrl(null)}
      onClose={() => setUrl(null)}
      onClick={(event) => {
        if (event.target === event.currentTarget) setUrl(null)
      }}
    >
      <div className="mobile-link-actions__content">
        <p>{url}</p>
        <Button
          label="Copy address"
          callback={async () => {
            try {
              await appApi.handleExternalLink({ url, action: 'copy' })
              setUrl(null)
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Unable to copy address.')
            }
          }}
        />
        <Button label="Close" theme="transparent" callback={() => setUrl(null)} />
        {error && <p role="alert">{error}</p>}
      </div>
    </dialog>
  )
}
