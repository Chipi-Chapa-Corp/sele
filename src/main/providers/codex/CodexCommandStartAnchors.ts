import type { CodexTurn } from './CodexItemRenderers.ts'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence.ts'

type StartTimes = Map<string, number>

/** Read identity and start time only; transcript content still comes from the history API. */
export const readCodexItemStartTimes = (text: string): Map<string, StartTimes> => {
  const turns = new Map<string, StartTimes>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      // The writer may not have finished the final line yet.
      continue
    }
    const event = row?.payload
    const item = event?.item
    if (
      row?.type !== 'event_msg' ||
      event?.type !== 'item_completed' ||
      typeof event.turn_id !== 'string' ||
      typeof item?.id !== 'string'
    )
      continue
    const startedAt = event.started_at_ms
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) continue
    const times = turns.get(event.turn_id) ?? new Map<string, number>()
    times.set(item.id, Math.min(times.get(item.id) ?? startedAt, startedAt))
    turns.set(event.turn_id, times)
  }
  return turns
}

const hasTrailingCommand = (turn: CodexTurn): boolean => {
  let seenFinal = false
  return turn.items.some((item) => {
    if (item.type === 'agentMessage' && item.phase === 'final_answer') seenFinal = true
    return seenFinal && item.type === 'commandExecution'
  })
}

export const anchorCodexCommandsByStart = (turn: CodexTurn, times: StartTimes): CodexTurn => {
  const items = [...turn.items]
  let changed = false
  for (const command of turn.items) {
    if (command.type !== 'commandExecution') continue
    const startedAt = times.get(command.id)
    if (startedAt === undefined) continue
    const index = items.indexOf(command)
    const anchor = items.findIndex(
      (item, candidate) =>
        candidate < index &&
        item.type !== 'userMessage' &&
        times.has(item.id) &&
        times.get(item.id)! > startedAt
    )
    if (anchor < 0) continue
    // Never move an execution across user/steering input, even if timings are incomplete.
    if (items.slice(anchor, index).some((item) => item.type === 'userMessage')) continue
    items.splice(index, 1)
    items.splice(anchor, 0, command)
    changed = true
  }
  return changed ? { ...turn, items } : turn
}

/** Recover missing start anchors only for history containing post-answer command completions. */
export class CodexCommandStartAnchors {
  private snapshots = new WeakMap<CodexTurn, CodexTurn>()
  private pending = new Map<string, Promise<boolean>>()

  clear(): void {
    this.snapshots = new WeakMap()
    this.pending.clear()
  }

  project(turn: CodexTurn): CodexTurn {
    return this.snapshots.get(turn) ?? turn
  }

  async load(
    thread: { id: string; path?: string | null; turns: CodexTurn[] },
    readFile: (path: string) => Promise<string>
  ): Promise<boolean> {
    if (!thread.path) return false
    const pending = this.pending.get(thread.id)
    if (pending) {
      const changed = await pending
      return (await this.load(thread, readFile)) || changed
    }
    const candidates = thread.turns.filter(
      (turn) => !this.snapshots.has(turn) && hasTrailingCommand(turn)
    )
    if (!candidates.length) return false
    const request = (async () => {
      try {
        const times = readCodexItemStartTimes(await readFile(thread.path!))
        let changed = false
        for (const turn of candidates) {
          const starts = times.get(turn.id)
          const projected = starts ? anchorCodexCommandsByStart(turn, starts) : turn
          this.snapshots.set(turn, projected)
          changed ||= projected !== turn
        }
        return changed
      } catch (error) {
        if (!isExpectedFileAbsenceError(error))
          console.warn('Unable to read Codex command start anchors', error)
        // Do not retry on every render of the same snapshot.
        for (const turn of candidates) this.snapshots.set(turn, turn)
        return false
      }
    })()
    this.pending.set(thread.id, request)
    try {
      return await request
    } finally {
      this.pending.delete(thread.id)
    }
  }
}
