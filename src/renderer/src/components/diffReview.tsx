import { useEffect, useRef, useState } from 'react'
import { Check, MessageSquare, Plus, Trash2 } from 'lucide-react'
import type { ProviderReviewComment } from '../../../shared/provider'
import { toCssRem } from '../cssUnits'
import { Button } from './Button'
import { Input } from './Input'
import './UnifiedDiff.css'

export const reviewMarkerHeight = 32
const reviewMarkerInset = 22.4
const reviewMarkerWidth = 57.6
const reviewBlockGap = 12.8
export const reviewInputWidth = 256

export const noReviewComments: readonly ProviderReviewComment[] = Object.freeze([])

export const reuseReviewMarkers = (
  previous: ReviewMarker[],
  next: ReviewMarker[]
): ReviewMarker[] =>
  previous.length === next.length &&
  previous.every(
    (marker, index) => marker.group === next[index].group && marker.top === next[index].top
  )
    ? previous
    : next

export type DiffReviewLocation = Pick<ProviderReviewComment, 'line' | 'side'> & {
  endLine: number
}

type ReviewCommentGroup = {
  key: string
  line: number
  side: ProviderReviewComment['side']
  comments: ProviderReviewComment[]
}

export type ReviewMarker = {
  group: ReviewCommentGroup
  top: number
}

export const getReviewCommentEndLine = (comment: ProviderReviewComment): number =>
  Math.max(comment.line, comment.endLine ?? comment.line)

export const groupReviewComments = (
  comments: readonly ProviderReviewComment[]
): ReviewCommentGroup[] => {
  const sortedComments = [...comments].sort(
    (first, second) =>
      first.side.localeCompare(second.side) ||
      first.line - second.line ||
      first.id.localeCompare(second.id)
  )
  const groups: ReviewCommentGroup[] = []

  sortedComments.forEach((comment) => {
    const previousGroup = groups.at(-1)
    const firstGroupLine = previousGroup?.comments[0]?.line
    const previousCommentLine = previousGroup?.comments.at(-1)?.line

    if (
      previousGroup &&
      previousGroup.side === comment.side &&
      firstGroupLine != null &&
      previousCommentLine != null &&
      comment.line - previousCommentLine <= 3 &&
      comment.line - firstGroupLine <= 5
    ) {
      previousGroup.comments.push(comment)
      return
    }

    groups.push({
      key: comment.id,
      line: comment.line,
      side: comment.side,
      comments: [comment]
    })
  })

  return groups
}

const ReviewCommentEditor = ({
  comment,
  onChange,
  onDelete,
  onHighlight
}: {
  comment: ProviderReviewComment
  onChange: (id: string, comment: string) => void
  onDelete: (id: string) => void
  onHighlight: (comments: readonly ProviderReviewComment[] | null) => void
}): React.JSX.Element => {
  const [value, setValue] = useState(comment.comment)
  const trimmedValue = value.trim()
  const endLine = getReviewCommentEndLine(comment)
  const lineLabel =
    endLine === comment.line ? `line ${comment.line}` : `lines ${comment.line}-${endLine}`

  const save = (): void => {
    if (!trimmedValue || trimmedValue === comment.comment) return
    setValue(trimmedValue)
    onChange(comment.id, trimmedValue)
  }

  return (
    <form
      className="unified-diff__review-entry"
      onMouseEnter={() => onHighlight([comment])}
      onMouseLeave={() => onHighlight(null)}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Input
        aria-label={`Edit comment on ${lineLabel}`}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <Button
        aria-label="Save comment"
        callback={save}
        disabled={!trimmedValue || trimmedValue === comment.comment}
        icon={<Check aria-hidden="true" />}
        theme="secondary"
        title="Save comment"
      />
      <Button
        aria-label="Delete comment"
        callback={() => {
          onHighlight(null)
          onDelete(comment.id)
        }}
        icon={<Trash2 aria-hidden="true" />}
        theme="secondary"
        title="Delete comment"
      />
    </form>
  )
}

export const ReviewMarkers = ({
  markers,
  onChangeComment,
  onDeleteComment,
  onHighlightComments
}: {
  markers: ReviewMarker[]
  onChangeComment?: (id: string, comment: string) => void
  onDeleteComment?: (id: string) => void
  onHighlightComments: (comments: readonly ProviderReviewComment[] | null) => void
}): React.JSX.Element => {
  const [openCommentIds, setOpenCommentIds] = useState<readonly string[] | null>(null)
  const openComments = openCommentIds
    ? markers.flatMap((marker) =>
        marker.group.comments.filter((comment) => openCommentIds.includes(comment.id))
      )
    : []
  const openMarker =
    markers.find((marker) =>
      marker.group.comments.some((comment) => openCommentIds?.includes(comment.id))
    ) ?? null

  return (
    <>
      {markers.map((marker) => (
        <div
          className="unified-diff__review-marker"
          key={marker.group.key}
          style={{ right: toCssRem(reviewMarkerInset), top: toCssRem(marker.top) }}
        >
          <Button
            aria-label={`Open ${marker.group.comments.length} review comment${marker.group.comments.length === 1 ? '' : 's'} near line ${marker.group.line}`}
            aria-expanded={openMarker?.group.key === marker.group.key}
            callback={() =>
              setOpenCommentIds((currentIds) =>
                marker.group.comments.some((comment) => currentIds?.includes(comment.id))
                  ? null
                  : marker.group.comments.map((comment) => comment.id)
              )
            }
            icon={<MessageSquare aria-hidden="true" />}
            label={marker.group.comments.length}
            theme="secondary"
            title={`Review comments near line ${marker.group.line}`}
            onMouseEnter={() => onHighlightComments(marker.group.comments)}
            onMouseLeave={() => onHighlightComments(null)}
            onMouseUp={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </div>
      ))}
      {openMarker && onChangeComment && onDeleteComment && (
        <div
          className="unified-diff__review-overlay"
          role="dialog"
          aria-label="Review comments"
          style={{
            right: toCssRem(reviewMarkerInset + reviewMarkerWidth + reviewBlockGap),
            top: toCssRem(openMarker.top)
          }}
          onMouseUp={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setOpenCommentIds(null)
          }}
        >
          <div className="unified-diff__review-entries">
            {openComments.map((comment) => (
              <ReviewCommentEditor
                comment={comment}
                key={comment.id}
                onChange={onChangeComment}
                onDelete={onDeleteComment}
                onHighlight={onHighlightComments}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export const ReviewInput = ({
  ariaLabel,
  onCancel,
  onSubmit,
  position
}: {
  ariaLabel: string
  onCancel: () => void
  onSubmit: (comment: string) => void
  position: { left: number; top: number; width?: number }
}): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const trimmedValue = value.trim()

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true })
    )
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const submit = (): void => {
    if (!trimmedValue) return
    onSubmit(trimmedValue)
  }

  return (
    <form
      className="unified-diff__review-form"
      style={{
        left: toCssRem(position.left),
        top: toCssRem(position.top),
        width: position.width === undefined ? undefined : toCssRem(position.width)
      }}
      onMouseUp={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Input
        ref={inputRef}
        aria-label={ariaLabel}
        value={value}
        placeholder="Add a comment"
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onCancel()
        }}
      />
      <Button
        aria-label="Add comment"
        callback={submit}
        disabled={!trimmedValue}
        icon={<Plus aria-hidden="true" />}
        theme="primary"
        title="Add comment"
      />
    </form>
  )
}
