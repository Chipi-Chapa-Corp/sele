import { useLayoutEffect, useRef, type RefObject } from 'react'
import { createBoundedTextCache } from './boundedTextCache'

// Streaming used to replace a message's innerHTML on every chunk. That detaches the
// text nodes holding the user's selection, so Chromium moved the selection endpoints
// and copying grabbed unrelated text. Patch the live DOM instead: keep nodes whose
// source is unchanged and extend text nodes in place.

// Other hooks replace these elements or their contents after commit. Replace them
// whole when their source changes rather than diffing a subtree we no longer own.
const opaqueSelector =
  '[data-local-image-path], [data-mermaid-diagram], [data-visualization], img, video, iframe, svg'

const parseHtml = (html: string): DocumentFragment => {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

// Reopening a cached conversation still mounts fresh message nodes. Retain a small
// set of inert templates so those mounts can clone instead of reparsing HTML.
// Never cache live/hydrated nodes or the succession of streaming snapshots.
const templateCharacterLimit = 1_000_000
const settledTemplates = createBoundedTextCache<DocumentFragment>(
  32,
  templateCharacterLimit,
  () => 0
)

const mountHtml = (html: string, settled: boolean): DocumentFragment =>
  settled && html.length <= templateCharacterLimit
    ? (settledTemplates.get(html, () => parseHtml(html)).cloneNode(true) as DocumentFragment)
    : parseHtml(html)

const cloneChildren = (parent: Node): Node[] =>
  Array.from(parent.childNodes, (child) => child.cloneNode(true))

const patchAttributes = (live: Element, previous: Element, next: Element): void => {
  for (const { name } of Array.from(previous.attributes)) {
    if (!next.hasAttribute(name)) live.removeAttribute(name)
  }
  for (const { name, value } of Array.from(next.attributes)) {
    if (previous.getAttribute(name) !== value) live.setAttribute(name, value)
  }
}

const patchText = (live: Text, next: string): void => {
  const current = live.data
  const shared = Math.min(current.length, next.length)
  let prefix = 0
  while (prefix < shared && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1
  // Editing only the changed suffix leaves selection offsets before it untouched.
  live.replaceData(prefix, current.length - prefix, next.slice(prefix))
}

const patchNode = (live: Node, previous: Node, next: Node): void => {
  if (previous.isEqualNode(next)) return
  if (live instanceof Text && previous instanceof Text && next instanceof Text) {
    if (live.data === previous.data) {
      patchText(live, next.data)
      return
    }
  } else if (
    live instanceof Element &&
    previous instanceof Element &&
    next instanceof Element &&
    live.localName === next.localName &&
    previous.localName === next.localName &&
    live.namespaceURI === next.namespaceURI &&
    !live.matches(opaqueSelector) &&
    !next.matches(opaqueSelector)
  ) {
    patchAttributes(live, previous, next)
    patchChildren(live, previous, next)
    return
  }
  live.parentNode?.replaceChild(next.cloneNode(true), live)
}

const patchChildren = (live: Node, previous: Node, next: Node): void => {
  const liveChildren = Array.from(live.childNodes)
  const previousChildren = previous.childNodes
  const nextChildren = next.childNodes
  // Positions only correspond while the live tree mirrors its previous source.
  if (liveChildren.length !== previousChildren.length) {
    ;(live as ParentNode).replaceChildren(...cloneChildren(next))
    return
  }
  const shared = Math.min(liveChildren.length, nextChildren.length)
  for (let index = 0; index < shared; index += 1) {
    patchNode(liveChildren[index], previousChildren[index], nextChildren[index])
  }
  for (let index = shared; index < liveChildren.length; index += 1) liveChildren[index].remove()
  const appended: Node[] = []
  for (let index = shared; index < nextChildren.length; index += 1) {
    appended.push(nextChildren[index].cloneNode(true))
  }
  if (appended.length) (live as ParentNode).append(...appended)
}

type PatchedSource = {
  node: HTMLElement
  html: string
  // Parsed lazily: settled messages never change, so they keep only the string.
  fragment: DocumentFragment | null
}

// Owns the children of `ref` unless `html` is null; render it without React children.
export function usePatchedHtml(
  ref: RefObject<HTMLElement | null>,
  html: string | null,
  settled = false
): void {
  const source = useRef<PatchedSource | null>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || html === null) {
      source.current = null
      return
    }
    const previous = source.current
    if (previous?.node === node && previous.html === html) return
    if (previous?.node !== node) {
      node.replaceChildren(mountHtml(html, settled))
      source.current = { node, html, fragment: null }
      return
    }
    const next = parseHtml(html)
    // Stream reveal splits text nodes; merging them keeps selections intact.
    node.normalize()
    patchChildren(node, previous.fragment ?? parseHtml(previous.html), next)
    source.current = { node, html, fragment: next }
  }, [html, ref, settled])
}
