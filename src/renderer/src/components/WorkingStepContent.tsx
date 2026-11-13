import type { RefObject } from 'react'
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
  itemCount
}: WorkingStepContentProps) {
  const finalSegment = renderedSegments.at(-1)
  const finalEndIndex = finalSegment ? finalSegment.startIndex + finalSegment.items.length : 0
  const loadGap = (startIndex: number, hiddenItemCount: number, key?: string) =>
    hiddenItemCount > 0 && (
      <button
        key={key}
        className="chat-detail__working-load chat-detail__working-gap"
        type="button"
        disabled={!onLoad || loadState === 'loading'}
        onClick={() => void loadPage(startIndex)}
      >
        Load {Math.min(workingItemPageSize, hiddenItemCount)} more · {hiddenItemCount} hidden
      </button>
    )

  return (
    <div ref={workingContentRef} className="chat-detail__step-content">
      {renderedSegments.flatMap((segment, segmentIndex) => {
        const previousSegment = renderedSegments[segmentIndex - 1]
        const previousEndIndex = previousSegment
          ? previousSegment.startIndex + previousSegment.items.length
          : 0

        // Offsets move as the live tail grows. Rows must be siblings keyed
        // by item ID, never children of a fragment keyed by a page offset.
        return [
          loadGap(
            previousSegment
              ? previousEndIndex
              : Math.max(0, segment.startIndex - workingItemPageSize),
            Math.max(0, segment.startIndex - previousEndIndex),
            `gap:${segment.startIndex}`
          ),
          ...segment.blocks.map((block) => {
            if (block.type === 'tools') {
              const toolItem = block.item
              const toolProps = {
                activeToolIds,
                expanded: active && toolItem === lastWorkingItem,
                onDisclosureToggle,
                projectCwd
              }
              return (
                <div key={toolItem.id} data-working-motion-id={toolItem.id}>
                  {toolItem.type === 'toolGroup' &&
                  Math.max(toolItem.toolCount ?? 0, toolItem.tools.length) > 1 ? (
                    <ToolSequence
                      {...toolProps}
                      item={toolItem}
                      onLoadItem={onLoadItem}
                      onLoadPage={onLoadToolPage}
                    />
                  ) : (
                    <ToolItem
                      {...toolProps}
                      item={toolItem}
                      onLoad={onLoadItem ? () => onLoadItem(toolItem.id) : undefined}
                    />
                  )}
                </div>
              )
            }
            const streaming =
              active &&
              block.item === lastWorkingItem &&
              (block.item.kind !== 'reasoning' || block.item.status === 'inProgress')
            const message = !isWorkingItemPayloadLoaded(block.item) ? (
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
                streaming={streaming}
              />
            )
            return block.item.kind === 'reasoning' ? (
              <ThoughtRow
                id={block.item.id}
                key={block.item.id}
                streaming={streaming}
                onDisclosureToggle={onDisclosureToggle}
              >
                {message}
              </ThoughtRow>
            ) : (
              message
            )
          })
        ]
      })}
      {loadGap(finalEndIndex, Math.max(0, itemCount - finalEndIndex))}
      {loadState === 'error' && (
        <span className="chat-detail__working-load-error">
          Unable to load this activity page. Select it to retry.
        </span>
      )}
    </div>
  )
})
