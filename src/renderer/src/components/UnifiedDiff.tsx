import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProviderFileDiff, ProviderReviewComment } from '../../../shared/provider'
import {
  Diff,
  findChangeByNewLineNumber,
  findChangeByOldLineNumber,
  getChangeKey
} from 'react-diff-view'
import type { ChangeData, FileData } from 'react-diff-view'
import { getRenderedDiffFiles } from '../unifiedDiffRendering'
import {
  noReviewComments,
  reuseReviewMarkers,
  groupReviewComments,
  getReviewCommentEndLine,
  reviewMarkerHeight,
  reviewInputWidth,
  ReviewMarkers,
  ReviewInput,
  type ReviewMarker,
  type DiffReviewLocation
} from './diffReview'
import 'react-diff-view/style/index.css'
import './UnifiedDiff.css'
export type { DiffReviewLocation } from './diffReview'

const maxStructuredDiffLength = 200_000
const maxStructuredDiffLines = 4_000
const getReviewInputPosition = (host: HTMLElement, selection: DOMRect) => {
  const hostRect = host.getBoundingClientRect()
  const bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (let ancestor = host.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    const rect = ancestor.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      bounds.left = Math.max(bounds.left, rect.left + ancestor.clientLeft)
      bounds.right = Math.min(bounds.right, rect.left + ancestor.clientLeft + ancestor.clientWidth)
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      bounds.top = Math.max(bounds.top, rect.top + ancestor.clientTop)
      bounds.bottom = Math.min(bounds.bottom, rect.top + ancestor.clientTop + ancestor.clientHeight)
    }
  }
  const inset = 6.4
  const width = Math.min(reviewInputWidth, Math.max(1, bounds.right - bounds.left - 2 * inset))
  const height = Math.max(38.4, Number.parseFloat(getComputedStyle(host).fontSize) * 2.4)
  return {
    left:
      Math.max(bounds.left + inset, Math.min(selection.left, bounds.right - width - inset)) -
      hostRect.left,
    top:
      Math.max(
        bounds.top + inset,
        Math.min(selection.bottom + 4.8, bounds.bottom - height - inset)
      ) - hostRect.top,
    width
  }
}

const hasMoreThanLines = (value: string, maxLines: number): boolean => {
  let lineCount = 1
  let index = -1

  while ((index = value.indexOf('\n', index + 1)) >= 0) {
    lineCount += 1
    if (lineCount > maxLines) return true
  }

  return false
}

const getChangeLineNumber = (
  change: ChangeData,
  side: ProviderReviewComment['side']
): number | null => {
  if (change.type === 'normal') {
    return side === 'old' ? change.oldLineNumber : change.newLineNumber
  }
  if (change.type === 'delete') return side === 'old' ? change.lineNumber : null

  return side === 'new' ? change.lineNumber : null
}

const findChangeByLineNumber = (
  { hunks }: FileData,
  side: ProviderReviewComment['side'],
  lineNumber: number
): ChangeData | undefined =>
  side === 'old'
    ? findChangeByOldLineNumber(hunks, lineNumber)
    : findChangeByNewLineNumber(hunks, lineNumber)

const getElement = (node: Node | null): Element | null | undefined =>
  node instanceof Element ? node : node?.parentElement

const getDiffLineTarget = (
  files: readonly { file: FileData }[],
  kind: ProviderFileDiff['kind'],
  line: number | undefined,
  endLine: number | undefined
): { anchorChangeKey: string; changeKeys: string[]; fileIndex: number } | null => {
  if (!line) return null

  const normalizedEndLine = Math.max(line, endLine ?? line)
  const side = kind === 'delete' ? 'old' : 'new'

  for (const [fileIndex, { file }] of files.entries()) {
    const changeKeys = file.hunks.flatMap((hunk) =>
      hunk.changes.flatMap((change) => {
        const lineNumber = getChangeLineNumber(change, side)
        return lineNumber != null && lineNumber >= line && lineNumber <= normalizedEndLine
          ? [getChangeKey(change)]
          : []
      })
    )
    if (changeKeys.length > 0) {
      return { anchorChangeKey: changeKeys[0], changeKeys, fileIndex }
    }
  }

  return null
}

