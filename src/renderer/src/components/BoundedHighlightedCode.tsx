import { memo, useState } from 'react'
import { HighlightedCode } from './HighlightedCode'

export const defaultRenderedCodeLimit = 200_000

type BoundedHighlightedCodeProps = {
  children: string
  language: string | null
  maxLength?: number
}

const BoundedHighlightedCodeComponent = ({
  children,
  language,
  maxLength = defaultRenderedCodeLimit
}: BoundedHighlightedCodeProps): React.ReactElement => {
  const [expansion, setExpansion] = useState({ content: children, expanded: false })
  const expanded = expansion.content === children && expansion.expanded
  const truncated = children.length > maxLength
  const visibleContent = truncated && !expanded ? children.slice(-maxLength) : children
  const omittedCharacterCount = children.length - visibleContent.length

  return (
    <div className="chat-detail__bounded-output">
      {omittedCharacterCount > 0 && (
        <p className="chat-detail__bounded-output-note">
          Showing the latest {maxLength.toLocaleString()} characters;{' '}
          {omittedCharacterCount.toLocaleString()} earlier characters are hidden.
        </p>
      )}
      <HighlightedCode language={language}>{visibleContent}</HighlightedCode>
      {truncated && (
        <button
          className="chat-detail__bounded-output-toggle"
          type="button"
          onClick={() => setExpansion({ content: children, expanded: !expanded })}
        >
          {expanded ? 'Show truncated output' : 'Load full output'}
        </button>
      )}
    </div>
  )
}

export const BoundedHighlightedCode = memo(BoundedHighlightedCodeComponent)
