import { createElement, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { RootContent } from 'hast'
import { highlightCode } from '../codeHighlighting'

type HighlightedCodeProps = {
  children: string
  language: string | null
}

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
  const highlighted = useMemo(
    () => highlightCode(children, language)?.map(renderNode) ?? children,
    [children, language]
  )

  return (
    <pre className="chat-detail__highlighted-code">
      <code className={language ? `language-${language}` : undefined}>{highlighted}</code>
    </pre>
  )
}
