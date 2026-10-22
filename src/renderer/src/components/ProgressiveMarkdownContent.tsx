import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { AppContainerTarget } from '../../../shared/app'
import type { MarkdownPlanNode } from '../markdownPlan'
import { requestMarkdownPlan } from '../chatMarkdownClient'
import { useMarkdownImages } from '../useMarkdownImages'
import { hydrateMermaidDiagrams } from '../mermaidRendering'
import { DeferredChatTurn } from './DeferredChatTurn'
import { MarkdownElement, MarkdownNodes } from './MarkdownContent'

export const progressiveMarkdownThreshold = 12_000

// HTML fragments inside tables need their native parse context. Sanitizing a bare <tr> or
// <tbody> as body HTML would strip the table structure before React could mount it.
const sanitizedFragment = (html: string, parent: string): DocumentFragment => {
  const contexts: Record<string, string[]> = {
    table: ['table'],
    thead: ['table', 'thead'],
    tbody: ['table', 'tbody'],
    tfoot: ['table', 'tfoot'],
    tr: ['table', 'tbody', 'tr'],
    colgroup: ['table', 'colgroup']
  }
  const context = contexts[parent] ?? []
  const markup =
    context.map((tag) => `<${tag}>`).join('') +
    html +
    [...context]
      .reverse()
      .map((tag) => `</${tag}>`)
      .join('')
  const fragment = DOMPurify.sanitize(markup, { ADD_ATTR: ['target'], RETURN_DOM_FRAGMENT: true })
  let source: ParentNode = fragment
  for (const tag of context) source = source.querySelector(tag) ?? source
  if (source === fragment) return fragment
  const result = document.createDocumentFragment()
  result.append(...source.childNodes)
  return result
}

type PartProps = {
  node: MarkdownPlanNode
  parent: string
  priority: number
  container?: AppContainerTarget | null
  cwd?: string | null
  onCommit: () => void
}

const MarkdownLeaf = memo(function MarkdownLeaf({
  html,
  parent,
  container,
  cwd,
  onCommit
}: Omit<PartProps, 'node' | 'priority'> & { html: string }) {
  const fragment = useMemo(() => sanitizedFragment(html, parent), [html, parent])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed fragment signals a DOM commit that can add images or diagrams.
  useLayoutEffect(onCommit, [fragment, onCommit])
  return <MarkdownNodes parent={fragment} container={container} cwd={cwd} />
})

const MarkdownPart = memo(function MarkdownPart(props: PartProps) {
  const { node, parent, priority, container, cwd, onCommit } = props
  const shell = useMemo(
    () =>
      'tag' in node
        ? sanitizedFragment(`${node.opening}</${node.tag}>`, parent).firstElementChild
        : null,
    [node, parent]
  )
  if ('html' in node)
    return (
      <DeferredChatTurn eager={false} priority={priority}>
        <MarkdownLeaf
          html={node.html}
          parent={parent}
          container={container}
          cwd={cwd}
          onCommit={onCommit}
        />
      </DeferredChatTurn>
    )
  if (!shell) return null
  return (
    <MarkdownElement element={shell}>
      {node.children.map((child, index) => (
        <MarkdownPart
          key={index}
          node={child}
          parent={node.tag}
          priority={priority + index / 1000}
          container={container}
          cwd={cwd}
          onCommit={onCommit}
        />
      ))}
    </MarkdownElement>
  )
})

export function ProgressiveMarkdownContent({
  content,
  interactiveFileLinks,
  footnotePrefix,
  streaming,
  container,
  cwd,
  errorMarkup
}: {
  content: string
  interactiveFileLinks: boolean
  footnotePrefix: string
  streaming: boolean
  container?: AppContainerTarget | null
  cwd?: string | null
  errorMarkup: string
}) {
  const [plan, setPlan] = useState<MarkdownPlanNode[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const onCommit = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let current = true
    const request = requestMarkdownPlan({ content, interactiveFileLinks, footnotePrefix })
    request.result
      .then((next) => {
        if (current) {
          setPlan(next)
          setFailed(false)
        }
      })
      .catch((error) => {
        if (!current) return
        console.error('Unable to render large Markdown message', error)
        setFailed(true)
      })
    return () => {
      current = false
      request.cancel()
    }
  }, [content, interactiveFileLinks, footnotePrefix])
  useMarkdownImages(ref, String(revision), container, cwd, errorMarkup)
  // biome-ignore lint/correctness/useExhaustiveDependencies: leaf commits change the DOM without changing the source message.
  useEffect(() => {
    if (!streaming && ref.current) hydrateMermaidDiagrams(ref.current)
  }, [streaming, revision])
  return (
    <div
      ref={ref}
      className="chat-detail__message-markdown chat-detail__message-markdown--progressive"
      aria-busy={!plan && !failed}
    >
      {failed ? (
        <pre>{content}</pre>
      ) : plan ? (
        plan.map((node, index) => (
          <MarkdownPart
            key={index}
            node={node}
            parent="div"
            priority={index}
            container={container}
            cwd={cwd}
            onCommit={onCommit}
          />
        ))
      ) : (
        <span className="chat-detail__messages-status">Rendering message…</span>
      )}
    </div>
  )
}
