import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { MessageSquare } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderReviewComment } from '../../../shared/provider'
import { AttachmentChip } from './AttachmentChip'
import './ReviewCommentsButton.css'

type ReviewCommentsButtonProps = {
  className?: string
  comments: readonly ProviderReviewComment[]
  disabled?: boolean
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onRemove?: () => void
  projectCwd?: string | null
}

type ReviewCommentGroup = {
  comments: ProviderReviewComment[]
  displayPath: string
  path: string
}

const getProjectRelativePath = (path: string, projectCwd: string | null | undefined): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const rawProjectCwd = projectCwd?.trim().replace(/\\/g, '/')
  const normalizedProjectCwd =
    rawProjectCwd === '/' || /^[A-Za-z]:\/$/.test(rawProjectCwd ?? '')
      ? rawProjectCwd
      : rawProjectCwd?.replace(/\/+$/, '')

  if (!normalizedProjectCwd) return normalizedPath.replace(/^\.\//, '')

  const caseInsensitive = /^(?:[A-Za-z]:\/|\/\/)/.test(normalizedProjectCwd)
  const comparisonPath = caseInsensitive ? normalizedPath.toLocaleLowerCase() : normalizedPath
  const comparisonProjectCwd = caseInsensitive
    ? normalizedProjectCwd.toLocaleLowerCase()
    : normalizedProjectCwd

  if (comparisonPath === comparisonProjectCwd) {
    return normalizedPath.split('/').filter(Boolean).at(-1) ?? normalizedPath
  }

  const projectPrefix = comparisonProjectCwd.endsWith('/')
    ? comparisonProjectCwd
    : `${comparisonProjectCwd}/`

  if (!comparisonPath.startsWith(projectPrefix)) return normalizedPath.replace(/^\.\//, '')

  return normalizedPath.slice(projectPrefix.length)
}

const getMenuStyle = (buttonRect: DOMRect): CSSProperties => {
  const viewportInset = 12
  const menuOffset = 6
  const menuWidth = Math.max(0, Math.min(420, window.innerWidth - viewportInset * 2))
  const bottomSpace = window.innerHeight - buttonRect.bottom
  const openUp = bottomSpace < 300 && buttonRect.top > bottomSpace
  const preferredLeft = buttonRect.right - menuWidth
  const maxLeft = Math.max(viewportInset, window.innerWidth - menuWidth - viewportInset)
  const style: CSSProperties = {
    left: Math.min(Math.max(viewportInset, preferredLeft), maxLeft),
    width: menuWidth
  }

  if (openUp) {
    style.bottom = window.innerHeight - buttonRect.top + menuOffset
  } else {
    style.top = buttonRect.bottom + menuOffset
  }

  return style
}

const getLocationLabel = (comment: ProviderReviewComment): string => {
  const endLine = Math.max(comment.line, comment.endLine ?? comment.line)

  if (endLine === comment.line) return `${comment.line}`

  return `${comment.line}-${endLine}`
}

export const ReviewCommentsButton: React.FC<ReviewCommentsButtonProps> = ({
  className,
  comments,
  disabled = false,
  onOpenFileLink,
  onRemove,
  projectCwd
}) => {
  const reactId = useId().replace(/:/g, '')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const menuId = `review-comments-menu-${reactId}`
  const commentLabel = `${comments.length} review comment${comments.length === 1 ? '' : 's'}`
  const groups = useMemo(() => {
    const commentsByPath = new Map<string, ReviewCommentGroup>()

    comments.forEach((comment) => {
      const normalizedPath = comment.path.replace(/\\/g, '/')
      const existingGroup = commentsByPath.get(normalizedPath)

      if (existingGroup) {
        existingGroup.comments.push(comment)
        return
      }

      commentsByPath.set(normalizedPath, {
        comments: [comment],
        displayPath: getProjectRelativePath(normalizedPath, projectCwd),
        path: comment.path
      })
    })

    return Array.from(commentsByPath.values())
  }, [comments, projectCwd])

  const closeMenu = useCallback((): void => {
    setOpen(false)
    setMenuStyle(null)
  }, [])

  const updateMenuPosition = useCallback((): void => {
    const buttonRect = buttonRef.current?.getBoundingClientRect()

    if (!buttonRect || buttonRect.bottom < 0 || buttonRect.top > window.innerHeight) {
      closeMenu()
      return
    }

    setMenuStyle(getMenuStyle(buttonRect))
  }, [closeMenu])

  const openMenu = (): void => {
    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getMenuStyle(buttonRect))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    menuRef.current?.focus({ preventScroll: true })

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node

      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu()
      }
    }

    const handleResize = (): void => updateMenuPosition()
    const handleScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return

      updateMenuPosition()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [closeMenu, open, updateMenuPosition])

  const handleOpenFile = (
    path: string,
    displayPath: string,
    line?: number,
    endLine?: number
  ): void => {
    if (!onOpenFileLink) return

    closeMenu()
    onOpenFileLink(path, displayPath, line, endLine)
  }

  const menu = open ? (
    <div
      ref={menuRef}
      className="review-comments-menu"
      id={menuId}
      role="dialog"
      aria-label={commentLabel}
      style={menuStyle ?? undefined}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return

        event.preventDefault()
        closeMenu()
        buttonRef.current?.focus({ preventScroll: true })
      }}
    >
      <div className="review-comments-menu__items">
        {groups.map((group, groupIndex) => {
          const groupLabelId = `${menuId}-group-${groupIndex}`
          const fileName = group.displayPath.split('/').filter(Boolean).at(-1) ?? group.displayPath
          const pathContent = (
            <>
              <span className="review-comments-menu__file-icon" aria-hidden="true">
                <SymbolsFileIcon fileName={fileName} autoAssign />
              </span>
              <span className="review-comments-menu__path" title={group.displayPath}>
                {group.displayPath}
              </span>
              <span
                className="review-comments-menu__count"
                aria-label={`${group.comments.length} comment${group.comments.length === 1 ? '' : 's'}`}
              >
                {group.comments.length}
              </span>
            </>
          )

          return (
            <section
              className="review-comments-menu__group"
              key={group.path}
              aria-labelledby={groupLabelId}
            >
              {onOpenFileLink ? (
                <button
                  className="review-comments-menu__file"
                  id={groupLabelId}
                  type="button"
                  title={`Open ${group.displayPath}`}
                  onClick={() => handleOpenFile(group.path, group.displayPath)}
                >
                  {pathContent}
                </button>
              ) : (
                <div className="review-comments-menu__file" id={groupLabelId}>
                  {pathContent}
                </div>
              )}
              <div className="review-comments-menu__comments">
                {group.comments.map((comment, commentIndex) => {
                  const commentContent = (
                    <>
                      <span className="review-comments-menu__location">
                        {getLocationLabel(comment)}
                      </span>
                      <span className="review-comments-menu__separator" aria-hidden="true">
                        ·
                      </span>
                      <span className="review-comments-menu__text">{comment.comment}</span>
                    </>
                  )
                  const endLine = Math.max(comment.line, comment.endLine ?? comment.line)
                  const lineTitle =
                    endLine === comment.line
                      ? `line ${comment.line}`
                      : `lines ${comment.line}-${endLine}`

                  return onOpenFileLink ? (
                    <button
                      className="review-comments-menu__comment review-comments-menu__comment--interactive"
                      key={`${comment.id}:${commentIndex}`}
                      type="button"
                      title={`Open ${group.displayPath} at ${lineTitle}`}
                      onClick={() =>
                        handleOpenFile(group.path, group.displayPath, comment.line, endLine)
                      }
                    >
                      {commentContent}
                    </button>
                  ) : (
                    <div
                      className="review-comments-menu__comment"
                      key={`${comment.id}:${commentIndex}`}
                    >
                      {commentContent}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  ) : null
  const handleTriggerClick = (): void => {
    if (open) closeMenu()
    else openMenu()
  }

  return (
    <>
      {onRemove ? (
        <AttachmentChip
          active={open}
          callback={handleTriggerClick}
          callbackAriaLabel={`Show ${commentLabel}`}
          callbackTitle={commentLabel}
          icon={<MessageSquare aria-hidden="true" />}
          label={
            <>
              Review <span aria-hidden="true">·</span> {comments.length}
            </>
          }
          removeAriaLabel="Remove review"
          removeCallback={onRemove}
          removeDisabled={disabled}
          removeTitle="Remove review"
          triggerAriaControls={open ? menuId : undefined}
          triggerAriaExpanded={open}
          triggerAriaHasPopup="dialog"
          triggerRef={buttonRef}
        />
      ) : (
        <button
          ref={buttonRef}
          className={className}
          type="button"
          aria-controls={open ? menuId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Show ${commentLabel}`}
          disabled={disabled}
          title={commentLabel}
          onClick={handleTriggerClick}
        >
          <MessageSquare aria-hidden="true" />
          <span>
            Review <span aria-hidden="true">·</span> {comments.length}
          </span>
        </button>
      )}
      {menu && createPortal(menu, document.body)}
    </>
  )
}
