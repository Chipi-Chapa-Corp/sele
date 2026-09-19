import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, RotateCw } from 'lucide-react'
import { Button } from './Button'
import { ResizableLightbox } from './ResizableLightbox'
import type { AppContainerTarget, AppFileContentsOptions } from '../../../shared/app'
import { appApi } from '../appApi'
import { normalizeContainerTarget } from '../containerSelection'
import type { VisualizationReference } from '../visualizationReference'
import './Visualization.css'

type FollowUp = { id: number; prompt: string; title?: string; source: Window }
type VisualizationDocument = { id: number; html: string }

const boundedHeight = (height: unknown): number =>
  typeof height === 'number' && Number.isFinite(height)
    ? Math.max(48, Math.min(10000, height))
    : 200

function VisualizationContent({
  reference,
  options
}: {
  reference: VisualizationReference
  options: AppFileContentsOptions
}): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const framesRef = useRef(new Map<number, HTMLIFrameElement>())
  const activeDocumentRef = useRef<VisualizationDocument | null>(null)
  const warningIdsRef = useRef(new Set<number>())
  const legacyFramesRef = useRef(new Set<number>())
  const nextDocumentIdRef = useRef(0)
  const [activeDocument, setActiveDocument] = useState<VisualizationDocument | null>(null)
  const [pendingDocument, setPendingDocument] = useState<VisualizationDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState(false)
  const [height, setHeight] = useState(200)
  const [expanded, setExpanded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [followUp, setFollowUp] = useState<FollowUp | null>(null)

  useEffect(() => {
    let current = true
    void appApi
      .getFileContents(options)
      .then(({ contents }) => {
        if (!current) return
        if (new TextEncoder().encode(contents).length > 1_000_000) {
          throw new Error('Visualization exceeds the 1 MB limit.')
        }
        const active = activeDocumentRef.current
        // Reload rereads the file, but an unchanged, healthy document retains all its local state.
        if (active?.html === contents && !warningIdsRef.current.has(active.id)) {
          setLoading(false)
          return
        }
        setPendingDocument({ id: ++nextDocumentIdRef.current, html: contents })
      })
      .catch((reason: unknown) => {
        console.error('[caught:Visualization:VisualizationContent]', reason)

        if (!current) return
        setLoading(false)
        setError(reason instanceof Error ? reason.message : 'Unable to load visualization.')
      })
    return () => {
      current = false
    }
  }, [options, revision])

  useLayoutEffect(() => {
    const receive = (event: MessageEvent): void => {
      const documents = [activeDocument, pendingDocument]
      const document = documents.find(
        (candidate) =>
          candidate && framesRef.current.get(candidate.id)?.contentWindow === event.source
      )
      if (!document) return
      const data = event.data
      const source = event.source as Window
      if (data?.type === 'visualization:ready') {
        if (data.supportsRenderedMessage !== true) legacyFramesRef.current.add(document.id)
        source.postMessage(
          {
            type: 'visualization:init',
            html: document.html,
            dark: window.document.documentElement.dataset.colorScheme === 'dark'
          },
          '*'
        )
        return
      }
      // A hot-reloaded renderer may be talking to a main process started before the
      // explicit completion signal existed. Its first content resize is the ready signal.
      const legacyRendered =
        data?.type === 'visualization:resize' &&
        typeof data.height === 'number' &&
        data.height > 0 &&
        legacyFramesRef.current.has(document.id)
      if (
        (data?.type === 'visualization:rendered' || legacyRendered) &&
        document.id === pendingDocument?.id
      ) {
        // Promote the already initialized frame in place. Its key and DOM node stay unchanged.
        activeDocumentRef.current = document
        setActiveDocument(document)
        setPendingDocument(null)
        setHeight(boundedHeight(data.height))
        setLoading(false)
        setWarning(warningIdsRef.current.has(document.id))
        setFollowUp(null)
      } else if (data?.type === 'visualization:resize' && document.id === activeDocument?.id) {
        setHeight(boundedHeight(data.height))
      } else if (data?.type === 'visualization:escape') {
        setExpanded(false)
      } else if (data?.type === 'visualization:warning') {
        console.error(
          '[Visualization:message] Visualization runtime warning',
          typeof data.message === 'string' ? data.message : 'Unknown visualization error'
        )
        warningIdsRef.current.add(document.id)
        if (document.id === activeDocument?.id) setWarning(true)
      } else if (
        data?.type === 'visualization:follow-up' &&
        Number.isSafeInteger(data.id) &&
        typeof data.prompt === 'string' &&
        data.prompt.trim() &&
        data.prompt.length <= 32000
      ) {
        if (document.id !== activeDocument?.id) {
          source.postMessage(
            {
              type: 'visualization:follow-up-result',
              id: data.id,
              error: 'Visualization is still loading.'
            },
            '*'
          )
          return
        }
        setFollowUp((current) => {
          if (current) {
            source.postMessage(
              {
                type: 'visualization:follow-up-result',
                id: data.id,
                error: 'Another request is pending.'
              },
              '*'
            )
            return current
          }
          return {
            id: data.id,
            prompt: data.prompt,
            source,
            title: typeof data.title === 'string' ? data.title.slice(0, 250) : undefined
          }
        })
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [activeDocument, pendingDocument])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.dataset.colorScheme === 'dark'
      for (const frame of framesRef.current.values()) {
        frame.contentWindow?.postMessage({ type: 'visualization:theme', dark }, '*')
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme']
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pendingDocument) return
    const timeout = window.setTimeout(() => {
      setPendingDocument(null)
      setLoading(false)
      setError('The visualization did not finish loading. Try Reload.')
    }, 30000)
    return () => window.clearTimeout(timeout)
  }, [pendingDocument])

  const answerFollowUp = (accepted: boolean): void => {
    if (!followUp) return
    const reply = (error?: string): void => {
      followUp.source.postMessage(
        { type: 'visualization:follow-up-result', id: followUp.id, error },
        '*'
      )
    }
    if (accepted) {
      const event = new CustomEvent('sele:visualization-follow-up', {
        bubbles: true,
        cancelable: true,
        detail: { prompt: followUp.prompt, reply }
      })
      rootRef.current?.dispatchEvent(event)
      if (!event.defaultPrevented) reply('Follow-ups are unavailable in this view.')
    } else reply('Cancelled')
    setFollowUp(null)
  }

  const reload = (): void => {
    setLoading(true)
    setError(null)
    setRevision((value) => value + 1)
  }

  const documents = [activeDocument, pendingDocument].filter(
    (document): document is VisualizationDocument => document !== null
  )

  return (
    <section
      ref={rootRef}
      className={`visualization${reference.mode === 'wide' ? ' visualization--wide' : ''}`}
      aria-label={reference.title || 'Visualization'}
    >
      <ResizableLightbox
        open={expanded}
        label={reference.title || 'Expanded visualization'}
        onClose={() => setExpanded(false)}
        actions={
          <Button
            aria-label="Reload visualization"
            title="Reload visualization"
            disabled={loading}
            aria-busy={loading}
            callback={reload}
            icon={<RotateCw aria-hidden="true" />}
            size="small"
            theme="transparent"
          />
        }
      >
        <div className="visualization__actions" hidden={expanded}>
          {reference.title && <span className="visualization__title">{reference.title}</span>}
          <Button
            aria-label="Reload visualization"
            title="Reload visualization"
            disabled={loading}
            aria-busy={loading}
            callback={reload}
            icon={<RotateCw aria-hidden="true" />}
            size="small"
            theme="transparent"
          />
          <Button
            aria-label="Expand visualization"
            title="Expand visualization"
            aria-haspopup="dialog"
            aria-expanded={expanded}
            callback={() => setExpanded(true)}
            icon={<Maximize2 aria-hidden="true" />}
            size="small"
            theme="transparent"
          />
        </div>
        <div className="visualization__viewport" style={{ height }} aria-busy={loading}>
          {!activeDocument && loading && <p role="status">Loading visualization…</p>}
          {documents.map((document) => {
            const active = document.id === activeDocument?.id
            return (
              <iframe
                key={document.id}
                ref={(element) => {
                  if (element) framesRef.current.set(document.id, element)
                  else framesRef.current.delete(document.id)
                }}
                className={
                  active
                    ? 'visualization__frame'
                    : 'visualization__frame visualization__frame--pending'
                }
                aria-hidden={!active}
                inert={!active}
                src="sele-visualize://frame/"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                title={reference.title || 'Interactive visualization'}
                onLoad={(event) =>
                  event.currentTarget.contentWindow?.postMessage(
                    {
                      type: 'visualization:init',
                      html: document.html,
                      dark: window.document.documentElement.dataset.colorScheme === 'dark'
                    },
                    '*'
                  )
                }
              />
            )
          })}
        </div>
        {error && <p role="alert">{error}</p>}
        {warning && (
          <p role="status">Some visualization content could not run. Reload to try again.</p>
        )}
        {followUp && (
          <div
            className="visualization__confirmation"
            role="group"
            aria-label={followUp.title || 'Send follow-up'}
          >
            <strong>{followUp.title || 'Send this follow-up?'}</strong>
            <p>{followUp.prompt}</p>
            <div className="visualization__confirmation-actions">
              <Button label="Send follow-up" callback={() => answerFollowUp(true)} />
              <Button label="Cancel" theme="transparent" callback={() => answerFollowUp(false)} />
            </div>
          </div>
        )}
      </ResizableLightbox>
    </section>
  )
}

export function Visualization({
  reference,
  container,
  cwd
}: {
  reference: VisualizationReference
  container?: AppContainerTarget | null
  cwd?: string | null
}): React.JSX.Element {
  // IPC refreshes can recreate workspace objects without changing the actual file source.
  const sourceKey = JSON.stringify({
    container: normalizeContainerTarget(container),
    cwd: cwd ?? null,
    path: reference.path
  })
  const options = useMemo<AppFileContentsOptions>(() => JSON.parse(sourceKey), [sourceKey])
  return <VisualizationContent key={sourceKey} reference={reference} options={options} />
}
