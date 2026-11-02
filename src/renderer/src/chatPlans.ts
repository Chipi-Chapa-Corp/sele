import type { ProviderChatItem, ProviderWorkingTool } from '../../shared/provider'
import type { ChatPlanData, ChatPlanItem } from './components/ChatPlan'

export const planItemStatuses = new Set<ChatPlanItem['status']>([
  'pending',
  'in_progress',
  'completed'
])

export const getToolInputRecord = (rawInput: unknown): Record<string, unknown> | null => {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>
  }
  if (typeof rawInput !== 'string') return null

  const trimmedInput = rawInput.trim()
  const objectStart = trimmedInput.indexOf('{')
  const objectEnd = trimmedInput.lastIndexOf('}')
  if (objectStart < 0 || objectEnd <= objectStart) return null

  try {
    const parsedInput = JSON.parse(trimmedInput.slice(objectStart, objectEnd + 1)) as unknown
    return parsedInput && typeof parsedInput === 'object' && !Array.isArray(parsedInput)
      ? (parsedInput as Record<string, unknown>)
      : null
  } catch (error) {
    console.error('[caught:chatControllerUtils:getToolInputRecord]', error)
    return null
  }
}

export const getPlanSignature = (items: ChatPlanItem[]): string => {
  const serializedItems = JSON.stringify(items)
  let hash = 2_166_136_261

  for (let index = 0; index < serializedItems.length; index += 1) {
    hash ^= serializedItems.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return `${items.length}:${(hash >>> 0).toString(36)}`
}

export const getPlanFromTool = (
  tool: ProviderWorkingTool,
  contextKey: string
): ChatPlanData | null => {
  if (tool.plan) {
    return {
      contextKey,
      explanation: tool.plan.explanation ?? null,
      items: tool.plan.items,
      signature: getPlanSignature(tool.plan.items)
    }
  }
  if (tool.toolId !== 'update_plan') return null

  const input = getToolInputRecord(tool.rawInput)
  if (!input || !Array.isArray(input.plan)) return null

  const items = input.plan.flatMap((item): ChatPlanItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []

    const candidate = item as Record<string, unknown>
    const step = typeof candidate.step === 'string' ? candidate.step.trim() : ''
    const status = candidate.status
    if (
      !step ||
      typeof status !== 'string' ||
      !planItemStatuses.has(status as ChatPlanItem['status'])
    ) {
      return []
    }

    return [{ step, status: status as ChatPlanItem['status'] }]
  })
  if (items.length === 0) return null

  const explanation =
    typeof input.explanation === 'string' && input.explanation.trim()
      ? input.explanation.trim()
      : null

  return {
    contextKey,
    explanation,
    items,
    signature: getPlanSignature(items)
  }
}

export const getLatestChatPlan = (
  items: readonly ProviderChatItem[] | null | undefined,
  contextKey: string | null
): ChatPlanData | null => {
  if (!items || !contextKey) return null
  let latestPlan: ChatPlanData | null = null
  let latestRevision = -1

  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex]
    if (item.type !== 'working') continue

    for (
      let workingItemIndex = item.items.length - 1;
      workingItemIndex >= 0;
      workingItemIndex -= 1
    ) {
      const workingItem = item.items[workingItemIndex]
      const tools =
        workingItem.type === 'toolGroup'
          ? workingItem.tools
          : workingItem.type === 'tool'
            ? [workingItem]
            : []

      for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
        const tool = tools[toolIndex]
        const plan = getPlanFromTool(tool, contextKey)
        if (!plan) continue
        const revision = tool.plan?.revision
        if (revision == null) {
          const latest = latestPlan ?? plan
          return latest.items.length ? latest : null
        }
        if (revision > latestRevision) {
          latestPlan = plan
          latestRevision = revision
        }
      }
    }
  }

  return latestPlan?.items.length ? latestPlan : null
}
