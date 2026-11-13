import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { sanitizedFragment } from '../markdownFragment'
import { FlatMarkdownSequence } from './FlatMarkdownSequence'
import type { AppContainerTarget } from '../../../shared/app'
import { createMarkdownPlan, reuseMarkdownPlan, type MarkdownPlanNode } from '../markdownPlan'
import { requestMarkdownPlan } from '../chatMarkdownClient'
import { useMarkdownImages } from '../useMarkdownImages'
import { DeferredChatTurn } from './DeferredChatTurn'
import { MarkdownElement, MarkdownFragment, MarkdownNodes } from './MarkdownContent'

// Even a few kilobytes of code and file links expand into a large highlighted
// DOM. Keep parsing off the renderer before a message reaches that size.
export const progressiveMarkdownThreshold = 4_096

type PartProps = {
  node: MarkdownPlanNode
  parent: string
  priority: number
  container?: AppContainerTarget | null
  cwd?: string | null
  onCommit: () => void
  synchronous: boolean
  renderDiagrams: boolean
}

const MarkdownLeaf = memo(function MarkdownLeaf({
  html,
  parent,
  container,
  cwd,
  onCommit,
  synchronous,
  renderDiagrams
}: Omit<PartProps, 'node' | 'priority'> & { html: string }) {
  const fragment = useMemo(
    () => sanitizedFragment(html, parent, synchronous),
    [html, parent, synchronous]
  )
  const committedFragment = useRef<DocumentFragment | null>(null)
  // Flow content can share a DOM-owned boundary. Tables/lists retain their
  // native parent contexts; embedded applications keep their React lifecycle.
  const flat =
    parent === 'div' && !fragment.querySelector('[data-visualization], [data-mermaid-diagram]')
  useLayoutEffect(() => {
    // Revealing an Activity reconnects effects without inserting any new DOM.
    // Replaying every leaf's commit would rerender the whole message again.
    if (committedFragment.current === fragment) return
    committedFragment.current = fragment
    onCommit()
  }, [fragment, onCommit])
  return flat ? (
    <MarkdownFragment fragment={fragment} />
  ) : (
    <MarkdownNodes
      parent={fragment}
      container={container}
      cwd={cwd}
      renderDiagrams={renderDiagrams}
    />
  )
})

const MarkdownPart = memo(function MarkdownPart(props: PartProps) {
  const { node, parent, priority, container, cwd, onCommit, synchronous, renderDiagrams } = props
  const tag = 'tag' in node ? node.tag : null
  const opening = 'tag' in node ? node.opening : null
  const shell = useMemo(
    () =>
      tag ? sanitizedFragment(`${opening}</${tag}>`, parent, synchronous).firstElementChild : null,
    [opening, tag, parent, synchronous]
  )
  if ('html' in node)
    return (
      <DeferredChatTurn eager={synchronous} priority={priority}>
        <MarkdownLeaf
          html={node.html}
          parent={parent}
          container={container}
          cwd={cwd}
          onCommit={onCommit}
          synchronous={synchronous}
          renderDiagrams={renderDiagrams}
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
          synchronous={synchronous}
          renderDiagrams={renderDiagrams}
        />
      ))}
    </MarkdownElement>
  )
})

type PlanSection =
  | { index: number; node: MarkdownPlanNode }
  | { index: number; leaves: { html: string }[] }
const groupFlatSections = (plan: MarkdownPlanNode[] | null): PlanSection[] => {
  const sections: PlanSection[] = []
  for (const [index, node] of (plan ?? []).entries()) {
    // Embedded React applications retain their own component lifecycle.
    if (
      'html' in node &&
      !node.html.includes('data-visualization') &&
      !node.html.includes('data-mermaid-diagram')
    ) {
      const previous = sections.at(-1)
      if (previous && 'leaves' in previous) previous.leaves.push(node)
      else sections.push({ index, leaves: [node] })
    } else sections.push({ index, node })
  }
  return sections
}

const noop = (): void => {}

export function ProgressiveMarkdownContent({
  content,
  html,
  interactiveFileLinks,
  baseUrl,
  footnotePrefix,
  streaming,
  container,
  cwd,
  errorMarkup
}: {
  content: string
  // Small messages are already sanitized by the synchronous renderer. Both
  // paths use the same block tree, preserving DOM when a stream outgrows it.
  html?: string
  interactiveFileLinks: boolean
  baseUrl?: string
  footnotePrefix: string
  streaming: boolean
  container?: AppContainerTarget | null
  cwd?: string | null
  errorMarkup: string
}) {
  const [workerPlan, setPlan] = useState<MarkdownPlanNode[] | null>(null)
  const synchronousPlan = useMemo(
    () => (html === undefined ? null : createMarkdownPlan(html)),
    [html]
  )
  const committedPlan = useRef<MarkdownPlanNode[] | null>(null)
  const plan = synchronousPlan ?? workerPlan ?? committedPlan.current
  useLayoutEffect(() => {
    committedPlan.current = plan
  }, [plan])
  const sections = useMemo(() => groupFlatSections(plan), [plan])
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const onCommit = useCallback(() => startTransition(() => setRevision((value) => value + 1)), [])
  const input = useMemo(
    () => ({ content, interactiveFileLinks, footnotePrefix, baseUrl }),
    [content, interactiveFileLinks, footnotePrefix, baseUrl]
  )
  const resolvedInput = useRef<typeof input | null>(null)
  useEffect(() => {
    if (html !== undefined) return
    // Keep a completed plan across Activity hide/reveal. A pending request is
    // still cancelled on hide and retried, and changed source gets a new plan.
    if (resolvedInput.current === input) return
    let current = true
    const request = requestMarkdownPlan(input)
    request.result
      .then((next) => {
        if (current) {
          resolvedInput.current = input
          startTransition(() => {
            setPlan((previous) => reuseMarkdownPlan(previous, next))
            setFailed(false)
          })
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
  }, [input, html])
  useMarkdownImages(ref, html ?? String(revision), container, cwd, errorMarkup)
  return (
    <div
      ref={ref}
      className="chat-detail__message-markdown chat-detail__message-markdown--progressive"
    >
      {failed ? (
        <pre>{content}</pre>
      ) : plan ? (
        sections.map((section) =>
          'leaves' in section ? (
            <FlatMarkdownSequence
              key={section.index}
              leaves={section.leaves}
              priority={section.index}
              eager={html !== undefined}
              sanitized={html !== undefined}
              onCommit={html === undefined ? onCommit : noop}
            />
          ) : (
            <MarkdownPart
              key={section.index}
              node={section.node}
              parent="div"
              priority={section.index}
              container={container}
              cwd={cwd}
              onCommit={html === undefined ? onCommit : noop}
              synchronous={html !== undefined}
              renderDiagrams={!streaming}
            />
          )
        )
      ) : null}
      {/* The message is already available. Keep a bounded, readable viewport
          until the first formatted part commits instead of inserting another loader. */}
      {!failed &&
        (!plan?.length ||
          (!committedPlan.current?.length && html === undefined && revision === 0)) && (
          <div
            className="chat-detail__message-text"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {content.length > 8_192 ? '…\n' : ''}
            {content.slice(-8_192)}
          </div>
        )}
    </div>
  )
}
