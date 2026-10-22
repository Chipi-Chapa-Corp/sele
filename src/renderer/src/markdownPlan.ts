export type MarkdownPlanNode =
  | { html: string }
  | { tag: string; opening: string; children: MarkdownPlanNode[] }

export const markdownPartCharacters = 8_192
export const markdownPartElements = 100
const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])
type HtmlNode = {
  start: number
  end: number
  openingEnd: number
  tag: string
  elements: number
  children: HtmlNode[]
}

/** Split generated HTML into bounded leaves, retaining nested lists, tables, details and SVG.
 * This is a scheduling plan, not a security boundary: every leaf/shell is sanitized in the UI. */
export const createMarkdownPlan = (html: string): MarkdownPlanNode[] => {
  const root: HtmlNode = {
    start: 0,
    end: html.length,
    openingEnd: 0,
    tag: '',
    elements: 0,
    children: []
  }
  const stack = [root]
  const tags = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
  let offset = 0
  const text = (start: number, end: number) => {
    if (end > start)
      stack
        .at(-1)!
        .children.push({ start, end, openingEnd: start, tag: '', elements: 0, children: [] })
  }
  for (const match of html.matchAll(tags)) {
    const start = match.index!
    text(offset, start)
    offset = start + match[0].length
    if (!match[1]) {
      text(start, offset)
      continue
    }
    const tag = match[1].toLowerCase()
    if (match[0].startsWith('</')) {
      const node = stack.at(-1)!
      if (node.tag === tag) {
        node.end = offset
        stack.pop()
        stack.at(-1)!.elements += node.elements
      } else text(start, offset)
      continue
    }
    const node: HtmlNode = {
      start,
      end: offset,
      openingEnd: offset,
      tag,
      elements: 1,
      children: []
    }
    stack.at(-1)!.children.push(node)
    if (voidTags.has(tag) || match[0].endsWith('/>')) stack.at(-1)!.elements++
    else stack.push(node)
  }
  text(offset, html.length)
  // A streamed <details>/<summary> can still be open. Model the browser's implicit EOF
  // closing instead of falling back to mounting the entire unfinished message at once.
  while (stack.length > 1) {
    const node = stack.pop()!
    node.end = html.length
    stack.at(-1)!.elements += node.elements
  }
  const planChildren = (children: HtmlNode[]): MarkdownPlanNode[] => {
    const result: MarkdownPlanNode[] = []
    let pending = ''
    let elements = 0
    const flush = () => {
      if (pending) result.push({ html: pending })
      pending = ''
      elements = 0
    }
    for (const child of children) {
      const size = child.end - child.start
      if (
        child.tag &&
        (size > markdownPartCharacters || child.elements > markdownPartElements) &&
        child.children.length
      ) {
        flush()
        result.push({
          tag: child.tag,
          opening: html.slice(child.start, child.openingEnd),
          children: planChildren(child.children)
        })
        continue
      }
      if (!child.tag && size > markdownPartCharacters) {
        flush()
        // Keep entities and UTF-16 pairs intact when splitting a very long plain-text node.
        let start = child.start
        while (start < child.end) {
          let end = Math.min(child.end, start + markdownPartCharacters)
          if (end < child.end) {
            const amp = html.lastIndexOf('&', end - 1)
            if (amp >= start && end - amp < 32 && html.indexOf(';', amp) >= end) end = amp
            if (end > start && /[\uD800-\uDBFF]/.test(html[end - 1])) end--
          }
          if (end <= start) end = Math.min(child.end, start + markdownPartCharacters)
          result.push({ html: html.slice(start, end) })
          start = end
        }
        continue
      }
      if (
        pending.length + size > markdownPartCharacters ||
        elements + child.elements > markdownPartElements
      )
        flush()
      pending += html.slice(child.start, child.end)
      elements += child.elements
    }
    flush()
    return result
  }
  return planChildren(root.children)
}
