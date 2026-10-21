import type { ProviderAccountRateLimit } from '../../../shared/provider'

/**
 * OpenCode Zen's keyless free tier has no usage endpoint: the server limits free models per IP
 * and only reports the limit once it is hit (HTTP 429 `FreeUsageLimitError`, usually with
 * `retry-after`). Sele records that signal so the usage indicator can show the reset time.
 */
export type OpenCodeFreeLimitSignal = { resetsAt: number | null }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const freeLimitPattern = /FreeUsageLimitError|free usage exceeded|free[_ -]tier[_ -]limit/i

const getHeader = (headers: unknown, name: string): string | null => {
  if (!isRecord(headers)) return null
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** Parses `retry-after-ms` or `retry-after` (seconds or an HTTP date) into an epoch timestamp. */
export const parseOpenCodeRetryAfter = (headers: unknown, now: number): number | null => {
  const milliseconds = Number(getHeader(headers, 'retry-after-ms'))
  if (Number.isFinite(milliseconds) && milliseconds > 0) return now + milliseconds
  const value = getHeader(headers, 'retry-after')
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds > 0 ? now + seconds * 1_000 : null
  const date = Date.parse(value)
  return Number.isFinite(date) && date > now ? date : null
}

const fromStatus = (status: unknown, now: number): OpenCodeFreeLimitSignal | null => {
  if (!isRecord(status) || status.type !== 'retry') return null
  const action = isRecord(status.action) ? status.action : null
  const message = typeof status.message === 'string' ? status.message : ''
  if (action?.reason !== 'free_tier_limit' && !freeLimitPattern.test(message)) return null
  // `next` is when OpenCode retries; it follows the server's retry-after when one was sent.
  const next = typeof status.next === 'number' && status.next > now ? status.next : null
  return { resetsAt: next }
}

const fromError = (error: unknown, now: number): OpenCodeFreeLimitSignal | null => {
  if (!isRecord(error)) return null
  // Newer OpenCode versions report a typed session error.
  if (error.type === 'provider.free-limit') {
    const retryAfterMs = typeof error.retryAfterMs === 'number' ? error.retryAfterMs : null
    return { resetsAt: retryAfterMs && retryAfterMs > 0 ? now + retryAfterMs : null }
  }
  const data = isRecord(error.data) ? error.data : null
  const text = [data?.responseBody, data?.message, error.message]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
  if (!freeLimitPattern.test(text)) return null
  return { resetsAt: parseOpenCodeRetryAfter(data?.responseHeaders, now) }
}

/** Detects the free-tier limit in an OpenCode event (session status, session error or message). */
export const getOpenCodeFreeLimitSignal = (
  type: string,
  properties: Record<string, unknown>,
  now = Date.now()
): OpenCodeFreeLimitSignal | null => {
  if (type === 'session.status') return fromStatus(properties.status, now)
  if (type === 'session.error') return fromError(properties.error, now)
  if (type === 'message.updated' && isRecord(properties.info))
    return fromError(properties.info.error, now)
  return null
}

type FreeLimitState = { detectedAt: number; resetsAt: number | null }

/** Free-limit state per OpenCode target, cleared at reset or by a later successful free reply. */
export class OpenCodeFreeLimitTracker {
  private states = new Map<string, FreeLimitState>()
  private readonly clock: () => number

  constructor(clock: () => number = Date.now) {
    this.clock = clock
  }

  record = (targetKey: string, signal: OpenCodeFreeLimitSignal): void => {
    const current = this.states.get(targetKey)
    this.states.set(targetKey, {
      detectedAt: this.clock(),
      // A later retry status may not carry a time; keep the one the server already sent.
      resetsAt: signal.resetsAt ?? current?.resetsAt ?? null
    })
  }

  /** Records free-limit signals and successful replies from an OpenCode event. */
  observe = (targetKey: string, type: string, properties: Record<string, unknown>): void => {
    const signal = getOpenCodeFreeLimitSignal(type, properties, this.clock())
    if (signal) this.record(targetKey, signal)
    else if (type === 'message.updated') this.recordMessage(targetKey, properties.info)
  }

  /** A reply from OpenCode Zen that finished after the limit was seen means it has lifted. */
  recordMessage = (targetKey: string, info: unknown): void => {
    const state = this.states.get(targetKey)
    if (!state || !isRecord(info) || info.role !== 'assistant' || info.error) return
    if (info.providerID !== 'opencode') return
    const completed = isRecord(info.time) ? info.time.completed : null
    if (typeof completed === 'number' && completed > state.detectedAt) this.states.delete(targetKey)
  }

  getRateLimits = (targetKey: string): ProviderAccountRateLimit[] => {
    const state = this.states.get(targetKey)
    if (!state) return []
    if (state.resetsAt != null && state.resetsAt <= this.clock()) {
      this.states.delete(targetKey)
      return []
    }
    return [
      {
        id: 'opencode_free',
        label: 'OpenCode Zen',
        displayLabel: 'Free limit reached',
        kind: 'primary',
        usedPercent: 100,
        windowMinutes: 1_440,
        resetsAt: state.resetsAt
      }
    ]
  }
}
