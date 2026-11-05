import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ChangesFooterContent } from './ChangesFooterContent'
import { useCompactLayout } from '../../useCompactLayout'
import { Button } from '../../components/Button'
import { GitCommitHorizontal, Sparkles, X } from 'lucide-react'
import { GitSyncCountsLabel } from '../../components/AppStatusStates'

type ChangesFooterProps = WorkspaceController['changesFooter']

export function ChangesFooter(props: ChangesFooterProps): ReactElement | null {
  const compact = useCompactLayout()
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && compact && props.visible) dialog.current?.show()
    else dialog.current?.close()
  }, [open, compact, props.visible])
  if (!props.visible) return null
  if (compact)
    return (
      <>
        <footer className="mobile-git-actions">
          <Button
            theme="secondary"
            label={
              props.currentProjectCommitError || props.currentProjectSyncError
                ? 'Review Git'
                : 'Commit'
            }
            icon={<GitCommitHorizontal />}
            callback={() => setOpen(true)}
          />
          <Button
            theme="primary"
            label="AI Commit"
            aria-label="AI Commit"
            icon={<Sparkles />}
            disabled={props.commitMessageGenerationDisabled}
            callback={() => void props.handleQuickCommitChangedFiles(props.pushAfterCommit)}
          />
          {props.hasSyncChanges && (
            <Button
              theme="secondary"
              disabled={props.syncDisabled}
              title={props.syncButtonTitle}
              callback={() => void props.handleSyncChanges(props.primarySyncAction)}
              dropdownActions={
                props.primarySyncAction === 'pullAndPush' ? props.syncDropdownActions : undefined
              }
              dropdownLabel="Sync actions"
              dropdownPlacement="top"
              dropdownMenuAlign="end"
              label={
                <GitSyncCountsLabel
                  active={props.syncInProgress}
                  unpulledCount={props.unpulledCount}
                  unpushedCount={props.unpushedCount}
                />
              }
            />
          )}
        </footer>
        {open && (
          <div
            className="mobile-git-overlay"
            onPointerDown={() => setOpen(false)}
            role="presentation"
          />
        )}
        <dialog
          ref={dialog}
          className="mobile-git-dialog"
          aria-labelledby="mobile-git-title"
          aria-modal="true"
          onCancel={() => setOpen(false)}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.defaultPrevented) return
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
            } else if (
              event.key === 'Tab' &&
              !document.querySelector('[role="menu"], [role="listbox"]')
            ) {
              const controls = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), textarea:not(:disabled), input:not(:disabled)'
                )
              ].filter((element) => element.getClientRects().length)
              const first = controls[0]
              const last = controls.at(-1)
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last?.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first?.focus()
              }
            }
          }}
        >
          <section className="mobile-git-dialog__surface">
            <header>
              <h2 id="mobile-git-title">Commit changes</h2>
              <Button
                theme="secondary"
                aria-label="Close Git actions"
                icon={<X />}
                callback={() => setOpen(false)}
              />
            </header>
            <ChangesFooterContent {...props} hasSyncChanges={false} />
          </section>
        </dialog>
      </>
    )
  return <ChangesFooterContent {...props} />
}
