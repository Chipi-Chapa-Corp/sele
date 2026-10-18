import { createElement, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { AppContainerTarget } from '../../../shared/app'
import { usePatchedHtml } from '../markdownDomPatch'
import { decodeVisualizationReference } from '../visualizationReference'
import { Visualization } from './Visualization'

// Keep each Markdown block separate so updating the streaming tail never replaces
// an iframe's ancestors. Moving even an existing iframe through detached DOM reloads it.
function MarkdownElement({
  element,
  children
}: {
  element: Element
  children?: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const tag = element.localName
  const voidElement =
    /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)
  const ownsChildren = children === undefined && !voidElement
  usePatchedHtml(ref, ownsChildren ? element.innerHTML : null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    for (const { name } of Array.from(node.attributes)) {
      if (!element.hasAttribute(name)) node.removeAttribute(name)
    }
    for (const { name, value } of Array.from(element.attributes)) {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value)
    }
  }, [element])

  return createElement(tag, { ref }, children)
}

export function MarkdownContent({
  html,
  container,
  cwd
}: {
  html: string
  container?: AppContainerTarget | null
  cwd?: string | null
}): React.JSX.Element {
  const content = useMemo(() => {
    if (!html.includes('data-visualization=')) return null
    const template = document.createElement('template')
    template.innerHTML = html
    return template.content
  }, [html])

  const renderNodes = (parent: ParentNode): ReactNode[] => {
    const occurrences = new Map<string, number>()
    return Array.from(parent.childNodes, (node, index) => {
      if (!(node instanceof Element))
        return node.nodeType === Node.TEXT_NODE ? node.textContent : null
      const reference = decodeVisualizationReference(node.getAttribute('data-visualization') ?? '')
      if (reference) {
        const occurrence = occurrences.get(reference.path) ?? 0
        occurrences.set(reference.path, occurrence + 1)
        return (
          <div
            key={`visualization:${reference.path}:${occurrence}`}
            data-visualization={node.getAttribute('data-visualization')}
          >
            <Visualization reference={reference} container={container} cwd={cwd} />
          </div>
        )
      }
      const hasVisualization = Boolean(node.querySelector('[data-visualization]'))
      return (
        // React must not reconcile children into an element whose DOM it does not own.
        <MarkdownElement
          key={`${node.localName}:${index}:${hasVisualization ? 'react' : 'html'}`}
          element={node}
        >
          {hasVisualization ? renderNodes(node) : undefined}
        </MarkdownElement>
      )
    })
  }

  const ref = useRef<HTMLDivElement>(null)
  usePatchedHtml(ref, content ? null : html)
  return content ? (
    <div key="react" className="chat-detail__message-markdown">
      {renderNodes(content)}
    </div>
  ) : (
    <div key="html" className="chat-detail__message-markdown" ref={ref} />
  )
}
