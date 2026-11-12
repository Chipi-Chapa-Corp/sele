export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const shouldAppendExecutableHint = (
  message: string,
  hasConfiguredExecutable: boolean
): boolean =>
  hasConfiguredExecutable ||
  message.includes('Executable was not found') ||
  message.includes('ENOENT') ||
  message.includes('A coding-agent CLI invocation resolved to Sele itself')

export const emptyUsageSummary = {
  lifetimeTokens: null,
  peakDailyTokens: null,
  longestRunningTurnSec: null,
  currentStreakDays: null,
  longestStreakDays: null
}

export const getRuntimeEnvironment = (env: NodeJS.ProcessEnv | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env ?? process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

const maxToolOutputLength = 160_000
const maxRawToolValueLength = 80_000
const maxRawToolCollectionEntries = 200
const maxRawToolDepth = 8
export const truncatedToolValueMarker = '… [truncated to keep the app responsive]'

export const getToolArgument = (input: unknown, ...keys: string[]): string | null => {
  if (!isRecord(input)) return null
  for (const key of keys) {
    const value = getString(input[key])
    if (value) return value
  }
  return null
}

export const truncateEarlierToolOutput = (value: string | null): string | null => {
  if (value == null || value.length <= maxToolOutputLength) return value
  return `${truncatedToolValueMarker}\n${value.slice(-maxToolOutputLength)}`
}

export const boundSerializedToolValue = (value: unknown): unknown => {
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized.length <= maxRawToolValueLength) return value
    return `${serialized.slice(0, maxRawToolValueLength)}\n${truncatedToolValueMarker}`
  } catch (error) {
    console.error('Unable to serialize a tool value.', error)
    return String(value)
  }
}

type RawToolValueBudget = {
  remaining: number
  seen: WeakSet<object>
}

export const getBoundedRawToolValue = (
  value: unknown,
  budget: RawToolValueBudget = {
    remaining: maxRawToolValueLength,
    seen: new WeakSet<object>()
  },
  depth = 0
): unknown => {
  if (typeof value === 'string') {
    if (value.length <= budget.remaining) {
      budget.remaining -= value.length
      return value
    }

    const visibleValue = value.slice(0, Math.max(0, budget.remaining))
    budget.remaining = 0
    return `${visibleValue}\n${truncatedToolValueMarker}`
  }
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return String(value)
  }
  if (depth >= maxRawToolDepth || budget.remaining <= 0) return truncatedToolValueMarker
  if (budget.seen.has(value)) return '[Circular]'

  budget.seen.add(value)

  if (Array.isArray(value)) {
    const boundedValue: unknown[] = []
    const entryLimit = Math.min(value.length, maxRawToolCollectionEntries)

    for (let index = 0; index < entryLimit && budget.remaining > 0; index += 1) {
      budget.remaining -= 1
      boundedValue.push(getBoundedRawToolValue(value[index], budget, depth + 1))
    }
    if (entryLimit < value.length || budget.remaining <= 0) {
      boundedValue.push(truncatedToolValueMarker)
    }

    return boundedValue
  }

  const boundedValue: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  const entryLimit = Math.min(entries.length, maxRawToolCollectionEntries)

  for (let index = 0; index < entryLimit && budget.remaining > 0; index += 1) {
    const [key, entryValue] = entries[index]
    budget.remaining -= key.length + 1
    boundedValue[key] = getBoundedRawToolValue(entryValue, budget, depth + 1)
  }
  if (entryLimit < entries.length || budget.remaining <= 0) {
    boundedValue.__truncated__ = truncatedToolValueMarker
  }

  return boundedValue
}
