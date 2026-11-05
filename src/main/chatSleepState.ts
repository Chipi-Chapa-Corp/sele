import type { ChatSleepChange, ChatSleepSnapshot, ChatWakeAt } from '../shared/chatSleep.ts'

export const createChatSleepState = ({
  read,
  write,
  broadcast,
  now = Date.now
}: {
  read(): Promise<{ sleeping: string | null; legacy: string | null }>
  write(value: string | null): Promise<void>
  broadcast(snapshot: ChatSleepSnapshot): void
  now?: () => number
}) => {
  let revision = 0
  let previous = ''
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }
  const load = async (): Promise<Record<string, ChatWakeAt>> => {
    const stored = await read()
    let parsed: unknown
    try {
      parsed = JSON.parse(stored.sleeping ?? stored.legacy ?? '{}')
    } catch {
      // A damaged preference must not prevent desktop or phone startup.
      return {}
    }
    const entries =
      stored.sleeping === null && Array.isArray(parsed)
        ? parsed
            .filter((key): key is string => typeof key === 'string')
            .map((key) => [key, null] as const)
        : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.entries(parsed)
          : []
    return Object.fromEntries(
      entries.filter(
        ([key, value]) =>
          key.length > 0 &&
          (value === null || (typeof value === 'number' && Number.isFinite(value) && value > now()))
      )
    )
  }
  const publish = (sleeping: Record<string, ChatWakeAt>): ChatSleepSnapshot => {
    const value = JSON.stringify(sleeping)
    if (value !== previous) {
      previous = value
      revision++
      broadcast({ revision, sleeping })
    }
    return { revision, sleeping }
  }
  return {
    getState: () => serial(async () => publish(await load())),
    update: (value: unknown) =>
      serial(async () => {
        if (!Array.isArray(value) || value.length > 10000)
          throw new Error('Invalid sleeping-chat update.')
        const changes = value as ChatSleepChange[]
        for (const change of changes) {
          if (
            !change ||
            typeof change.key !== 'string' ||
            !change.key.trim() ||
            change.key.length > 1024 ||
            change.key.includes('\0') ||
            !(
              change.wakeAt === false ||
              change.wakeAt === null ||
              (typeof change.wakeAt === 'number' &&
                Number.isSafeInteger(change.wakeAt) &&
                change.wakeAt > 0)
            ) ||
            (change.expected !== undefined &&
              change.expected !== null &&
              !(typeof change.expected === 'number' && Number.isSafeInteger(change.expected)))
          )
            throw new Error('Invalid sleeping-chat update.')
        }
        const sleeping = await load()
        for (const change of changes) {
          if (change.expected !== undefined && sleeping[change.key] !== change.expected) continue
          if (
            change.wakeAt === false ||
            (typeof change.wakeAt === 'number' && change.wakeAt <= now())
          )
            delete sleeping[change.key]
          else
            Object.defineProperty(sleeping, change.key, {
              value: change.wakeAt,
              writable: true,
              configurable: true,
              enumerable: true
            })
        }
        // Keep an explicit empty map so migrated bookmarks cannot reappear.
        await write(JSON.stringify(sleeping))
        return publish(sleeping)
      })
  }
}
