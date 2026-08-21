import { useState } from 'react'
import { ArrowUpRight, ChevronRight, GripVertical, Link2, Pin, PinOff } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import type { AppContainerTarget } from '../../../shared/app'
import {
  getRecentChatReferenceKey,
  type PinnedChatTextReference,
  type RecentChatReference,
  type RecentChatFileReference
} from '../chatRecents'
import type { RecentlyOpenedFile } from '../recentlyOpenedFiles'
import type { PinnedRecentReference } from '../recentReferencePins'
import { Button } from './Button'
import { MarkdownMessage } from './ChatDetailItem'

type RecentReferenceListItem = PinnedRecentReference
type RecentReferenceFile = RecentChatFileReference | RecentlyOpenedFile

type RecentReferencesListProps = {
  canOpenFiles: boolean
  container?: AppContainerTarget | null
  cwd?: string | null
  openedFiles: RecentlyOpenedFile[]
  pinnedReferences: PinnedRecentReference[]
  recentReferences: RecentChatReference[]
  onOpenFile: (reference: RecentReferenceFile, recordAsOpened: boolean) => void
  onGoToText: (reference: PinnedChatTextReference) => void
  onReorderPinned: (references: PinnedRecentReference[]) => void
  onTogglePinned: (reference: PinnedRecentReference) => void
  onUnpinAll: () => void
}

type RecentReferenceRowProps = {
  dragging: boolean
  dropPosition: 'before' | 'after' | null
  canOpenFiles: boolean
  container?: AppContainerTarget | null
  cwd?: string | null
  pinned: boolean
  pinnable: boolean
  recordAsOpened: boolean
  reference: RecentReferenceListItem
  onDragEnd?: () => void
  onDragOver?: (event: React.DragEvent<HTMLLIElement>) => void
  onDragStart?: (event: React.DragEvent<HTMLLIElement>) => void
  onOpenFile: (reference: RecentReferenceFile, recordAsOpened: boolean) => void
  onGoToText: (reference: PinnedChatTextReference) => void
  onTogglePinned: (reference: PinnedRecentReference) => void
}

