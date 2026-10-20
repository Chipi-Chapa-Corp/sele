import { open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getSessionInfo, type SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence.ts'
import type { ClaudeSessionCandidate } from './ClaudeSessionCatalog.ts'

export const claudeSessionSummaryBytes = 64 * 1024
const summaryBytes = claudeSessionSummaryBytes

export const parseClaudeSessionSummary = async (
  sessionId: string,
  size: number,
  head: Buffer,
  tail: Buffer,
  titleData?: Buffer,
  hasContinuation?: (sessionId: string) => Promise<boolean>
) => {
  const length = size
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid Claude session size')
  const firstLine = head.toString('utf8').split('\n', 1)[0]
  if (/"isSidechain":\s*true/.test(firstLine)) return undefined
  const entries: SessionStoreEntry[] = []
  const parse = (text: string, partialStart = false): void => {
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry && typeof entry === 'object' && typeof entry.type === 'string')
          entries.push(entry)
      } catch (error) {
        // Boundary fragments and a final in-progress append are expected.
        if ((!partialStart || index > 0) && index < lines.length - 1)
          console.error('Unable to parse Claude session summary.', error)
      }
    }
  }
  if (length <= summaryBytes * 2) {
    // Reconstruct overlapping windows, including UTF-8 code points at the join.
    parse(
      Buffer.concat([head, tail.subarray(Math.max(0, summaryBytes * 2 - length))]).toString('utf8')
    )
  } else {
    parse(head.subarray(0, head.lastIndexOf(10) + 1).toString('utf8'))
    // Keep the SDK's head and tail independent after dropping incomplete records.
    // Otherwise a short tail could see old titles/branches from the head through the gap.
    entries.push({ type: 'summary-gap', padding: ' '.repeat(summaryBytes) })
    parse(tail.toString('utf8'), true)
  }
  // The CLI can keep /rename in a sidecar after its transcript title falls outside the tail.
  if (titleData && !/"customTitle":\s*"/.test(tail.toString('utf8'))) {
    try {
      const title = JSON.parse(titleData.toString('utf8'))
      if (typeof title.customTitle === 'string')
        entries.push({ type: 'custom-title', customTitle: title.customTitle })
    } catch (error) {
      console.error('Unable to parse Claude session title sidecar.', error)
    }
  }
  const inspect = (records: SessionStoreEntry[]) =>
    getSessionInfo(sessionId, {
      sessionStore: {
        load: async () => records,
        append: async () => {
          throw new Error('Discovery store is read-only')
        }
      }
    })
  const continuationIndex = entries.findLastIndex((entry) => entry.type === 'continued-in')
  const target = entries[continuationIndex]?.continuedInSessionId
  if (hasContinuation && typeof target === 'string' && /^[a-f0-9-]{36}$/i.test(target)) {
    const later = entries.slice(continuationIndex + 1)
    const answered = later.some(
      (entry) =>
        entry.type === 'assistant' &&
        entry.isApiErrorMessage !== true &&
        typeof (entry.message as { stop_reason?: unknown } | undefined)?.stop_reason === 'string'
    )
    // A new user prompt or completed answer after the marker means the original resumed.
    const resumed = answered || Boolean((await inspect(later))?.firstPrompt)
    if (!resumed && (await hasContinuation(target))) return undefined
  }
  const info = await inspect(entries)
  return info ? { ...info, fileSize: length } : undefined
}

/** Read the exact catalog file (including duplicate IDs in different projects). */
export const readLocalClaudeSessionInfo = async (candidate: ClaudeSessionCandidate) => {
  let file: Awaited<ReturnType<typeof open>>
  try {
    file = await open(candidate.path, 'r')
  } catch (error) {
    if (!isExpectedFileAbsenceError(error))
      console.error('Unable to open Claude session summary.', error)
    return undefined
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile()) return undefined
    const read = async (offset: number) => {
      const buffer = Buffer.allocUnsafe(summaryBytes)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      return buffer.subarray(0, bytesRead)
    }
    const head = await read(0)
    const tail =
      stat.size <= summaryBytes ? head : await read(Math.max(0, stat.size - summaryBytes))
    let titleData: Buffer | undefined
    if (!/"customTitle":\s*"/.test(tail.toString('utf8'))) {
      let sidecar: Awaited<ReturnType<typeof open>> | undefined
      try {
        sidecar = await open(candidate.path.replace(/\.jsonl$/, '/custom-title.json'), 'r')
        const buffer = Buffer.allocUnsafe(summaryBytes)
        const { bytesRead } = await sidecar.read(buffer, 0, buffer.length, 0)
        titleData = buffer.subarray(0, bytesRead)
      } catch (error) {
        if (!isExpectedFileAbsenceError(error))
          console.error('Unable to read Claude session title sidecar.', error)
      } finally {
        await sidecar?.close()
      }
    }
    return await parseClaudeSessionSummary(
      candidate.sessionId,
      stat.size,
      head,
      tail,
      titleData,
      async (target) => {
        let continued: Awaited<ReturnType<typeof open>> | undefined
        try {
          continued = await open(join(dirname(candidate.path), `${target}.jsonl`), 'r')
          const info = await continued.stat()
          if (!info.isFile()) return false
          for (const offset of [0, Math.max(0, info.size - summaryBytes)]) {
            const buffer = Buffer.allocUnsafe(summaryBytes)
            const { bytesRead } = await continued.read(buffer, 0, buffer.length, offset)
            if (buffer.subarray(0, bytesRead).includes('"parentUuid":')) return true
          }
          return false
        } catch (error) {
          if (!isExpectedFileAbsenceError(error))
            console.error('Unable to check Claude continuation.', error)
          return false
        } finally {
          await continued?.close()
        }
      }
    )
  } catch (error) {
    if (!isExpectedFileAbsenceError(error))
      console.error('Unable to read Claude session summary.', error)
    return undefined
  } finally {
    await file.close()
  }
}
