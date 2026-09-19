import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence.ts'

type SessionIndexRecord = {
  id?: unknown
  thread_name?: unknown
  threadName?: unknown
  name?: unknown
}

const getCodexHome = (): string => process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')

const getRecordThreadName = (record: SessionIndexRecord): string | null => {
  const name = record.thread_name ?? record.threadName ?? record.name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

export const loadSessionThreadNames = async (threadIds: string[]): Promise<Map<string, string>> => {
  const targetIds = new Set(threadIds)
  const names = new Map<string, string>()
  if (targetIds.size === 0) return names

  try {
    const contents = await readFile(join(getCodexHome(), 'session_index.jsonl'), 'utf8')

    for (const line of contents.split('\n')) {
      if (!line.trim()) continue

      try {
        const record = JSON.parse(line) as SessionIndexRecord
        if (typeof record.id !== 'string' || !targetIds.has(record.id)) continue

        const name = getRecordThreadName(record)
        if (name) names.set(record.id, name)
      } catch (error) {
        // Keep scanning; one malformed row should not hide names from later rows.
        console.warn('Unable to parse a Codex session index row', error)
      }
    }
  } catch (error) {
    if (!isExpectedFileAbsenceError(error)) {
      console.warn('Unable to read the Codex session index', error)
    }
    return names
  }

  return names
}

export const loadSessionThreadName = async (threadId: string): Promise<string | null> =>
  (await loadSessionThreadNames([threadId])).get(threadId) ?? null