const RecentReferenceRow: React.FC<RecentReferenceRowProps> = ({
  dragging,
  dropPosition,
  canOpenFiles,
  container,
  cwd,
  pinned,
  pinnable,
  recordAsOpened,
  reference,
  onDragEnd,
  onDragOver,
  onDragStart,
  onOpenFile,
  onGoToText,
  onTogglePinned
}) => {
  const [textExpanded, setTextExpanded] = useState(false)
  const itemClassName = [
    'changes-sidebar__recent-item',
    pinnable ? 'changes-sidebar__recent-item--pinnable' : null,
    reference.kind === 'text' ? 'changes-sidebar__recent-item--text' : null,
    pinned ? 'changes-sidebar__recent-item--pinned' : null,
    dragging ? 'changes-sidebar__recent-item--dragging' : null,
    dropPosition ? `changes-sidebar__recent-item--drop-${dropPosition}` : null
  ]
    .filter(Boolean)
    .join(' ')

  if (reference.kind === 'text') {
    const content = reference.content.trim()
    const firstLine = content.split(/\r?\n/, 1)[0].trim()
    const toggleTextExpanded = (): void => setTextExpanded((expanded) => !expanded)
    const handleTextBodyClick = (event: React.MouseEvent<HTMLDivElement>): void => {
      if (event.target instanceof Element && event.target.closest('a, button')) return
      toggleTextExpanded()
    }
    const handleOpenFileLink = canOpenFiles
      ? (path: string, displayPath: string, line?: number, endLine?: number): void => {
          onOpenFile(
            {
              kind: 'file',
              path,
              displayPath,
              label: displayPath.split(/[\\/]/).at(-1) ?? displayPath,
              line,
              endLine
            },
            true
          )
        }
      : undefined

    return (
      <li
        className={itemClassName}
        draggable={pinned}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
      >
        <span className="changes-sidebar__recent-drag-handle" title="Drag to reorder">
          <GripVertical aria-hidden="true" />
        </span>
        <div className="changes-sidebar__recent-text-body" onClick={handleTextBodyClick}>
          <button
            className="changes-sidebar__recent-text-toggle"
            type="button"
            aria-expanded={textExpanded}
            aria-label={textExpanded ? 'Collapse pinned message' : 'Expand pinned message'}
            title={textExpanded ? 'Collapse pinned message' : 'Expand pinned message'}
            onClick={toggleTextExpanded}
          >
            <ChevronRight
              className={`changes-sidebar__recent-text-chevron${
                textExpanded ? ' changes-sidebar__recent-text-chevron--expanded' : ''
              }`}
              aria-hidden="true"
            />
          </button>
          {textExpanded ? (
            <MarkdownMessage
              className="changes-sidebar__recent-text-content changes-sidebar__recent-text-content--expanded chat-detail__message"
              content={content}
              localImageContainer={container}
              localImageCwd={cwd}
              onOpenFileLink={handleOpenFileLink}
              preserveLineBreaks={reference.role === 'user'}
            />
          ) : (
            <span className="changes-sidebar__recent-text-content">{firstLine}</span>
          )}
        </div>
        <span className="changes-sidebar__recent-actions">
          <Button
            theme="transparent"
            size="small"
            aria-label="Go to pinned message"
            title="Go to message"
            callback={() => onGoToText(reference)}
            icon={<ArrowUpRight aria-hidden="true" />}
          />
          <Button
            theme="transparent"
            size="small"
            aria-label="Unpin message"
            title="Unpin"
            callback={() => onTogglePinned(reference)}
            icon={<PinOff aria-hidden="true" />}
          />
        </span>
      </li>
    )
  }

  const title =
    reference.kind === 'file'
      ? `Open ${reference.displayPath}${reference.line ? ` at line ${reference.line}` : ''}`
      : reference.href
  const content = (
    <>
      <span className="changes-sidebar__recent-icon" aria-hidden="true">
        {reference.kind === 'file' ? (
          <SymbolsFileIcon fileName={reference.displayPath} autoAssign />
        ) : (
          <Link2 />
        )}
      </span>
      <span className="changes-sidebar__recent-label">{reference.label}</span>
    </>
  )

  return (
    <li
      className={itemClassName}
      draggable={pinned}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
    >
      {pinned && (
        <span className="changes-sidebar__recent-drag-handle" title="Drag to reorder">
          <GripVertical aria-hidden="true" />
        </span>
      )}
      {reference.kind === 'file' ? (
        <button
          className="changes-sidebar__recent-row"
          type="button"
          aria-label={title}
          title={title}
          disabled={!canOpenFiles}
          onClick={() => onOpenFile(reference, recordAsOpened)}
        >
          {content}
        </button>
      ) : (
        <a
          className="changes-sidebar__recent-row"
          draggable={false}
          href={reference.href}
          rel="noreferrer"
          target="_blank"
          title={title}
        >
          {content}
        </a>
      )}
      {pinnable && (
        <span className="changes-sidebar__recent-actions">
          <Button
            theme="transparent"
            size="small"
            aria-label={pinned ? `Unpin ${reference.label}` : `Pin ${reference.label}`}
            title={pinned ? 'Unpin' : 'Pin'}
            callback={() => onTogglePinned(reference)}
            icon={pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          />
        </span>
      )}
    </li>
  )
}

export const RecentReferencesList: React.FC<RecentReferencesListProps> = ({
  canOpenFiles,
  container,
  cwd,
  openedFiles,
  pinnedReferences,
  recentReferences,
  onOpenFile,
  onGoToText,
  onReorderPinned,
  onTogglePinned,
  onUnpinAll
}) => {
  const [draggedReferenceKey, setDraggedReferenceKey] = useState<string | null>(null)
  const [dropInsertionIndex, setDropInsertionIndex] = useState<number | null>(null)

  const resetDrag = (): void => {
    setDraggedReferenceKey(null)
    setDropInsertionIndex(null)
  }

  const handleDragStart = (
    event: React.DragEvent<HTMLLIElement>,
    reference: PinnedRecentReference
  ): void => {
    const referenceKey = getRecentChatReferenceKey(reference)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', referenceKey)
    setDraggedReferenceKey(referenceKey)
    setDropInsertionIndex(null)
  }

  const handleDragOver = (
    event: React.DragEvent<HTMLLIElement>,
    reference: PinnedRecentReference
  ): void => {
    if (!draggedReferenceKey) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const targetReferenceKey = getRecentChatReferenceKey(reference)
    if (targetReferenceKey === draggedReferenceKey) {
      setDropInsertionIndex(null)
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const targetIndex = pinnedReferences.findIndex(
      (candidate) => getRecentChatReferenceKey(candidate) === targetReferenceKey
    )
    if (targetIndex < 0) return

    setDropInsertionIndex(targetIndex + (event.clientY < bounds.top + bounds.height / 2 ? 0 : 1))
  }

  const handleDrop = (event: React.DragEvent<HTMLUListElement>): void => {
    event.preventDefault()
    if (draggedReferenceKey && dropInsertionIndex !== null) {
      const draggedIndex = pinnedReferences.findIndex(
        (reference) => getRecentChatReferenceKey(reference) === draggedReferenceKey
      )
      if (draggedIndex >= 0) {
        const nextReferences = [...pinnedReferences]
        const [draggedReference] = nextReferences.splice(draggedIndex, 1)
        const insertionIndex =
          draggedIndex < dropInsertionIndex ? dropInsertionIndex - 1 : dropInsertionIndex
        nextReferences.splice(insertionIndex, 0, draggedReference)
        const orderChanged = nextReferences.some(
          (reference, index) =>
            getRecentChatReferenceKey(reference) !==
            getRecentChatReferenceKey(pinnedReferences[index])
        )
        if (orderChanged) onReorderPinned(nextReferences)
      }
    }
    resetDrag()
  }

  return (
    <div className="changes-sidebar__recent-groups">
      {pinnedReferences.length > 0 && (
        <section className="changes-sidebar__recent-group" aria-label="Pinned references">
          <div className="changes-sidebar__recent-group-header">
            <span>Pinned</span>
            <Button
              theme="transparent"
              size="small"
              aria-label="Unpin all references"
              title="Unpin all"
              callback={onUnpinAll}
              icon={<PinOff aria-hidden="true" />}
            />
          </div>
          <ul
            className={`changes-sidebar__recents${
              draggedReferenceKey ? ' changes-sidebar__recents--dragging' : ''
            }`}
            onDragOver={(event) => {
              if (!draggedReferenceKey) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={handleDrop}
          >
            {pinnedReferences.map((reference, index) => {
              const referenceKey = getRecentChatReferenceKey(reference)
              const dropPosition =
                dropInsertionIndex === index
                  ? 'before'
                  : index === pinnedReferences.length - 1 &&
                      dropInsertionIndex === pinnedReferences.length
                    ? 'after'
                    : null

              return (
                <RecentReferenceRow
                  key={referenceKey}
                  canOpenFiles={canOpenFiles}
                  container={container}
                  cwd={cwd}
                  dragging={referenceKey === draggedReferenceKey}
                  dropPosition={dropPosition}
                  pinned
                  pinnable
                  recordAsOpened
                  reference={reference}
                  onDragEnd={resetDrag}
                  onDragOver={(event) => handleDragOver(event, reference)}
                  onDragStart={(event) => handleDragStart(event, reference)}
                  onOpenFile={onOpenFile}
                  onGoToText={onGoToText}
                  onTogglePinned={onTogglePinned}
                />
              )
            })}
          </ul>
        </section>
      )}
      {recentReferences.length > 0 && (
        <section className="changes-sidebar__recent-group" aria-label="Recent references">
          {(pinnedReferences.length > 0 || openedFiles.length > 0) && (
            <div className="changes-sidebar__recent-group-header">
              <span>Recent</span>
            </div>
          )}
          <ul className="changes-sidebar__recents">
            {recentReferences.map((reference) => (
              <RecentReferenceRow
                key={getRecentChatReferenceKey(reference)}
                canOpenFiles={canOpenFiles}
                container={container}
                cwd={cwd}
                dragging={false}
                dropPosition={null}
                pinned={false}
                pinnable
                recordAsOpened
                reference={reference}
                onOpenFile={onOpenFile}
                onGoToText={onGoToText}
                onTogglePinned={onTogglePinned}
              />
            ))}
          </ul>
        </section>
      )}
      {openedFiles.length > 0 && (
        <section className="changes-sidebar__recent-group" aria-label="Recently opened files">
          <div className="changes-sidebar__recent-group-header">
            <span>Opened</span>
          </div>
          <ul className="changes-sidebar__recents">
            {openedFiles.map((file) => (
              <RecentReferenceRow
                key={getRecentChatReferenceKey(file)}
                canOpenFiles={canOpenFiles}
                container={container}
                cwd={cwd}
                dragging={false}
                dropPosition={null}
                pinned={false}
                pinnable
                recordAsOpened={false}
                reference={file}
                onOpenFile={onOpenFile}
                onGoToText={onGoToText}
                onTogglePinned={onTogglePinned}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
