import { createPreferenceClient } from '../../preload/preferenceClient'
import {
  preferencesChannel,
  type PreferenceChanges,
  type PreferenceResult,
  type PreferenceValues
} from '../../shared/preferences'
import { preferencesChangedChannel } from '../../shared/preferenceSync'
import { LanConnectionError, type LanTransport } from './lanTransport'

/** Only idempotent preference values have an outbox. Chat/terminal mutations
 * always use LanTransport directly and are never retried after an uncertain result. */
export function createLanPreferences({
  transport,
  initial,
  storage,
  key
}: {
  transport: Pick<LanTransport, 'invoke' | 'on' | 'removeListener' | 'isReady'>
  initial: PreferenceResult
  storage: {
    getItem(key: string): string | null
    setItem(key: string, value: string): void | Promise<void>
  }
  key: string
}) {
  let outbox: PreferenceChanges = JSON.parse(storage.getItem(key) ?? '{}')
  if (
    !outbox ||
    typeof outbox !== 'object' ||
    Array.isArray(outbox) ||
    Object.entries(outbox).some(
      ([name, value]) => !name.startsWith('sele:') || (value !== null && typeof value !== 'string')
    )
  )
    throw new Error('The saved preference outbox is invalid. Saved drafts have not been reset.')
  const sourceId = crypto.randomUUID()
  let revision = 0
  let durable = Promise.resolve()
  let syncing: Promise<void> | null = null
  let first: PreferenceResult | null = initial
  let failure: string | null = null
  const failures = new Set<(error: string) => void>()
  const deferred: PreferenceChanges = {}
  let deliver: ((changes: PreferenceChanges) => void) | undefined
  const persist = (): Promise<void> => {
    const value = JSON.stringify(outbox)
    durable = durable.then(() => storage.setItem(key, value))
    return durable
  }
  const sync = (): Promise<void> => {
    if (syncing) return syncing
    syncing = (async () => {
      await durable
      while (transport.isReady && Object.keys(outbox).length) {
        const values = { ...outbox }
        // A new local batch supersedes canonical echoes from the older batch.
        for (const name of Object.keys(values)) delete deferred[name]
        try {
          const result = await transport.invoke<PreferenceResult>(preferencesChannel, {
            action: 'write',
            sourceId,
            revision: ++revision,
            values
          })
          if (!result.ok) throw new Error(result.error)
          outbox = Object.fromEntries(
            Object.entries(outbox).filter(
              ([name, value]) => !Object.hasOwn(values, name) || values[name] !== value
            )
          )
          const acknowledged: PreferenceChanges = {}
          for (const [name, value] of Object.entries(deferred)) {
            if (Object.hasOwn(outbox, name)) continue
            acknowledged[name] = value
            delete deferred[name]
          }
          if (Object.keys(acknowledged).length) deliver?.(acknowledged)
          await persist()
        } catch (error) {
          if (error instanceof LanConnectionError) return
          throw error
        }
      }
    })().finally(() => {
      syncing = null
    })
    return syncing
  }
  const failed = (error: unknown): void => {
    failure = error instanceof Error ? error.message : String(error)
    failures.forEach((listener) => listener(failure!))
  }
  const client = createPreferenceClient({
    initialize: async () => {
      const result =
        first ?? (await transport.invoke<PreferenceResult>(preferencesChannel, { action: 'load' }))
      first = null
      if (!result.ok) return result
      const values: PreferenceValues = { ...(typeof result.value === 'object' ? result.value : {}) }
      for (const [name, value] of Object.entries(outbox)) {
        if (value === null) delete values[name]
        else values[name] = value
      }
      return { ok: true, value: values }
    },
    write: async (values) => {
      outbox = { ...outbox, ...values }
      await persist()
      void sync().catch(failed)
      return { ok: true, value: null }
    },
    commit: (values) => {
      outbox = { ...outbox, ...values }
      void persist().catch(failed)
      return { ok: true, value: null }
    },
    subscribe: (listener) => {
      deliver = listener
      const handler = (_event: unknown, changes: PreferenceChanges): void => {
        for (const [name, value] of Object.entries(changes)) {
          if (Object.hasOwn(outbox, name)) deferred[name] = value
        }
        listener(
          Object.fromEntries(
            Object.entries(changes).filter(([name]) => !Object.hasOwn(outbox, name))
          )
        )
      }
      transport.on(preferencesChangedChannel, handler)
      return () => transport.removeListener(preferencesChangedChannel, handler)
    }
  })
  return {
    ...client,
    syncPending: sync,
    async reconnect(): Promise<void> {
      await client.flush()
      await sync()
      const result = await client.refresh()
      if (!result.ok) throw new Error(result.error)
    },
    flush: async (): Promise<PreferenceResult> => {
      const result = await client.flush()
      if (!result.ok) return result
      try {
        await durable
        await sync()
        return failure ? { ok: false, error: failure } : { ok: true, value: null }
      } catch (error) {
        failed(error)
        return { ok: false, error: failure! }
      }
    },
    onFailure: (listener: (error: string) => void) => {
      failures.add(listener)
      const stop = client.onFailure(listener)
      return () => {
        failures.delete(listener)
        stop()
      }
    }
  }
}