export const UnifiedDiff = ({
  className,
  comments = noReviewComments,
  endLine,
  fileDiff,
  line,
  onAddComment,
  onChangeComment,
  onDeleteComment,
  onCommentSelectionChange
}: {
  className?: string
  comments?: readonly ProviderReviewComment[]
  endLine?: number
  fileDiff: ProviderFileDiff
  line?: number
  onCommentSelectionChange?: (openComment: (() => void) | null) => void
  onAddComment?: (comment: string, location: DiffReviewLocation) => void
  onChangeComment?: (id: string, comment: string) => void
  onDeleteComment?: (id: string) => void
}): React.JSX.Element => {
  const reviewHostRef = useRef<HTMLDivElement>(null)
  const [reviewInputPosition, setReviewInputPosition] = useState<{
    left: number
    top: number
    width?: number
    location: DiffReviewLocation
  } | null>(null)
  const [reviewMarkers, setReviewMarkers] = useState<ReviewMarker[]>([])
  const [highlightedReviewComments, setHighlightedReviewComments] = useState<
    readonly ProviderReviewComment[]
  >([])
  const renderStructuredDiff = useMemo(
    () =>
      fileDiff.diff.length <= maxStructuredDiffLength &&
      !hasMoreThanLines(fileDiff.diff, maxStructuredDiffLines),
    [fileDiff.diff]
  )
  const files = useMemo(
    () => (renderStructuredDiff ? getRenderedDiffFiles(fileDiff) : []),
    [fileDiff, renderStructuredDiff]
  )
  const reviewGroups = useMemo(() => groupReviewComments(comments), [comments])
  const changeLocations = useMemo(() => {
    const locations = new Map<string, DiffReviewLocation>()

    files.forEach(({ file }) => {
      file.hunks.forEach((hunk) => {
        hunk.changes.forEach((change) => {
          const line = change.type === 'normal' ? change.newLineNumber : change.lineNumber
          locations.set(getChangeKey(change), {
            line,
            endLine: line,
            side: change.type === 'delete' ? 'old' : 'new'
          })
        })
      })
    })

    return locations
  }, [files])
  const highlightedChangeKeys = useMemo(
    () =>
      files.map(({ file }) => {
        const changeKeys = new Set<string>()

        highlightedReviewComments.forEach((comment) => {
          for (
            let lineNumber = comment.line;
            lineNumber <= getReviewCommentEndLine(comment);
            lineNumber += 1
          ) {
            const change = findChangeByLineNumber(file, comment.side, lineNumber)
            if (change) changeKeys.add(getChangeKey(change))
          }
        })

        return [...changeKeys]
      }),
    [files, highlightedReviewComments]
  )
  const targetAnchorId = `unified-diff-target-${useId().replace(/:/g, '')}`
  const lineTarget = useMemo(
    () => getDiffLineTarget(files, fileDiff.kind, line, endLine),
    [endLine, fileDiff.kind, files, line]
  )
  const diffClassName = ['unified-diff', className].filter(Boolean).join(' ')

  useEffect(() => {
    if (!lineTarget) return

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(targetAnchorId)
        ?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [lineTarget, targetAnchorId])

  useEffect(() => {
    if (!reviewInputPosition) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest('.unified-diff__review-form') ||
          target.closest('.unified-diff__review-overlay'))
      ) {
        return
      }
      setReviewInputPosition(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [reviewInputPosition])

  useEffect(() => {
    if (!reviewGroups.length) {
      setReviewMarkers((current) => (current.length ? [] : current))
      return
    }
    const host = reviewHostRef.current
    if (!host) return

    let frame = 0
    const updateMarkers = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const hostRect = host.getBoundingClientRect()
        const changeCells = Array.from(host.querySelectorAll<HTMLElement>('[data-change-key]'))
        const fallback = host.querySelector<HTMLElement>('.unified-diff__fallback')
        const fallbackStyle = fallback ? getComputedStyle(fallback) : null
        const fallbackLineHeight = fallbackStyle
          ? Number.parseFloat(fallbackStyle.lineHeight) || 16.8
          : 16.8
        const fallbackPaddingTop = fallbackStyle
          ? Number.parseFloat(fallbackStyle.paddingTop) || 0
          : 0

        const nextMarkers = reviewGroups.flatMap((group) => {
          let changeKey: string | null = null

          for (const { file } of files) {
            const change = findChangeByLineNumber(file, group.side, group.line)
            if (change) {
              changeKey = getChangeKey(change)
              break
            }
          }

          const cell = changeKey
            ? changeCells.find((candidate) => candidate.dataset.changeKey === changeKey)
            : null
          const row = cell?.closest('tr')
          const gutter = row
            ? Array.from(row.querySelectorAll<HTMLElement>('.diff-gutter')).at(-1)
            : null

          if (row && gutter) {
            const rowRect = row.getBoundingClientRect()
            return [
              {
                group,
                top: rowRect.top - hostRect.top + rowRect.height / 2 - reviewMarkerHeight / 2
              }
            ]
          }

          if (fallback) {
            const fallbackRect = fallback.getBoundingClientRect()
            return [
              {
                group,
                top:
                  fallbackRect.top -
                  hostRect.top +
                  fallbackPaddingTop +
                  (group.line - 1) * fallbackLineHeight
              }
            ]
          }

          return []
        })
        setReviewMarkers((current) => reuseReviewMarkers(current, nextMarkers))
      })
    }
    const handleScroll = (event: Event): void => {
      // Markers move with their host. Scrolling a sibling sidebar or an outer
      // conversation does not change their offset within that host.
      if (event.target instanceof Node && host.contains(event.target)) updateMarkers()
    }

    updateMarkers()
    const resizeObserver = new ResizeObserver(updateMarkers)
    resizeObserver.observe(host)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', updateMarkers)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', updateMarkers)
    }
  }, [files, reviewGroups])

  const handleSelection = useCallback((): void => {
    onCommentSelectionChange?.(null)
    if (!onAddComment) return

    const host = reviewHostRef.current
    const selection = window.getSelection()
    if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) return

    const anchorElement = getElement(selection.anchorNode)
    const focusElement = getElement(selection.focusNode)
    if (
      !anchorElement ||
      !focusElement ||
      !host.contains(anchorElement) ||
      !host.contains(focusElement) ||
      (!anchorElement.closest('.diff-code, .unified-diff__fallback') &&
        !focusElement.closest('.diff-code, .unified-diff__fallback'))
    ) {
      return
    }

    const selectedRange = selection.getRangeAt(0).cloneRange()
    const anchorChangeKey =
      anchorElement.closest<HTMLElement>('[data-change-key]')?.dataset.changeKey
    const focusChangeKey = focusElement.closest<HTMLElement>('[data-change-key]')?.dataset.changeKey
    const anchorLocation = anchorChangeKey ? changeLocations.get(anchorChangeKey) : undefined
    const focusLocation = focusChangeKey ? changeLocations.get(focusChangeKey) : undefined
    const selectedLocations = focusLocation
      ? Array.from(host.querySelectorAll<HTMLElement>('.diff-code[data-change-key]'))
          .filter((cell) => selectedRange.intersectsNode(cell))
          .flatMap((cell) => {
            const changeKey = cell.dataset.changeKey
            const cellLocation = changeKey ? changeLocations.get(changeKey) : undefined
            return cellLocation?.side === focusLocation.side ? [cellLocation] : []
          })
      : []
    let location =
      focusLocation && selectedLocations.length > 0
        ? {
            line: Math.min(...selectedLocations.map((candidate) => candidate.line)),
            endLine: Math.max(...selectedLocations.map((candidate) => candidate.endLine)),
            side: focusLocation.side
          }
        : anchorLocation && focusLocation && anchorLocation.side === focusLocation.side
          ? {
              line: Math.min(anchorLocation.line, focusLocation.line),
              endLine: Math.max(anchorLocation.endLine, focusLocation.endLine),
              side: focusLocation.side
            }
          : focusLocation

    if (!location) {
      const fallback = focusElement.closest<HTMLElement>('.unified-diff__fallback')
      if (
        fallback &&
        selection.anchorNode &&
        selection.focusNode &&
        fallback.contains(selection.anchorNode) &&
        fallback.contains(selection.focusNode)
      ) {
        const getLineNumber = (node: Node, offset: number): number => {
          const rangeToPosition = document.createRange()
          rangeToPosition.selectNodeContents(fallback)
          rangeToPosition.setEnd(node, offset)
          return rangeToPosition.toString().split('\n').length
        }
        const anchorLine = getLineNumber(selection.anchorNode, selection.anchorOffset)
        const focusLine = getLineNumber(selection.focusNode, selection.focusOffset)
        location = {
          line: Math.min(anchorLine, focusLine),
          endLine: Math.max(anchorLine, focusLine),
          side: fileDiff.kind === 'delete' ? 'old' : 'new'
        }
      }
    }
    if (!location) return

    const selectedLocation = location
    onCommentSelectionChange?.(() =>
      setReviewInputPosition({
        ...getReviewInputPosition(host, selectedRange.getBoundingClientRect()),
        location: selectedLocation
      })
    )
  }, [changeLocations, fileDiff.kind, onAddComment, onCommentSelectionChange])

  useEffect(() => {
    if (!onAddComment) return
    document.addEventListener('selectionchange', handleSelection)
    return () => {
      document.removeEventListener('selectionchange', handleSelection)
      onCommentSelectionChange?.(null)
    }
  }, [handleSelection, onAddComment, onCommentSelectionChange])

  const renderedDiff =
    files.length === 0 ? (
      <pre className="unified-diff__fallback">{fileDiff.diff}</pre>
    ) : (
      files.map(({ file, tokens }, index) => {
        const target = lineTarget?.fileIndex === index ? lineTarget : undefined
        const targetAnchorChangeKey = target?.anchorChangeKey
        const hoveredChangeKeys = highlightedChangeKeys[index] ?? []
        const selectedChanges =
          hoveredChangeKeys.length > 0 ? hoveredChangeKeys : (target?.changeKeys ?? [])

        return (
          <Diff
            className={diffClassName}
            diffType={file.type}
            generateAnchorID={
              targetAnchorChangeKey
                ? (change) =>
                    getChangeKey(change) === targetAnchorChangeKey ? targetAnchorId : undefined
                : undefined
            }
            hunks={file.hunks}
            key={`${file.oldPath}:${file.newPath}:${index}`}
            selectedChanges={selectedChanges}
            tokens={tokens}
            viewType="unified"
          />
        )
      })
    )

  if (!onAddComment && comments.length === 0) return <>{renderedDiff}</>

  return (
    <div className="unified-diff__review-host" ref={reviewHostRef}>
      {renderedDiff}
      <ReviewMarkers
        markers={reviewMarkers}
        onChangeComment={onChangeComment}
        onDeleteComment={onDeleteComment}
        onHighlightComments={(highlightedComments) =>
          setHighlightedReviewComments(highlightedComments ?? [])
        }
      />
      {reviewInputPosition && onAddComment && (
        <ReviewInput
          ariaLabel={`Comment on ${fileDiff.path}`}
          position={reviewInputPosition}
          onCancel={() => setReviewInputPosition(null)}
          onSubmit={(comment) => {
            onAddComment(comment, reviewInputPosition.location)
            setReviewInputPosition(null)
            window.getSelection()?.removeAllRanges()
          }}
        />
      )}
    </div>
  )
}
