import { createKeyedSubscriptions } from './keyedSubscriptions.ts'

export const chatSleepStorageKey = 'sele:sleeping-chats:v1'
export const legacyChatBookmarksStorageKey = 'sele:bookmarked-chats:v1'

/** Wake time in epoch milliseconds, or null when only a manual wake ends the sleep. */
export type ChatWakeAt = number | null

type ChatSleepStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type ChatSleepStoreOptions = {
  storage: ChatSleepStorage
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

const minuteMs = 60_000
const durationUnits = [
  ['w', 7 * 24 * 60 * minuteMs],
  ['d', 24 * 60 * minuteMs],
  ['h', 60 * minuteMs],
  ['m', minuteMs]
] as const
const durationUnitMs: Readonly<Record<string, number>> = Object.fromEntries(durationUnits)

// A sleeping or suspended machine can leave a long timer late, and a long delay
// overflows setTimeout. Re-checking the clock each minute handles both.
const maxTimerDelayMs = minuteMs

/** Parses durations such as "1w 3d 5h 6m". Returns null unless the input is a positive duration. */
export const parseSleepDuration = (input: string): number | null => {
  const text = input.trim().toLowerCase()
  if (!/^(?:\d+\s*[wdhm]\s*)+$/.test(text)) return null
  let total = 0
  for (const [, amount, unit] of text.matchAll(/(\d+)\s*([wdhm])/g)) {
    total += Number(amount) * durationUnitMs[unit]
  }
  return total > 0 && Number.isSafeInteger(total) ? total : null
}

/** Formats a remaining time like "1w 3d 5h 6m", rounding up to the next minute. */
export const formatSleepDuration = (durationMs: number): string => {
  let remaining = Math.max(minuteMs, Math.ceil(durationMs / minuteMs) * minuteMs)
  const parts: string[] = []
  for (const [unit, unitMs] of durationUnits) {
    const amount = Math.floor(remaining / unitMs)
    if (amount > 0) parts.push(`${amount}${unit}`)
    remaining -= amount * unitMs
  }
  return parts.join(' ')
}

const readStoredChats = (storage: ChatSleepStorage): Map<string, ChatWakeAt> | null => {
  const stored = storage.getItem(chatSleepStorageKey)
  if (stored === null) return null
  const parsed: unknown = JSON.parse(stored)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map()
  return new Map(
    Object.entries(parsed).filter(
      (entry): entry is [string, ChatWakeAt] =>
        entry[0].trim().length > 0 &&
        (entry[1] === null || (typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    )
  )
}

const readLegacyBookmarks = (storage: ChatSleepStorage): Map<string, ChatWakeAt> | null => {
  const stored = storage.getItem(legacyChatBookmarksStorageKey)
  if (stored === null) return null
  const parsed: unknown = JSON.parse(stored)
  if (!Array.isArray(parsed)) return new Map()
  return new Map(
    parsed
      .filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
      .map((key) => [key, null])
  )
}

export const createChatSleepStore = ({
  storage,
  now = Date.now,
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
}: ChatSleepStoreOptions) => {
  const subscriptions = createKeyedSubscriptions<string>()
  let chats: ReadonlyMap<string, ChatWakeAt> = new Map()
  let loaded = false
  let timer: unknown = null

  const write = (next: ReadonlyMap<string, ChatWakeAt>): void => {
    try {
      if (next.size === 0) storage.removeItem(chatSleepStorageKey)
      else storage.setItem(chatSleepStorageKey, JSON.stringify(Object.fromEntries(next)))
    } catch (error) {
      console.error('[caught:chatSleepStore:write]', error)
    }
  }

  const withoutExpired = (current: ReadonlyMap<string, ChatWakeAt>): Map<string, ChatWakeAt> => {
    const time = now()
    return new Map([...current].filter(([, wakeAt]) => wakeAt === null || wakeAt > time))
  }

  const schedule = (): void => {
    if (timer !== null) clearTimer(timer)
    timer = null
    let nextWakeAt = Number.POSITIVE_INFINITY
    for (const wakeAt of chats.values()) {
      if (wakeAt !== null && wakeAt < nextWakeAt) nextWakeAt = wakeAt
    }
    if (nextWakeAt === Number.POSITIVE_INFINITY) return
    timer = setTimer(wakeExpired, Math.min(Math.max(0, nextWakeAt - now()), maxTimerDelayMs))
  }

  const wakeExpired = (): void => {
    const previous = chats
    const next = withoutExpired(previous)
    if (next.size !== previous.size) {
      chats = next
      write(next)
    }
    schedule()
    for (const key of previous.keys()) {
      if (!next.has(key)) subscriptions.notify(key)
    }
  }

  const load = (): void => {
    if (loaded) return
    loaded = true
    try {
      const stored = readStoredChats(storage)
      const legacy = stored === null ? readLegacyBookmarks(storage) : null
      const current = stored ?? legacy ?? new Map<string, ChatWakeAt>()
      // Chats whose time passed while the app was closed wake here, before the first render.
      chats = withoutExpired(current)
      if (legacy !== null || chats.size !== current.size) write(chats)
      if (legacy !== null) storage.removeItem(legacyChatBookmarksStorageKey)
    } catch (error) {
      console.error('[caught:chatSleepStore:load]', error)
    }
    schedule()
  }

  const commit = (key: string, next: ReadonlyMap<string, ChatWakeAt>): void => {
    chats = next
    write(next)
    schedule()
    subscriptions.notify(key)
  }

  return {
    subscribe(listener: () => void): () => void {
      load()
      return subscriptions.subscribe(listener)
    },
    subscribeKey(key: string, listener: () => void): () => void {
      load()
      return subscriptions.subscribeKey(key, listener)
    },
    getSnapshot(): ReadonlyMap<string, ChatWakeAt> {
      load()
      return chats
    },
    /** Sleeps a chat until woken manually, or for a duration. Replaces any existing timer. */
    sleep(key: string, durationMs?: number): void {
      load()
      const wakeAt = durationMs === undefined ? null : now() + durationMs
      if (chats.get(key) === wakeAt) return
      commit(key, new Map(chats).set(key, wakeAt))
    },
    wake(key: string): void {
      load()
      if (!chats.has(key)) return
      const next = new Map(chats)
      next.delete(key)
      commit(key, next)
    }
  }
}
