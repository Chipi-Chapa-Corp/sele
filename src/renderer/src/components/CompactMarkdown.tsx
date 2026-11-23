import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, useRef } from 'react'
import { usePatchedHtml } from '../markdownDomPatch'
import './CompactMarkdown.css'

/** Inline mode is for button labels: keep formatting without nested interactive elements. */
export function CompactMarkdown({
  content,
  inline = false,
  staticPreview = false
}: {
  content: string
  inline?: boolean
  staticPreview?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    const options = { async: false, gfm: true } as const
    return DOMPurify.sanitize(
      inline ? marked.parseInline(content, options) : marked.parse(content, options),
      inline
        ? { ALLOWED_TAGS: ['strong', 'em', 'del', 's', 'code', 'br', 'kbd'] }
        : staticPreview
          ? {
              ALLOWED_TAGS: [
                'p',
                'strong',
                'em',
                'del',
                'code',
                'pre',
                'br',
                'h1',
                'h2',
                'h3',
                'h4',
                'h5',
                'h6',
                'blockquote',
                'hr',
                'ul',
                'ol',
                'li',
                'table',
                'thead',
                'tbody',
                'tr',
                'th',
                'td'
              ],
              ALLOWED_ATTR: ['start'],
              ALLOW_DATA_ATTR: false
            }
          : {}
    )
  }, [content, inline, staticPreview])
  usePatchedHtml(ref, html)
  return inline ? (
    <span className="compact-markdown compact-markdown--inline" ref={ref} />
  ) : (
    <div className="compact-markdown" ref={ref} />
  )
}
