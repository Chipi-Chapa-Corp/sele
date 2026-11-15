import { Spinner } from './Spinner'
import { ChevronRight, Image as ImageIcon } from 'lucide-react'
import { useState } from 'react'
import 'react-diff-view/style/index.css'
import type {
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingTool
} from '../../../shared/provider'
import { chatMediaId } from '../chatMedia'
import { getToolDisplayLabel } from '../toolDisplayLabel'
import './ChatDetailItem.css'
import { McpApp } from './McpApp'
import { CommandContent, DiffContent, hasToolValue, RawContent } from './ToolActivityContent'
import { ToolStatusIcon } from './ToolActivityIcon'
import './UnifiedDiff.css'

import { GeneratedImageThumbnail } from './MessageAttachments'
import { useWorkingDisclosure } from './WorkingDisclosure'
type ProviderToolItem = Exclude<ProviderWorkingItem, { type: 'message' }>

export const isWorkingItemPayloadLoaded = (item: ProviderWorkingItem): boolean => {
  if (item.type === 'message') return item.contentLoaded !== false
  if (item.type === 'toolGroup') return item.tools.every((tool) => tool.payloadLoaded !== false)
  return item.payloadLoaded !== false
}

const Activity: React.FC<{
  label: string
  tools: ProviderWorkingTool[]
  activity: ProviderToolActivity
  active: boolean
  expanded: boolean
  onDisclosureToggle?: () => void
  projectCwd?: string | null
}> = ({ label, tools, activity, active, expanded, onDisclosureToggle, projectCwd }) => {
  const [open, setOpen] = useWorkingDisclosure(`tool:${tools[0]?.id}`, expanded)
  const detailKind = getToolDetailKind(activity, tools)

  return (
    <details
      className={`chat-detail__tool-group${active ? ' chat-detail__tool-group--active' : ''}`}
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
          <ToolStatusIcon activity={activity} active={active} icon={tools[0]?.icon} />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <>
          {detailKind === 'diff' ? (
            <DiffContent tools={tools} projectCwd={projectCwd} />
          ) : detailKind === 'command' ? (
            <CommandContent tools={tools} />
          ) : (
            <RawContent tools={tools} />
          )}
          {tools.some((tool) => tool.payloadTruncated) && (
            <span className="chat-detail__working-load-error">
              Showing a bounded preview of this large payload.
            </span>
          )}
        </>
      )}
    </details>
  )
}

export const getToolsFromToolItem = (item: ProviderToolItem): ProviderWorkingTool[] =>
  item.type === 'toolGroup' ? item.tools : [item]

const getToolDetailKind = (
  activity: ProviderToolActivity,
  tools: ProviderWorkingTool[]
): 'diff' | 'command' | 'raw' => {
  if (activity === 'edit') return tools.some((tool) => tool.diffs.length) ? 'diff' : 'raw'
  if (activity === 'search' && tools.every((tool) => !tool.command)) return 'raw'
  if (['command', 'search', 'git', 'npm', 'npx', 'script'].includes(activity)) return 'command'
  return 'raw'
}

const hasToolDetails = (tool: ProviderWorkingTool, activity: ProviderToolActivity): boolean => {
  // Match the content renderer: hidden metadata must not create an empty disclosure.
  switch (getToolDetailKind(activity, [tool])) {
    case 'diff':
      return tool.diffs.length > 0
    case 'command':
      return Boolean(tool.command?.trim() || tool.stdout?.trim())
    case 'raw':
      return hasToolValue(tool.rawInput) || hasToolValue(tool.rawOutput)
  }
}

