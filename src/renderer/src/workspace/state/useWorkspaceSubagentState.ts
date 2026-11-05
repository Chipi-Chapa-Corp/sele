import { startTransition, useCallback, useRef, useState } from 'react'
import type { ProviderSubagent } from '../../../../shared/provider'
import { SubagentCompletionTimeline } from '../../subagentTimeline'
import { getWorkingSubagentIds } from '../../subagentUi'
import { type SubagentChatView, type SubagentListState } from '../controllerTypes'

export function useWorkspaceSubagentState() {
  const [workingSubagentChatKeys, setWorkingSubagentChatKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const workingSubagentChatKeysRef = useRef(workingSubagentChatKeys)

  const subagentCompletionTimelines = useRef(new Map<string, SubagentCompletionTimeline>())

  const updateSubagentWorkingChat = useCallback(
    (chatKey: string, agents: readonly ProviderSubagent[]) => {
      const working = getWorkingSubagentIds(agents).size > 0
      const current = workingSubagentChatKeysRef.current
      if (current.has(chatKey) === working) return
      const next = new Set(current)
      if (working) next.add(chatKey)
      else next.delete(chatKey)
      workingSubagentChatKeysRef.current = next
      startTransition(() => setWorkingSubagentChatKeys(next))
    },
    []
  )

  const [subagentListState, setSubagentListState] = useState<SubagentListState | null>(null)

  const [subagentChatView, setSubagentChatView] = useState<SubagentChatView | null>(null)

  const [cancelingSubagentIds, setCancelingSubagentIds] = useState<Set<string>>(() => new Set())

  const subagentContentRef = useRef<HTMLDivElement>(null)

  const subagentChatLoadRequestRef = useRef(0)
  return {
    workingSubagentChatKeys,
    subagentCompletionTimelines,
    updateSubagentWorkingChat,
    subagentListState,
    setSubagentListState,
    subagentChatView,
    setSubagentChatView,
    cancelingSubagentIds,
    setCancelingSubagentIds,
    subagentContentRef,
    subagentChatLoadRequestRef
  }
}
