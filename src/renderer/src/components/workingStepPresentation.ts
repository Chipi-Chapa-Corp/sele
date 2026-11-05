export const workingItemPageSize = 50
import type {
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool
} from '../../../shared/provider'
import { getToolsFromToolItem } from './ChatToolActivity'

export type ProviderToolItem = Exclude<ProviderWorkingItem, { type: 'message' }>

export type ProviderWorkingMessageItem = Extract<ProviderWorkingItem, { type: 'message' }>

export type WorkingBlock =
  | { type: 'message'; item: ProviderWorkingMessageItem }
  | { type: 'tools'; items: ProviderToolItem[] }

export const longRunningActivities = new Set<ProviderToolActivity>([
  'npm',
  'npx',
  'script',
  'command'
])

export const getActiveToolIds = (item: ProviderWorkingStep): Set<string> => {
  const activeToolIds = new Set<string>()
  if (item.status !== 'working') return activeToolIds

  const closedBackgroundSessionIds = new Set<string>()

  for (let itemIndex = item.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const workingItem = item.items[itemIndex]
    if (workingItem.type === 'message') continue

    const tools = getToolsFromToolItem(workingItem)
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = tools[toolIndex]
      if (tool.finishedBackgroundSessionId) {
        closedBackgroundSessionIds.add(tool.finishedBackgroundSessionId)
      }
      if (tool.backgroundSessionId && !closedBackgroundSessionIds.has(tool.backgroundSessionId)) {
        activeToolIds.add(tool.id)
      }
      if (
        tool.status === 'running' &&
        (longRunningActivities.has(tool.activity) || tool.icon === 'subagent')
      ) {
        activeToolIds.add(tool.id)
      }
    }
  }

  const lastItem = item.items.at(-1)
  if (lastItem && lastItem.type !== 'message') {
    for (const tool of getToolsFromToolItem(lastItem)) {
      if (tool.status === 'running') activeToolIds.add(tool.id)
    }
  }

  return activeToolIds
}

// Page offsets are canonical display-row offsets. Never merge rows after slicing a page:
// that makes the hidden counts disagree and can merge across extracted image rows.
export const groupWorkingItems = (items: ProviderWorkingItem[]): WorkingBlock[] =>
  items.map((item) =>
    item.type === 'message' ? { type: 'message', item } : { type: 'tools', items: [item] }
  )

export const partitionGeneratedImageItems = (
  items: ProviderWorkingItem[]
): { generatedImages: ProviderToolItem[]; remaining: ProviderWorkingItem[] } => {
  const generatedImages: ProviderToolItem[] = []
  const remaining: ProviderWorkingItem[] = []
  const isGeneratedImageTool = (tool: ProviderWorkingTool): boolean =>
    tool.icon === 'image-generation' && tool.images.length > 0

  for (const item of items) {
    if (item.type === 'message') {
      remaining.push(item)
      continue
    }

    if (item.type === 'tool') {
      if (isGeneratedImageTool(item)) generatedImages.push(item)
      else remaining.push(item)
      continue
    }

    // A grouped sequence owns its child paging. Keep it intact so the loaded child indexes and
    // counts remain stable; generated images inside it are rendered lazily with the other tools.
    remaining.push(item)
  }

  return { generatedImages, remaining }
}
