import { getProviderChatTurns, type ProviderChatTurn } from '../../shared/chatTurns.ts'
import { optimisticChatItemIdPrefix } from './chatDetailWindow.ts'
import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderModelId,
  ProviderPendingMessage
} from '../../shared/provider'
import type { ProviderBenchmarkCheckpoint, ProviderBenchmarkSide } from '../../shared/provider'

/**
 * A benchmark presents two agents working in separate worktrees as one chat. Both receive the same user messages, so their
 * transcripts align on those messages even when windows, paging, or provider-started turns
 * differ between the two chats.
 */

type UserTurnStart = ProviderMessage | ProviderPendingMessage

export const getUserTurnStart = (turn: ProviderChatTurn): UserTurnStart | null => {
  const first = turn.items[0]
  if (first?.type === 'pendingMessage') return first
  if (first?.type === 'message' && first.role === 'user') return first
  return null
}

const getComparableContent = (item: UserTurnStart): { text: string; truncated: boolean } => ({
  text: item.content.trim(),
  truncated: item.contentTruncated === true || item.contentLoaded === false
})

/** Renderer payload budgets can truncate either copy, so truncated text compares by prefix. */
const userContentMatches = (first: UserTurnStart, second: UserTurnStart): boolean => {
  const a = getComparableContent(first)
  const b = getComparableContent(second)
  if (!a.truncated && !b.truncated) return a.text === b.text
  if (!a.text || !b.text) return false
  const length = Math.min(a.text.length, b.text.length)
  return a.text.slice(0, length) === b.text.slice(0, length)
}

const turnsMatch = (primary: ProviderChatTurn, secondary: ProviderChatTurn): boolean => {
  const primaryStart = getUserTurnStart(primary)
  const secondaryStart = getUserTurnStart(secondary)
  return Boolean(primaryStart && secondaryStart && userContentMatches(primaryStart, secondaryStart))
}

export type BenchmarkTurnPair = {
  secondary: ProviderChatTurn
  /** Secondary turns without a primary counterpart, such as automatic continuations. */
  trailing: ProviderChatTurn[]
}

/**
 * Pairs primary turns with secondary turns that start with the same user message. The longest
 * common subsequence keeps repeated prompts in order, and ties prefer the newest turns.
 */
export const alignBenchmarkTurns = (
  primaryTurns: readonly ProviderChatTurn[],
  secondaryTurns: readonly ProviderChatTurn[]
): Map<string, BenchmarkTurnPair> => {
  const rows = primaryTurns.length
  const columns = secondaryTurns.length
  // lengths[row][column]: longest common subsequence of the first `row` and `column` turns.
  const lengths: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0)
  )
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      lengths[row][column] = turnsMatch(primaryTurns[row - 1], secondaryTurns[column - 1])
        ? lengths[row - 1][column - 1] + 1
        : Math.max(lengths[row - 1][column], lengths[row][column - 1])
    }
  }

  // Walk from the newest turns backwards so equal-length alternatives keep the latest pairing.
  const matches: [number, number][] = []
  let row = rows
  let column = columns
  while (row > 0 && column > 0) {
    if (
      turnsMatch(primaryTurns[row - 1], secondaryTurns[column - 1]) &&
      lengths[row][column] === lengths[row - 1][column - 1] + 1
    ) {
      matches.push([row - 1, column - 1])
      row -= 1
      column -= 1
    } else if (lengths[row - 1][column] >= lengths[row][column - 1]) {
      row -= 1
    } else {
      column -= 1
    }
  }
  matches.reverse()

  const pairs = new Map<string, BenchmarkTurnPair>()
  matches.forEach(([primaryIndex, secondaryIndex], index) => {
    const nextSecondaryIndex = matches[index + 1]?.[1] ?? columns
    pairs.set(primaryTurns[primaryIndex].id, {
      secondary: secondaryTurns[secondaryIndex],
      trailing: secondaryTurns.slice(secondaryIndex + 1, nextSecondaryIndex)
    })
  })
  return pairs
}

/** Items after the turn's opening user message: the agent's answer for that round. */
export const getBenchmarkTurnOutput = (turn: ProviderChatTurn): ProviderChatItem[] =>
  getUserTurnStart(turn) ? turn.items.slice(1) : turn.items

export const hasBenchmarkTurnOutput = (turn: ProviderChatTurn): boolean =>
  getBenchmarkTurnOutput(turn).some((item) => item.type !== 'pendingMessage')

/** The model that answered a turn, when the provider recorded one. */
export const getBenchmarkTurnModel = (
  turns: readonly ProviderChatTurn[]
): ProviderModelId | null => {
  for (const turn of [...turns].reverse()) {
    const message = turn.items.findLast(
      (item): item is ProviderMessage =>
        item.type === 'message' && item.role === 'assistant' && Boolean(item.model)
    )
    if (message?.model) return message.model
  }
  return null
}

export type BenchmarkRound = {
  /** The judged primary turn's first item; stable once the provider confirms the message. */
  turnId: string
  primary: ProviderChatTurn
  secondary: ProviderChatTurn[]
  votable: boolean
}

const isConfirmedUserTurn = (turn: ProviderChatTurn): boolean => {
  const start = getUserTurnStart(turn)
  return start?.type === 'message' && !start.id.startsWith(optimisticChatItemIdPrefix)
}

export const toBenchmarkRound = (
  primary: ProviderChatTurn,
  pair: BenchmarkTurnPair
): BenchmarkRound | null => {
  if (!isConfirmedUserTurn(primary) || !isConfirmedUserTurn(pair.secondary)) return null
  const secondary = [pair.secondary, ...pair.trailing.filter((turn) => !getUserTurnStart(turn))]
  const hasAnswer = (turn: ProviderChatTurn) =>
    getBenchmarkTurnOutput(turn).some(
      (item) => item.type === 'message' && item.role === 'assistant' && Boolean(item.content.trim())
    )
  if (!hasBenchmarkTurnOutput(primary) || !secondary.some(hasBenchmarkTurnOutput)) return null
  return {
    turnId: primary.id,
    primary,
    secondary,
    votable: hasAnswer(primary) && secondary.some(hasAnswer)
  }
}

