import { createRoot } from 'react-dom/client'
import { useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { PopupWindow } from './PopupWindow'
import { privacyPolicy as policy } from '../../../shared/privacyPolicy'
import './PrivacyPolicyDialog.css'

function PrivacyPolicyDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement
    dialog.current?.showModal()
    return () => {
      dialog.current?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return (
    <PopupWindow>
      <dialog
        ref={dialog}
        className="privacy-policy-dialog"
        aria-labelledby="privacy-policy-title"
        onCancel={(event) => {
          event.preventDefault()
          onClose()
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="privacy-policy-title">Privacy policy</h2>
          <Button
            icon={<X size={18} />}
            aria-label="Close privacy policy"
            theme="transparent"
            callback={onClose}
          />
        </header>
        <div className="privacy-policy-dialog__body" tabIndex={0}>
          {policy
            .trim()
            .split(/\n\s*\n/)
            .slice(1)
            .map((block) =>
              block.startsWith('## ') ? (
                <h3 key={block}>{block.slice(3)}</h3>
              ) : (
                <p key={block}>{block.replaceAll('**', '').replaceAll('\n', ' ')}</p>
              )
            )}
        </div>
        <footer>
          <Button label="Close" theme="secondary" callback={onClose} />
        </footer>
      </dialog>
    </PopupWindow>
  )
}

/** Available before pairing, without a desktop connection or internet access. */
export const showPrivacyPolicy = (): void => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  root.render(
    <PrivacyPolicyDialog
      onClose={() => {
        root.unmount()
        container.remove()
      }}
    />
  )
}
