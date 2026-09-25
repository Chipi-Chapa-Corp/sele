import type { ProviderChatTurnWindow } from '../ProviderAdapter.ts'
import type { CodexTurn } from './CodexItemRenderers.ts'
import {
  CodexTurnWindowMismatchError,
  hydrateCodexTurnRange,
  loadCodexTurnCatalog
} from './CodexPaginatedHistory.ts'
import { getCodexSubagentInstruction, selectCodexSubagentTurns } from './CodexSubagents.ts'

type Request = (method: string, params: unknown) => Promise<unknown>
type CatalogEntry = {
  catalog: CodexTurn[]
  createdAt: number
  updatedAt: number
  firstChildTurnId: string | null
  boundaryKnown: boolean
  inheritedInstruction: string | null
  instructionResolved: boolean
}

export type CodexSubagentHistoryPage = {
  turns: CodexTurn[]
  instruction: string | null
  itemsStartTurnIndex: number
  turnCount: number
}

/** Metadata shells are cached; only the requested child turns receive full item payloads. */
export class CodexSubagentHistory {
  private entries = new Map<string, CatalogEntry>()
  private readonly maxEntries = 12

  clear(): void {
    this.entries.clear()
  }

  clearContainer(containerKey: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${containerKey}\0`)) this.entries.delete(key)
    }
  }

  private getCatalog = async (
    request: Request,
    key: string,
    threadId: string,
    createdAt: number,
    updatedAt: number,
    forceRefresh: boolean
  ): Promise<CatalogEntry> => {
    const cached = this.entries.get(key)
    const newest = (await request('thread/turns/list', {
      threadId,
      cursor: null,
      limit: 1,
      sortDirection: 'desc',
      itemsView: 'notLoaded'
    })) as { data?: CodexTurn[] }
    if (!Array.isArray(newest.data)) throw new Error('Invalid paginated Codex turn response')
    const newestTurn = newest.data[0]
    // updatedAt invalidates edits/truncation that leave the last turn ID unchanged. The latest
    // shell probe catches appends even when an external Codex writer does not bump updatedAt.
    if (
      !forceRefresh &&
      cached?.createdAt === createdAt &&
      cached.updatedAt === updatedAt &&
      (cached.catalog.at(-1)?.id ?? null) === (newestTurn?.id ?? null)
    ) {
      if (newestTurn && cached.catalog.length > 0) {
        cached.catalog[cached.catalog.length - 1] = { ...newestTurn, items: [] }
      }
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached
    }

    const catalog = await loadCodexTurnCatalog(request, threadId)
    const entry: CatalogEntry = {
      catalog,
      createdAt,
      updatedAt,
      firstChildTurnId: cached?.createdAt === createdAt ? cached.firstChildTurnId : null,
      boundaryKnown: Boolean(
        cached?.createdAt === createdAt && cached.boundaryKnown && cached.firstChildTurnId
      ),
      inheritedInstruction: cached?.createdAt === createdAt ? cached.inheritedInstruction : null,
      instructionResolved: Boolean(
        cached?.createdAt === createdAt &&
          cached.updatedAt === updatedAt &&
          cached.instructionResolved
      )
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
    return entry
  }

  private findBoundary = async (
    request: Request,
    threadId: string,
    renderable: CodexTurn[],
    entry: CatalogEntry
  ): Promise<number> => {
    if (entry.boundaryKnown) {
      const cachedIndex = entry.firstChildTurnId
        ? renderable.findIndex((turn) => turn.id === entry.firstChildTurnId)
        : renderable.length
      if (cachedIndex >= 0) return cachedIndex
    }

    for (let index = 0; index < renderable.length; index += 1) {
      const shell = renderable[index]
      if (typeof shell.startedAt !== 'number' || shell.startedAt < entry.createdAt) continue
      const [turn] = await hydrateCodexTurnRange(request, threadId, renderable, index, index + 1)
      if (selectCodexSubagentTurns([turn], entry.createdAt).length > 0) {
        entry.firstChildTurnId = turn.id
        entry.boundaryKnown = true
        return index
      }
      entry.inheritedInstruction ??= getCodexSubagentInstruction([turn], threadId)
    }
    entry.firstChildTurnId = null
    entry.boundaryKnown = true
    return renderable.length
  }

  private resolveInheritedInstruction = async (
    request: Request,
    threadId: string,
    renderable: CodexTurn[],
    boundary: number,
    entry: CatalogEntry
  ): Promise<string | null> => {
    if (entry.instructionResolved) return entry.inheritedInstruction
    if (boundary > 0) {
      const inherited = await hydrateCodexTurnRange(request, threadId, renderable, 0, boundary)
      entry.inheritedInstruction = getCodexSubagentInstruction(inherited, threadId)
    }
    entry.instructionResolved = true
    return entry.inheritedInstruction
  }

  read = async (options: {
    request: Request
    key: string
    threadId: string
    createdAt: number
    updatedAt: number
    parentInstruction: string | null
    filterTurns: (turns: CodexTurn[]) => CodexTurn[]
    window?: ProviderChatTurnWindow
    itemId?: string
  }): Promise<CodexSubagentHistoryPage> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entry = await this.getCatalog(
        options.request,
        options.key,
        options.threadId,
        options.createdAt,
        options.updatedAt,
        attempt > 0
      )
      try {
        const renderable = options
          .filterTurns(entry.catalog)
          .filter((turn) => turn.status !== 'queued')
        const boundary = await this.findBoundary(
          options.request,
          options.threadId,
          renderable,
          entry
        )
        const instruction =
          options.parentInstruction ??
          (await this.resolveInheritedInstruction(
            options.request,
            options.threadId,
            renderable,
            boundary,
            entry
          ))
        const instructionCount = instruction ? 1 : 0
        const turnCount = renderable.length - boundary + instructionCount
        let startIndex: number
        let limit: number
        if (options.itemId) {
          const targetRawIndex = renderable.findIndex(
            (turn, index) =>
              index >= boundary &&
              (options.itemId === turn.id || options.itemId!.startsWith(`${turn.id}:`))
          )
          if (targetRawIndex < 0) throw new Error('Subagent chat item not found')
          startIndex = targetRawIndex - boundary + instructionCount
          limit = 1
        } else {
          limit = options.window?.limit ?? turnCount
          startIndex =
            options.window?.startIndex == null
              ? Math.max(0, turnCount - limit)
              : Math.min(options.window.startIndex, turnCount)
        }
        const endIndex = Math.min(turnCount, startIndex + limit)
        const firstRawIndex = boundary + Math.max(0, startIndex - instructionCount)
        const endRawIndex = boundary + Math.max(0, endIndex - instructionCount)
        const turns = await hydrateCodexTurnRange(
          options.request,
          options.threadId,
          renderable,
          firstRawIndex,
          endRawIndex
        )
        return { turns, instruction, itemsStartTurnIndex: startIndex, turnCount }
      } catch (error) {
        if (error instanceof CodexTurnWindowMismatchError && attempt === 0) {
          this.entries.delete(options.key)
          continue
        }
        throw error
      }
    }
    throw new Error('Unable to read Codex subagent history')
  }
}
