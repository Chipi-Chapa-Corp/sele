import { createElement, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { AppContainerTarget } from '../../../shared/app'
import { usePatchedFragment, usePatchedHtml } from '../markdownDomPatch'
import { decodeVisualizationReference } from '../visualizationReference'
import { Visualization } from './Visualization'
import { MermaidDiagram } from './MermaidDiagram'

export function MarkdownFragment({ fragment }: { fragment: DocumentFragment }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  usePatchedFragment(ref, fragment)
  return <div className="chat-detail__markdown-part" ref={ref} />
}

// Keep each Markdown block separate so updating the streaming tail never replaces
// an iframe's ancestors. Moving even an existing iframe through detached DOM reloads it.
export function MarkdownElement({
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
  const applied = useRef<{ node: HTMLElement; element: Element } | null>(null)
  usePatchedHtml(ref, ownsChildren ? element.innerHTML : null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    if (applied.current?.node === node && applied.current.element === element) return
    for (const { name } of Array.from(node.attributes)) {
      if (!element.hasAttribute(name)) node.removeAttribute(name)
    }
    for (const { name, value } of Array.from(element.attributes)) {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value)
    }
    applied.current = { node, element }
  }, [element])

  return createElement(tag, { ref }, children)
}

export function MarkdownNodes({
  parent,
  container,
  cwd,
  renderDiagrams = true
}: {
  parent: ParentNode
  container?: AppContainerTarget | null
  cwd?: string | null
  renderDiagrams?: boolean
}): ReactNode {
  const occurrences = new Map<string, number>()
  return Array.from(parent.childNodes, (node, index) => {
    if (!(node instanceof Element))
      return node.nodeType === Node.TEXT_NODE ? node.textContent : null
    if (renderDiagrams && node.hasAttribute('data-mermaid-diagram')) {
      return (
        <MermaidDiagram
          key={`mermaid:${index}`}
          source={node.querySelector('.markdown-mermaid__source')?.textContent ?? ''}
        />
      )
    }
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
    const hasEmbeddedContent = Boolean(
      node.querySelector('[data-visualization], [data-mermaid-diagram]')
    )
    return (
      // React must not reconcile children into an element whose DOM it does not own.
      <MarkdownElement
        key={`${node.localName}:${index}:${hasEmbeddedContent ? 'react' : 'html'}`}
        element={node}
      >
        {hasEmbeddedContent ? (
          <MarkdownNodes
            parent={node}
            container={container}
            cwd={cwd}
            renderDiagrams={renderDiagrams}
          />
        ) : undefined}
      </MarkdownElement>
    )
  })
}

export function MarkdownContent({
  html,
  settled = false,
  container,
  cwd
}: {
  html: string
  settled?: boolean
  container?: AppContainerTarget | null
  cwd?: string | null
}): React.JSX.Element {
  const content = useMemo(() => {
    if (!html.includes('data-visualization=') && !html.includes('data-mermaid-diagram')) return null
    const template = document.createElement('template')
    template.innerHTML = html
    return template.content
  }, [html])

  const ref = useRef<HTMLDivElement>(null)
  usePatchedHtml(ref, content ? null : html, settled)
  return content ? (
    <div key="react" className="chat-detail__message-markdown">
      <MarkdownNodes parent={content} container={container} cwd={cwd} />
    </div>
  ) : (
    <div key="html" className="chat-detail__message-markdown" ref={ref} />
  )
}
