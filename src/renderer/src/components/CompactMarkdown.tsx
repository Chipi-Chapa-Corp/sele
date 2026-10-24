import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, useRef } from 'react'
import { usePatchedHtml } from '../markdownDomPatch'
import './CompactMarkdown.css'

/** Inline mode is for button labels: keep formatting without nested interactive elements. */
export function CompactMarkdown({
  content,
  inline = false
}: {
  content: string
  inline?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    const options = { async: false, gfm: true } as const
    return DOMPurify.sanitize(
      inline ? marked.parseInline(content, options) : marked.parse(content, options),
      inline ? { ALLOWED_TAGS: ['strong', 'em', 'del', 's', 'code', 'br', 'kbd'] } : {}
    )
  }, [content, inline])
  usePatchedHtml(ref, html)
  return inline ? (
    <span className="compact-markdown compact-markdown--inline" ref={ref} />
  ) : (
    <div className="compact-markdown" ref={ref} />
  )
}
