import { createElement, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { RootContent } from 'hast'
import { refractor } from 'refractor'

type HighlightedCodeProps = {
  children: string
  language: string | null
}

const maxHighlightedCodeLength = 100_000

const renderNode = (node: RootContent, key: number): ReactNode => {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null

  const classNames = node.properties.className
  const className = Array.isArray(classNames)
    ? classNames.filter((value): value is string => typeof value === 'string').join(' ')
    : typeof classNames === 'string'
      ? classNames
      : undefined

  return createElement(
    node.tagName,
    { className, key },
    node.children.map((child, index) => renderNode(child, index))
  )
}

export const HighlightedCode = ({
  children,
  language
}: HighlightedCodeProps): React.JSX.Element => {
  const highlighted = useMemo(() => {
    if (
      children.length > maxHighlightedCodeLength ||
      !language ||
      !refractor.registered(language)
    ) {
      return children
    }

    try {
      return refractor.highlight(children, language).children.map(renderNode)
    } catch {
      return children
    }
  }, [children, language])

  return (
    <pre className="chat-detail__highlighted-code">
      <code className={language ? `language-${language}` : undefined}>{highlighted}</code>
    </pre>
  )
}
