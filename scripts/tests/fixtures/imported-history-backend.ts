import {
  ImportedConversations,
  type ImportedConversation
} from '../../../src/main/providers/ImportedConversations'
import { prepareChatDetailForRenderer } from '../../../src/main/providers/chatDetailLazy'
import { prepareWorkingStepPage } from '../../../src/main/providers/workingStepLazy'
import type { ProviderAdapter } from '../../../src/main/providers/ProviderAdapter'
import type { ProviderId, ProviderChatDetail, ProviderChatItem } from '../../../src/shared/provider'

export function createImportedHistoryFixture() {
  const text = 'archived tool output\n'.repeat(1000)
  const items: ProviderChatItem[] = Array.from({ length: 6000 }, (_, i) => [
    { type: 'message', id: `user-${i}`, role: 'user', content: `Archived prompt ${i}` },
    {
      type: 'working',
      id: `work-${i}`,
      status: 'worked',
      items: [
        {
          type: 'tool',
          id: `tool-${i}`,
          toolId: 'read',
          status: 'finished',
          activity: 'command',
          icon: null,
          label: 'Read file',
          command: 'cat file',
          cwd: '/fixture',
          stdout: text,
          diffs: [],
          images: [],
          rawInput: {},
          rawOutput: text,
          backgroundSessionId: null,
          finishedBackgroundSessionId: null
        }
      ]
    },
    { type: 'message', id: `answer-${i}`, role: 'assistant', content: `Archived answer ${i}` }
  ]).flat() as ProviderChatItem[]
  const base = {
    id: 'large-import',
    title: 'Large imported chat',
    revision: 1,
    createdAt: 1,
    cwd: '/fixture',
    cwdKind: 'directory',
    projectCwd: '/fixture',
    branchName: null,
    worktreeBaseBranchName: null,
    status: null,
    pinned: false,
    sidebarOrder: null,
    done: false,
    seenUpdatedAt: null,
    purpose: null,
    container: null,
    capabilities: { editMessages: true, activeMessages: true },
    pendingApproval: null,
    pendingUserInput: null,
    contextUsage: null,
    items: []
  } as ProviderChatDetail
  const record: ImportedConversation = {
    providerId: 'claude',
    chatId: base.id,
    state: 'ready',
    title: base.title,
    createdAt: 1,
    original: { providerId: 'codex', chatId: 'source' },
    baseline: ['synthetic'],
    archive: {
      format: 'sele-chat',
      version: 1,
      providerId: 'codex',
      exportedAt: 1,
      chat: { ...base, items },
      subagents: [],
      assets: []
    }
  }
  const stats = { nativeReads: 0, largestLimit: 0 }
  const adapter = {
    id: 'claude',
    getChat: async () => base,
    onChatUpdated: () => () => {},
    getChatWindow: async (_id, window) => {
      stats.nativeReads++
      stats.largestLimit = Math.max(stats.largestLimit, window.limit)
      if (window.startIndex != null || window.limit > 10)
        throw new Error('Unbounded native history read')
      await new Promise((resolve) => setTimeout(resolve, 80))
      return base
    },
    getChatWindowForItem: () => {
      throw new Error('Archive expansion must not seek native history')
    }
  } as unknown as ProviderAdapter
  const native = Object.fromEntries(
    ['codex', 'claude', 'copilot', 'opencode'].map((id) => [id, { ...adapter, id }])
  ) as Record<ProviderId, ProviderAdapter>
  const router = new ImportedConversations(native, {
    list: async () => [{ ...record, archive: undefined } as unknown as ImportedConversation],
    get: async () => record,
    save: async () => {}
  })
  const wrapped = router.wrap('claude')
  return {
    stats,
    read: async () => prepareChatDetailForRenderer(await wrapped.getChat(base.id)),
    working: async (id: string) => {
      const detail = await wrapped.getChatWindowForItem!(base.id, id, 1)
      const step = detail.items.find((item) => item.id === id)
      if (step?.type !== 'working') throw new Error('Archived working section not found')
      return prepareWorkingStepPage(step, 0, 50)
    }
  }
}
