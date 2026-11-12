import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import 'react-diff-view/style/index.css'
import type { ProviderToolActivity, ProviderWorkingTool } from '../../../shared/provider'
import { getToolSequenceDisplayLabel } from '../toolDisplayLabel'
import './ChatDetailItem.css'
import { getToolsFromToolItem, ToolItem } from './ChatToolActivity'
import { ToolStatusIcon } from './ToolActivityIcon'
import './UnifiedDiff.css'
import { useWorkingDisclosure } from './WorkingDisclosure'
import type { ProviderToolItem } from './workingStepPresentation'

export const workingToolPageSize = 50

export const getDominantActivity = (tools: ProviderWorkingTool[]): ProviderToolActivity => {
  if (tools.length === 0) return 'other'

  const activityCounts = tools.reduce<Map<ProviderToolActivity, number>>((counts, tool) => {
    counts.set(tool.activity, (counts.get(tool.activity) ?? 0) + 1)
    return counts
  }, new Map())
  const highestCount = Math.max(...activityCounts.values())

  return (
    tools.find((tool) => activityCounts.get(tool.activity) === highestCount)?.activity ?? 'other'
  )
}

export const ToolSequence: React.FC<{
  items: ProviderToolItem[]
  activeToolIds: Set<string>
  expanded: boolean
  onLoadItem: ((itemId: string) => Promise<void> | void) | undefined
  onLoadPage: ((workingItemId: string, startIndex: number) => Promise<void> | void) | undefined
  onDisclosureToggle: (() => void) | undefined
  projectCwd: string | null | undefined
}> = ({
  items,
  activeToolIds,
  expanded,
  onLoadItem,
  onLoadPage,
  onDisclosureToggle,
  projectCwd
}) => {
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const sequenceItem = items.length === 1 && items[0]?.type === 'toolGroup' ? items[0] : null
  const tools = items.flatMap(getToolsFromToolItem)
  const [open, setOpen] = useWorkingDisclosure(
    `sequence:${items[0]?.id}`,
    expanded,
    `tool:${tools[0]?.id}`
  )
  const activeTools = tools.filter((tool) => activeToolIds.has(tool.id))
  const active = activeTools.length > 0
  const dominantActivity = active
    ? getDominantActivity(activeTools)
    : (sequenceItem?.dominantActivity ?? getDominantActivity(tools))
  const sequenceActivities = sequenceItem?.toolActivities?.length
    ? sequenceItem.toolActivities
    : tools.map((tool) => tool.activity)
  const otherToolLabels = sequenceItem?.otherToolLabels?.length
    ? sequenceItem.otherToolLabels
    : tools
        .filter((tool) => tool.activity === 'other')
        .map((tool) => tool.summaryLabel ?? tool.label)
  const baseLabel = getToolSequenceDisplayLabel(sequenceActivities, active, otherToolLabels)
  const totalCount = Math.max(sequenceItem?.toolCount ?? 0, tools.length)
  const startIndex = sequenceItem?.toolsStartIndex ?? Math.max(0, totalCount - tools.length)
  const endIndex = Math.min(totalCount, startIndex + tools.length)
  const hiddenBefore = Math.max(0, startIndex)
  const hiddenAfter = Math.max(0, totalCount - endIndex)
  const label =
    totalCount > tools.length ? `${baseLabel} · ${tools.length}/${totalCount}` : baseLabel
  const loadPage = async (nextStartIndex: number): Promise<void> => {
    if (!sequenceItem || !onLoadPage || loadState === 'loading') return
    setLoadState('loading')
    try {
      await onLoadPage(sequenceItem.id, nextStartIndex)
      setLoadState('idle')
    } catch (error) {
      console.error('[caught:ChatDetailItem:loadPage]', error)
      setLoadState('error')
    }
  }

  return (
    <details
      className={`chat-detail__tool-sequence${active ? ' chat-detail__tool-sequence--active' : ''}`}
      open={open}
    >
      <summary
        onClick={(event) => {
          event.preventDefault()
          setOpen(!open)
          onDisclosureToggle?.()
        }}
      >
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={dominantActivity} active={active} />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div className="chat-detail__tool-sequence-content">
          {hiddenBefore > 0 && (
            <button
              className="chat-detail__working-load chat-detail__working-gap"
              type="button"
              disabled={!onLoadPage || loadState === 'loading'}
              onClick={() => void loadPage(Math.max(0, startIndex - workingToolPageSize))}
            >
              Load {Math.min(workingToolPageSize, hiddenBefore)} previous · {hiddenBefore} hidden
            </button>
          )}
          {tools.map((item) => (
            <div key={item.id} data-working-motion-id={item.id}>
              <ToolItem
                item={item}
                activeToolIds={activeToolIds}
                expanded={expanded && item === tools.at(-1) && hiddenAfter === 0}
                key={item.id}
                onLoad={onLoadItem ? () => onLoadItem(item.id) : undefined}
                onDisclosureToggle={onDisclosureToggle}
                projectCwd={projectCwd}
              />
            </div>
          ))}
          {hiddenAfter > 0 && (
            <button
              className="chat-detail__working-load chat-detail__working-gap"
              type="button"
              disabled={!onLoadPage || loadState === 'loading'}
              onClick={() => void loadPage(endIndex)}
            >
              Load {Math.min(workingToolPageSize, hiddenAfter)} newer · {hiddenAfter} hidden
            </button>
          )}
          {loadState === 'error' && (
            <span className="chat-detail__working-load-error">
              Unable to load this activity page. Select it to retry.
            </span>
          )}
        </div>
      )}
    </details>
  )
}
