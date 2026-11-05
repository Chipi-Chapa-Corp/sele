import type { ReactNode, RefObject } from 'react'
import { memo } from 'react'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderWorkingItem } from '../../../shared/provider'
import { ToolItem, isWorkingItemPayloadLoaded } from './ChatToolActivity'
import { MarkdownMessage } from './MarkdownMessage'
import { ToolSequence } from './ToolSequence'
import { ThoughtRow } from './WorkingDisclosure'
import {
  workingItemPageSize,
  type ProviderToolItem,
  type WorkingBlock
} from './workingStepPresentation'

type WorkingStepContentProps = {
  workingContentRef: RefObject<HTMLDivElement | null>
  renderedSegments: {
    blocks: WorkingBlock[]
    generatedImages: ProviderToolItem[]
    kind: 'history' | 'tail'
    startIndex: number
    items: ProviderWorkingItem[]
  }[]
  onLoad: ((startIndex?: number) => Promise<void> | void) | undefined
  loadState: 'idle' | 'loading' | 'error'
  loadPage: (startIndex: number) => Promise<void>
  activeToolIds: Set<string>
  active: boolean
  lastWorkingItem: ProviderWorkingItem | undefined
  onLoadItem: ((itemId: string) => Promise<void> | void) | undefined
  onLoadToolPage: ((workingItemId: string, startIndex: number) => Promise<void> | void) | undefined
  onDisclosureToggle: (() => void) | undefined
  projectCwd: string | null | undefined
  container: AppContainerTarget | null | undefined
  cwd: string | null | undefined
  onOpenFileLink:
    | ((path: string, displayPath: string, line?: number, endLine?: number) => void)
    | undefined
  itemCount: number
  activityContent: ReactNode
}

export const WorkingStepContent = memo(function WorkingStepContent({
  workingContentRef,
  renderedSegments,
  onLoad,
  loadState,
  loadPage,
  activeToolIds,
  active,
  lastWorkingItem,
  onLoadItem,
  onLoadToolPage,
  onDisclosureToggle,
  projectCwd,
  container,
  cwd,
  onOpenFileLink,
  itemCount,
  activityContent
}: WorkingStepContentProps) {
  return (
    <div ref={workingContentRef} className="chat-detail__step-content">
      {renderedSegments.flatMap((segment, segmentIndex) => {
        const previousSegment = renderedSegments[segmentIndex - 1]
        const previousEndIndex = previousSegment
          ? previousSegment.startIndex + previousSegment.items.length
          : 0
        const hiddenItemCount = Math.max(0, segment.startIndex - previousEndIndex)
        const loadStartIndex = previousSegment
          ? previousEndIndex
          : Math.max(0, segment.startIndex - workingItemPageSize)
        const pageItemCount = Math.min(workingItemPageSize, hiddenItemCount)

        // Offsets move as the live tail grows. Rows must be siblings keyed
        // by item ID, never children of a fragment keyed by a page offset.
        return [
          hiddenItemCount > 0 && (
            <button
              key={`gap:${segment.startIndex}`}
              className="chat-detail__working-load chat-detail__working-gap"
              type="button"
              disabled={!onLoad || loadState === 'loading'}
              onClick={() => void loadPage(loadStartIndex)}
            >
              Load {pageItemCount} more · {hiddenItemCount} hidden
            </button>
          ),
          ...segment.blocks.map((block) => {
            return block.type === 'tools' ? (
              <div key={block.items[0]?.id} data-working-motion-id={block.items[0]?.id}>
                {block.items.length > 1 ||
                block.items.some(
                  (toolItem) =>
                    toolItem.type === 'toolGroup' &&
                    Math.max(toolItem.toolCount ?? 0, toolItem.tools.length) > 1
                ) ? (
                  <ToolSequence
                    items={block.items}
                    activeToolIds={activeToolIds}
                    expanded={active && block.items.at(-1) === lastWorkingItem}
                    key={block.items[0]?.id}
                    onLoadItem={onLoadItem}
                    onLoadPage={onLoadToolPage}
                    onDisclosureToggle={onDisclosureToggle}
                    projectCwd={projectCwd}
                  />
                ) : (
                  block.items.map((toolItem) => (
                    <ToolItem
                      item={toolItem}
                      activeToolIds={activeToolIds}
                      expanded={active && toolItem === lastWorkingItem}
                      key={toolItem.id}
                      onLoad={onLoadItem ? () => onLoadItem(toolItem.id) : undefined}
                      onDisclosureToggle={onDisclosureToggle}
                      projectCwd={projectCwd}
                    />
                  ))
                )}
              </div>
            ) : block.item.kind === 'reasoning' ? (
              <ThoughtRow
                id={block.item.id}
                key={block.item.id}
                streaming={
                  active && block.item === lastWorkingItem && block.item.status === 'inProgress'
                }
                onDisclosureToggle={onDisclosureToggle}
              >
                {!isWorkingItemPayloadLoaded(block.item) ? (
                  <button
                    className="chat-detail__working-load"
                    type="button"
                    disabled={!onLoadItem}
                    onClick={() =>
                      void Promise.resolve(onLoadItem?.(block.item.id)).catch((error) => {
                        console.error('[caught:ChatDetailItem:WorkingStep]', error)
                      })
                    }
                  >
                    Load reasoning
                  </button>
                ) : (
                  <MarkdownMessage
                    mediaScope={block.item.id}
                    className="chat-detail__working-message"
                    content={block.item.content}
                    localImageContainer={container}
                    localImageCwd={cwd}
                    onOpenFileLink={onOpenFileLink}
                    streaming={
                      active && block.item === lastWorkingItem && block.item.status === 'inProgress'
                    }
                  />
                )}
              </ThoughtRow>
            ) : !isWorkingItemPayloadLoaded(block.item) ? (
              <button
                className="chat-detail__working-load"
                type="button"
                key={block.item.id}
                disabled={!onLoadItem}
                onClick={() =>
                  void Promise.resolve(onLoadItem?.(block.item.id)).catch((error) => {
                    console.error('[caught:ChatDetailItem:WorkingStep]', error)
                  })
                }
              >
                Load reasoning
              </button>
            ) : (
              <MarkdownMessage
                mediaScope={block.item.id}
                className="chat-detail__working-message"
                content={block.item.content}
                key={block.item.id}
                localImageContainer={container}
                localImageCwd={cwd}
                onOpenFileLink={onOpenFileLink}
                streaming={active && block.item === lastWorkingItem}
              />
            )
          })
        ]
      })}
      {(() => {
        const finalSegment = renderedSegments.at(-1)
        const finalEndIndex = finalSegment ? finalSegment.startIndex + finalSegment.items.length : 0
        const hiddenItemCount = Math.max(0, itemCount - finalEndIndex)
        if (hiddenItemCount === 0) return null

        return (
          <button
            className="chat-detail__working-load chat-detail__working-gap"
            type="button"
            disabled={!onLoad || loadState === 'loading'}
            onClick={() => void loadPage(finalEndIndex)}
          >
            Load {Math.min(workingItemPageSize, hiddenItemCount)} more · {hiddenItemCount} hidden
          </button>
        )
      })()}
      {loadState === 'error' && (
        <span className="chat-detail__working-load-error">
          Unable to load this activity page. Select it to retry.
        </span>
      )}
      {activityContent}
    </div>
  )
})
