import DOMPurify from 'dompurify'

// HTML fragments inside tables need their native parse context. Sanitizing a bare <tr> or
// <tbody> as body HTML would strip the table structure before React could mount it.
export const sanitizedFragment = (
  html: string,
  parent: string,
  alreadySanitized = false
): DocumentFragment => {
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
  const fragment = alreadySanitized
    ? (() => {
        const template = document.createElement('template')
        template.innerHTML = markup
        return template.content
      })()
    : DOMPurify.sanitize(markup, {
        ADD_ATTR: ['target'],
        RETURN_DOM_FRAGMENT: true
      })
  let source: ParentNode = fragment
  for (const tag of context) source = source.querySelector(tag) ?? source
  if (source === fragment) return fragment
  const result = document.createDocumentFragment()
  result.append(...source.childNodes)
  return result
}
