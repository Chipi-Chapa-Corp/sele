import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, RotateCcw, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import {
  renderMermaidDiagram,
  sanitizeMermaidSvg,
  type MermaidRenderResult
} from '../mermaidRendering'
import { Button } from './Button'
import { ResizableLightbox } from './ResizableLightbox'

export function MermaidDiagram({ source }: { source: string }): React.JSX.Element {
  const [result, setResult] = useState<
    (MermaidRenderResult & { width: number; height: number }) | null
  >(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [scale, setScale] = useState(1)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const svgHtml = useMemo(() => ({ __html: result?.svg ?? '' }), [result])

  useEffect(() => {
    let current = true
    setResult(null)
    setError(false)
    const scheme = document.documentElement.dataset.colorScheme === 'dark' ? 'dark' : 'light'
    void renderMermaidDiagram(source, scheme)
      .then((rendered) => {
        if (!current) return
        const template = document.createElement('template')
        template.innerHTML = sanitizeMermaidSvg(rendered.svg)
        const svg = template.content.querySelector('svg')
        if (!svg) throw new Error('Mermaid returned no SVG')
        const { width, height } = svg.viewBox.baseVal
        // Size the canvas at the SVG's natural dimensions; scaling it to the chat
        // width makes wide diagrams unreadable. The lightbox retains this same SVG.
        svg.removeAttribute('style')
        setResult({ ...rendered, svg: svg.outerHTML, width, height })
        setScale(1)
      })
      .catch((reason: unknown) => {
        console.error('[MermaidDiagram:render]', reason)
        if (current) setError(true)
      })
    return () => {
      current = false
    }
  }, [source])

  useLayoutEffect(() => {
    if (result && canvasRef.current) result.bindFunctions?.(canvasRef.current)
  }, [result])

  const zoom = (next: number): void => setScale(Math.max(0.05, Math.min(4, next)))
  const fit = (): void => {
    const viewport = viewportRef.current
    if (result && viewport)
      zoom(Math.min(viewport.clientWidth / result.width, viewport.clientHeight / result.height))
  }
  const actions = (
    <>
      <Button
        aria-label="Zoom out"
        title="Zoom out"
        icon={<ZoomOut aria-hidden="true" />}
        size="small"
        theme="transparent"
        disabled={scale <= 0.05}
        callback={() => zoom(scale / 1.25)}
      />
      <Button
        aria-label="Zoom in"
        title="Zoom in"
        icon={<ZoomIn aria-hidden="true" />}
        size="small"
        theme="transparent"
        disabled={scale >= 4}
        callback={() => zoom(scale * 1.25)}
      />
      <Button
        aria-label="Actual size"
        title="Actual size"
        icon={<RotateCcw aria-hidden="true" />}
        size="small"
        theme="transparent"
        callback={() => setScale(1)}
      />
      <Button
        aria-label="Fit diagram"
        title="Fit diagram"
        icon={<Scan aria-hidden="true" />}
        size="small"
        theme="transparent"
        callback={fit}
      />
    </>
  )

  return (
    <section
      className={`markdown-mermaid${result ? ' markdown-mermaid--rendered' : ''}${error ? ' markdown-mermaid--error' : ''}${expanded ? ' markdown-mermaid--expanded' : ''}`}
      data-mermaid-diagram
      data-mermaid-hydration={error ? 'error' : result ? 'rendered' : 'rendering'}
      aria-busy={!result && !error ? true : undefined}
    >
      {result && (
        <div className="markdown-mermaid__actions">
          <Button
            aria-label="Expand diagram"
            title="Expand diagram"
            aria-haspopup="dialog"
            aria-expanded={expanded}
            callback={() => {
              setScale(1)
              setExpanded(true)
            }}
            icon={<Maximize2 aria-hidden="true" />}
            size="small"
            theme="transparent"
          />
        </div>
      )}
      <ResizableLightbox
        open={expanded}
        label="Expanded diagram"
        onClose={() => setExpanded(false)}
        actions={actions}
      >
        {error ? (
          <>
            <div className="markdown-mermaid__error" role="alert">
              Unable to render Mermaid diagram
            </div>
            <pre className="markdown-mermaid__source">
              <code>{source}</code>
            </pre>
          </>
        ) : result ? (
          <div
            ref={viewportRef}
            className="markdown-mermaid__viewport"
            tabIndex={0}
            role="region"
            aria-label="Diagram (scroll to explore)"
          >
            <div
              ref={canvasRef}
              className="markdown-mermaid__canvas"
              style={{
                width: result.width * (expanded ? scale : 1),
                height: result.height * (expanded ? scale : 1)
              }}
              dangerouslySetInnerHTML={svgHtml}
            />
          </div>
        ) : (
          <div className="markdown-mermaid__loading" role="status">
            Rendering diagram…
          </div>
        )}
      </ResizableLightbox>
    </section>
  )
}