const GeneratedImageTool: React.FC<{
  active: boolean
  label: string
  tools: ProviderWorkingTool[]
}> = ({ active, label, tools }) => {
  const images = tools.flatMap((tool) =>
    tool.images.flatMap((image, index) =>
      image.path || image.dataUrl
        ? [{ ...image, mediaId: chatMediaId(tool.id, 'image', index) }]
        : []
    )
  )

  return (
    <div
      className={`chat-detail__generated-image-tool${
        active ? ' chat-detail__generated-image-tool--active' : ''
      }`}
    >
      <div className="chat-detail__generated-image-heading">
        <span className="chat-detail__tool-icon">
          {active ? (
            <ToolStatusIcon activity="other" active icon={tools[0]?.icon} />
          ) : (
            <ImageIcon aria-hidden="true" />
          )}
        </span>
        <span className="chat-detail__tool-label">{label}</span>
      </div>
      <div className="chat-detail__generated-image-gallery">
        {images.map((image) => (
          <GeneratedImageThumbnail
            mediaId={image.mediaId}
            path={image.path}
            initialDataUrl={image.dataUrl}
            name={image.name ?? undefined}
            key={image.mediaId}
          />
        ))}
      </div>
    </div>
  )
}

export const ToolItem: React.FC<{
  item: ProviderToolItem
  activeToolIds: Set<string>
  expanded?: boolean
  onLoad?: () => Promise<void> | void
  onDisclosureToggle?: () => void
  projectCwd?: string | null
}> = ({ item, activeToolIds, expanded = false, onLoad, onDisclosureToggle, projectCwd }) => {
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const tools = getToolsFromToolItem(item)
  const activity = tools[0]?.activity ?? 'other'
  const active = tools.some((tool) => activeToolIds.has(tool.id))
  const baseLabel = item.label || tools[0]?.toolId || 'Tool use'
  const rawLabel =
    item.type === 'toolGroup' && (item.toolCount ?? item.tools.length) > item.tools.length
      ? `${baseLabel} · showing ${item.tools.length} of ${item.toolCount}`
      : baseLabel
  const label = getToolDisplayLabel(rawLabel, activity, active, tools[0]?.icon)

  const disclosure = (
    <Activity
      label={label}
      tools={tools}
      activity={activity}
      active={active}
      expanded={expanded}
      onDisclosureToggle={onDisclosureToggle}
      projectCwd={projectCwd}
    />
  )
  const statusRow = (
    <div className={`chat-detail__tool-read${active ? ' chat-detail__tool-read--active' : ''}`}>
      <span className="chat-detail__tool-icon">
        <ToolStatusIcon activity={activity} active={active} icon={tools[0]?.icon} />
      </span>
      <span className="chat-detail__tool-label">{label}</span>
    </div>
  )

  const apps = tools.filter((tool) => tool.status === 'finished' && tool.mcpApp?.resourceUri)
  if (apps.length)
    return (
      <div>
        {disclosure}
        {apps.map((tool) => (
          <McpApp key={tool.mcpApp!.callId} callId={tool.mcpApp!.callId} />
        ))}
      </div>
    )

  // These status rows need no payload disclosure, including unloaded history rows.
  if (
    activity === 'create' ||
    activity === 'delete' ||
    tools.every((tool) => tool.icon === 'browser')
  ) {
    return statusRow
  }

  if (!isWorkingItemPayloadLoaded(item)) {
    const handleLoad = async (): Promise<void> => {
      if (!onLoad || loadState === 'loading') return
      setLoadState('loading')
      try {
        await onLoad()
        setLoadState('idle')
      } catch (error) {
        console.error('[caught:ChatDetailItem:handleLoad]', error)
        setLoadState('error')
      }
    }

    return (
      <div className="chat-detail__tool-read">
        <button
          className="chat-detail__working-load"
          type="button"
          disabled={!onLoad || loadState === 'loading'}
          onClick={handleLoad}
        >
          <span className="chat-detail__tool-icon">
            <ToolStatusIcon activity={activity} active={active} icon={tools[0]?.icon} />
          </span>
          <span className="chat-detail__tool-label">
            {loadState === 'error' ? `Retry loading ${label}` : label}
          </span>
          {loadState === 'loading' ? (
            <Spinner
              className="app-loading-spinner chat-detail__working-spinner"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
          )}
        </button>
      </div>
    )
  }

  if (tools.some((tool) => tool.images.length > 0)) {
    return <GeneratedImageTool active={active} label={label} tools={tools} />
  }

  if (
    tools.every((tool) => tool.compact) ||
    activity === 'skill' ||
    activity === 'read' ||
    tools.every((tool) => tool.icon === 'plan') ||
    !tools.some((tool) => hasToolDetails(tool, activity))
  ) {
    return statusRow
  }

  return disclosure
}
