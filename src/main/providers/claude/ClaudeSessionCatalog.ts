import { randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeSessionCandidate = { sessionId: string; mtime: number; path: string }
export type ClaudeSessionListPage = { sessions: SDKSessionInfo[]; nextCursor: string | null }
type Snapshot = { scope: string; candidates: ClaudeSessionCandidate[]; expiresAt: number }
const cursorPrefix = 'sele:claude-list:'
const snapshotLifetime = 5 * 60_000

export const listLocalClaudeSessionCandidates = async (): Promise<ClaudeSessionCandidate[]> => {
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  let projects: string[]
  try {
    projects = await readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const candidates: ClaudeSessionCandidate[] = []
  for (const project of projects) {
    let files: string[]
    try {
      files = await readdir(join(root, project))
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
      throw error
    }
    // Stat files in bounded batches; no transcript bodies are read during enumeration.
    for (let offset = 0; offset < files.length; offset += 32) {
      const batch = await Promise.all(
        files.slice(offset, offset + 32).map(async (file) => {
          if (!/^[a-f0-9-]{36}\.jsonl$/i.test(file)) return null
          const path = join(root, project, file)
          try {
            const info = await stat(path)
            return info.isFile()
              ? { sessionId: file.slice(0, -6), mtime: info.mtimeMs, path }
              : null
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw error
          }
        })
      )
      for (const candidate of batch) if (candidate) candidates.push(candidate)
    }
  }
  return candidates
}

/** Stable file candidates across pages; hydrate metadata only as each page needs it. */
export class ClaudeSessionCatalog {
  private snapshots = new Map<string, Snapshot>()

  async list(
    scope: string,
    cursor: string | null,
    limit: number,
    hidden: Set<string>,
    discover: () => Promise<ClaudeSessionCandidate[]>,
    read: (candidate: ClaudeSessionCandidate) => Promise<SDKSessionInfo | undefined>
  ): Promise<ClaudeSessionListPage> {
    const now = Date.now()
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.expiresAt <= now) this.snapshots.delete(id)
    }
    let id: string
    let offset = 0
    let snapshot: Snapshot
    if (cursor) {
      const match = /^sele:claude-list:([a-f0-9-]{36}):(\d+)$/.exec(cursor)
      const saved = match ? this.snapshots.get(match[1]) : undefined
      if (!match || !saved || saved.scope !== scope)
        throw new Error('Claude session list cursor expired. Refresh the sidebar.')
      id = match[1]
      offset = Number(match[2])
      if (!Number.isSafeInteger(offset) || offset > saved.candidates.length)
        throw new Error('Invalid Claude session list cursor')
      snapshot = saved
    } else {
      const candidates = (await discover()).sort(
        (a, b) => b.mtime - a.mtime || a.sessionId.localeCompare(b.sessionId)
      )
      const seen = new Set<string>()
      snapshot = {
        scope,
        candidates: candidates.filter((candidate) => {
          if (seen.has(candidate.sessionId)) return false
          seen.add(candidate.sessionId)
          return true
        }),
        expiresAt: now + snapshotLifetime
      }
      id = randomUUID()
      // Bound memory while allowing overlapping refreshes to finish their own pages.
      while (this.snapshots.size >= 64) this.snapshots.delete(this.snapshots.keys().next().value!)
      this.snapshots.set(id, snapshot)
    }
    snapshot.expiresAt = Date.now() + snapshotLifetime
    const sessions: SDKSessionInfo[] = []
    while (offset < snapshot.candidates.length && sessions.length < limit) {
      const selected: ClaudeSessionCandidate[] = []
      while (
        offset < snapshot.candidates.length &&
        selected.length < Math.min(8, limit - sessions.length)
      ) {
        const candidate = snapshot.candidates[offset++]
        if (!hidden.has(candidate.sessionId)) selected.push(candidate)
      }
      const infos = await Promise.all(
        selected.map(async (candidate) => {
          const info = await read(candidate)
          return info ? { ...info, lastModified: candidate.mtime } : undefined
        })
      )
      for (const info of infos) if (info) sessions.push(info)
    }
    return {
      sessions,
      nextCursor: offset < snapshot.candidates.length ? `${cursorPrefix}${id}:${offset}` : null
    }
  }
}