export type BenchmarkSideHistory = {
  checkpoint: ProviderBenchmarkCheckpoint
  order: ProviderBenchmarkSide[]
}

export const getBenchmarkHistoryCheckpoint = (
  primary: ProviderChatItem[],
  secondary: ProviderChatItem[]
): ProviderBenchmarkCheckpoint => {
  const lastPrompt = (items: ProviderChatItem[]): string | null =>
    getProviderChatTurns(items).findLast(isConfirmedUserTurn)?.id ?? null
  return { primary: lastPrompt(primary), secondary: lastPrompt(secondary) }
}

export const splitBenchmarkSideHistory = (
  primary: readonly ProviderChatTurn[],
  secondary: readonly ProviderChatTurn[],
  history: BenchmarkSideHistory
) => {
  const split = (turns: readonly ProviderChatTurn[], side: ProviderBenchmarkSide) => {
    const anchor = history.checkpoint[side]
    const count = history.order.filter((value) => value === side).length
    if (count === 0) return { shared: turns, trials: [] }
    const boundary = anchor === null ? 0 : turns.findIndex((turn) => turn.id === anchor) + 1
    if (anchor !== null && boundary === 0) return { shared: turns, trials: [] }
    const shared = turns.slice(0, boundary)
    const trials: ProviderChatTurn[] = []
    for (const turn of turns.slice(boundary)) {
      if (getUserTurnStart(turn)) trials.push(turn)
      else if (trials.length > 0) {
        const last = trials[trials.length - 1]
        trials[trials.length - 1] = { ...last, items: [...last.items, ...turn.items] }
      } else shared.push(turn)
    }
    return { shared, trials }
  }
  const main = split(primary, 'primary')
  const companion = split(secondary, 'secondary')
  const next = { primary: 0, secondary: 0 }
  const trials = history.order.flatMap((side) => {
    const turn = (side === 'primary' ? main.trials : companion.trials)[next[side]++]
    return turn ? [{ side, turn }] : []
  })
  return { primary: main.shared, secondary: companion.shared, trials }
}

/** The latest paired round, including any automatic continuation after its prompt. */
export const getLatestBenchmarkRound = (
  primaryItems: ProviderChatItem[],
  secondaryItems: ProviderChatItem[]
): BenchmarkRound | null => {
  const primary = getProviderChatTurns(primaryItems)
  const latest = primary.findLast((turn) => getUserTurnStart(turn) !== null)
  if (!latest) return null
  const pair = alignBenchmarkTurns(primary, getProviderChatTurns(secondaryItems)).get(latest.id)
  if (!pair) return null
  const trailing = primary.slice(primary.indexOf(latest) + 1)
  return toBenchmarkRound(
    { ...latest, items: [...latest.items, ...trailing.flatMap(({ items }) => items)] },
    pair
  )
}

/** A queued prompt can reach both agents before the previous round can be voted on. */
export const getClosedBenchmarkRounds = (
  primaryItems: ProviderChatItem[],
  secondaryItems: ProviderChatItem[]
): BenchmarkRound[] => {
  const primary = getProviderChatTurns(primaryItems)
  const pairs = alignBenchmarkTurns(primary, getProviderChatTurns(secondaryItems))
  const confirmed = primary.filter((turn) => {
    const pair = pairs.get(turn.id)
    return pair && isConfirmedUserTurn(turn) && isConfirmedUserTurn(pair.secondary)
  })
  return confirmed.slice(0, -1).flatMap((turn) => {
    const pair = pairs.get(turn.id)
    const round = pair && toBenchmarkRound(turn, pair)
    return round ? [round] : []
  })
}

/** The secondary copy of a queued or steering message, matched by kind and content. */
export const findBenchmarkPendingMessage = (
  items: readonly ProviderChatItem[],
  message: ProviderPendingMessage
): ProviderPendingMessage | null =>
  items.find(
    (item): item is ProviderPendingMessage =>
      item.type === 'pendingMessage' &&
      item.kind === message.kind &&
      userContentMatches(item, message)
  ) ?? null

/**
 * Keeps older secondary history that slid out of the live window. Returns the retained items
 * before the next window, or null when the windows no longer overlap.
 */
export const retainBenchmarkHistory = (
  olderItems: readonly ProviderChatItem[],
  previousItems: readonly ProviderChatItem[],
  nextItems: readonly ProviderChatItem[]
): ProviderChatItem[] | null => {
  const firstId = nextItems[0]?.id
  if (!firstId) return olderItems.length || previousItems.length ? null : []
  const combined = [...olderItems, ...previousItems]
  const index = combined.findIndex((item) => item.id === firstId)
  if (index >= 0) return combined.slice(0, index)
  // The window did not move: no item from the previous window precedes the new one.
  return previousItems.length === 0 ? [...olderItems] : null
}

/** Joins retained history and the live window without duplicate item IDs. */
export const joinBenchmarkItems = (
  olderItems: readonly ProviderChatItem[],
  liveItems: readonly ProviderChatItem[]
): ProviderChatItem[] => {
  if (olderItems.length === 0) return liveItems as ProviderChatItem[]
  const liveIds = new Set(liveItems.map((item) => item.id))
  const seen = new Set<string>()
  const older = olderItems.filter((item) => {
    if (liveIds.has(item.id) || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
  return [...older, ...liveItems]
}
