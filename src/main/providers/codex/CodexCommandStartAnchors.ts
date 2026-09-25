import type { CodexTurn } from './CodexItemRenderers.ts'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence.ts'
import type { CodexTranscriptMetadata } from './CodexTranscriptMetadataIndex.ts'

type StartTimes = Map<string, number>

/** Read identity and start time only; transcript content still comes from the history API. */
export const readCodexItemStartTimes = (text: string): Map<string, StartTimes> => {
  const turns = new Map<string, StartTimes>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch (error) {
      // The writer may not have finished the final line yet.
      if (error instanceof SyntaxError) continue
      throw error
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

type TurnItem = CodexTurn['items'][number]

type OrderNode = {
  item: TurnItem
  priority: number
  size: number
  maxStart: number
  start: number
  left: OrderNode | null
  right: OrderNode | null
  parent: OrderNode | null
}

const nodeSize = (node: OrderNode | null): number => node?.size ?? 0
const nodeMaxStart = (node: OrderNode | null): number => node?.maxStart ?? -Infinity

const updateNode = (node: OrderNode): void => {
  node.size = 1 + nodeSize(node.left) + nodeSize(node.right)
  node.maxStart = Math.max(node.start, nodeMaxStart(node.left), nodeMaxStart(node.right))
  if (node.left) node.left.parent = node
  if (node.right) node.right.parent = node
}

/** An implicit randomized tree keeps insertion and earliest-anchor lookup logarithmic on average. */
const mergeNodes = (left: OrderNode | null, right: OrderNode | null): OrderNode | null => {
  if (!left) {
    if (right) right.parent = null
    return right
  }
  if (!right) {
    left.parent = null
    return left
  }
  if (left.priority < right.priority) {
    left.right = mergeNodes(left.right, right)
    updateNode(left)
    left.parent = null
    return left
  }
  right.left = mergeNodes(left, right.left)
  updateNode(right)
  right.parent = null
  return right
}

const splitNodes = (
  root: OrderNode | null,
  count: number
): [OrderNode | null, OrderNode | null] => {
  if (!root) return [null, null]
  if (count <= nodeSize(root.left)) {
    const [before, after] = splitNodes(root.left, count)
    root.left = after
    updateNode(root)
    root.parent = null
    if (before) before.parent = null
    return [before, root]
  }
  const [before, after] = splitNodes(root.right, count - nodeSize(root.left) - 1)
  root.right = before
  updateNode(root)
  root.parent = null
  if (after) after.parent = null
  return [root, after]
}

const nodeIndex = (node: OrderNode): number => {
  let index = nodeSize(node.left)
  for (let current = node; current.parent; current = current.parent) {
    if (current.parent.right === current) index += nodeSize(current.parent.left) + 1
  }
  return index
}

const firstLaterStart = (root: OrderNode | null, startedAt: number): OrderNode | null => {
  if (!root || !(root.maxStart > startedAt)) return null
  return (
    firstLaterStart(root.left, startedAt) ??
    (root.start > startedAt ? root : firstLaterStart(root.right, startedAt))
  )
}

const appendItems = (node: OrderNode | null, items: TurnItem[]): void => {
  if (!node) return
  appendItems(node.left, items)
  items.push(node.item)
  appendItems(node.right, items)
}

export const anchorCodexCommandsByStart = (turn: CodexTurn, times: StartTimes): CodexTurn => {
  // Commands cannot cross a user message. An earlier segment with a later start
  // blocks a move altogether, even when the current segment also has an anchor.
  let priorMax = -Infinity
  let segmentMax = -Infinity
  let couldMove = false
  for (const item of turn.items) {
    if (item.type === 'userMessage') {
      priorMax = Math.max(priorMax, segmentMax)
      segmentMax = -Infinity
      continue
    }
    const startedAt = times.get(item.id)
    if (
      item.type === 'commandExecution' &&
      startedAt !== undefined &&
      !(priorMax > startedAt) &&
      segmentMax > startedAt
    )
      couldMove = true
    if (startedAt !== undefined && !Number.isNaN(startedAt))
      segmentMax = Math.max(segmentMax, startedAt)
  }
  if (!couldMove) return turn

  type Segment = { root: OrderNode | null; priorMax: number }
  const segments: Segment[] = []
  const firstNode = new Map<TurnItem, { node: OrderNode; segment: Segment }>()
  const separators: TurnItem[] = []
  priorMax = -Infinity
  segmentMax = -Infinity
  let segment: Segment = { root: null, priorMax }
  segments.push(segment)
  for (const item of turn.items) {
    if (item.type === 'userMessage') {
      separators.push(item)
      priorMax = Math.max(priorMax, segmentMax)
      segmentMax = -Infinity
      segment = { root: null, priorMax }
      segments.push(segment)
      continue
    }
    const rawStart = times.get(item.id)
    const start = rawStart === undefined || Number.isNaN(rawStart) ? -Infinity : rawStart
    segmentMax = Math.max(segmentMax, start)
    const node: OrderNode = {
      item,
      priority: Math.random(),
      size: 1,
      maxStart: start,
      start,
      left: null,
      right: null,
      parent: null
    }
    segment.root = mergeNodes(segment.root, node)
    if (!firstNode.has(item)) firstNode.set(item, { node, segment })
  }

  let changed = false
  for (const command of turn.items) {
    if (command.type !== 'commandExecution') continue
    const startedAt = times.get(command.id)
    if (startedAt === undefined) continue
    const entry = firstNode.get(command)
    if (!entry || entry.segment.priorMax > startedAt) continue
    const { node, segment: commandSegment } = entry
    const [before, fromCommand] = splitNodes(commandSegment.root, nodeIndex(node))
    const anchor = firstLaterStart(before, startedAt)
    if (!anchor) {
      commandSegment.root = mergeNodes(before, fromCommand)
      continue
    }
    const [commandNode, after] = splitNodes(fromCommand, 1)
    const [beforeAnchor, fromAnchor] = splitNodes(before, nodeIndex(anchor))
    commandSegment.root = mergeNodes(
      mergeNodes(mergeNodes(beforeAnchor, commandNode), fromAnchor),
      after
    )
    changed = true
  }
  if (!changed) return turn
  const items: TurnItem[] = []
  for (let i = 0; i < segments.length; i++) {
    appendItems(segments[i].root, items)
    if (i < separators.length) items.push(separators[i])
  }
  return { ...turn, items }
}

/** Recover missing start anchors only for history containing post-answer command completions. */
export class CodexCommandStartAnchors {
  private snapshots = new WeakMap<CodexTurn, CodexTurn>()
  private versions = new WeakMap<CodexTurn, number>()
  private pending = new Map<string, Promise<boolean>>()

  clear(): void {
    this.snapshots = new WeakMap()
    this.versions = new WeakMap()
    this.pending.clear()
  }

  project(turn: CodexTurn): CodexTurn {
    return this.snapshots.get(turn) ?? turn
  }

  /** Project fresh API snapshots from the shared index without reopening the transcript. */
  apply(thread: { turns: CodexTurn[] }, metadata: CodexTranscriptMetadata): boolean {
    let changed = false
    for (const turn of thread.turns) {
      if (!hasTrailingCommand(turn)) continue
      if (this.versions.get(turn) === metadata.version) continue
      const starts = metadata.starts.get(turn.id)
      const projected = starts ? anchorCodexCommandsByStart(turn, starts) : turn
      const previous = this.snapshots.get(turn)
      this.snapshots.set(turn, projected)
      this.versions.set(turn, metadata.version)
      changed ||=
        projected !== turn &&
        (!previous || previous.items.some((item, index) => item !== projected.items[index]))
    }
    return changed
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
