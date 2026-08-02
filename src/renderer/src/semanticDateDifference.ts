import { useSyncExternalStore } from 'react'

export type SemanticLexicalDateDifference = {
  dateTime: string
  label: string
  title: string
}

type SemanticLexicalDateDifferenceOptions = {
  now?: Date | number
}

const semanticDateRefreshMs = 30_000
const justNowThresholdMs = 45_000
const minuteMs = 60_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs

let currentSemanticDateNow = Date.now()
let semanticDateNowInterval: ReturnType<typeof setInterval> | null = null
const semanticDateNowSubscribers = new Set<() => void>()

const getDateTimestamp = (value: Date | number): number =>
  value instanceof Date ? value.getTime() : value

const getLocalCalendarDayNumber = (date: Date): number =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs

const getCalendarDayDifference = (date: Date, now: Date): number =>
  getLocalCalendarDayNumber(date) - getLocalCalendarDayNumber(now)

const formatClockTime = (date: Date): string =>
  date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit'
  })

const formatDate = (date: Date, includeYear: boolean): string =>
  date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {})
  })

const formatAbsoluteDateTime = (date: Date): string =>
  `${formatDate(date, true)} ${formatClockTime(date)}`

const pluralize = (value: number, unit: string): string =>
  value === 1 ? `1 ${unit}` : `${value} ${unit}s`

const formatPastDifference = (differenceMs: number): string => {
  if (differenceMs < justNowThresholdMs) return 'Just now'

  const minutes = Math.max(1, Math.floor(differenceMs / minuteMs))
  if (minutes < 60) return `${pluralize(minutes, 'minute')} ago`

  return `${pluralize(Math.max(1, Math.floor(differenceMs / hourMs)), 'hour')} ago`
}

const formatFutureDifference = (differenceMs: number): string => {
  if (differenceMs < justNowThresholdMs) return 'Just now'

  const minutes = Math.max(1, Math.ceil(differenceMs / minuteMs))
  if (minutes < 60) return `In ${pluralize(minutes, 'minute')}`

  return `In ${pluralize(Math.max(1, Math.ceil(differenceMs / hourMs)), 'hour')}`
}

const getSemanticDateNowSnapshot = (): number => currentSemanticDateNow

const notifySemanticDateNowSubscribers = (): void => {
  currentSemanticDateNow = Date.now()
  semanticDateNowSubscribers.forEach((listener) => listener())
}

const subscribeSemanticDateNow = (listener: () => void): (() => void) => {
  semanticDateNowSubscribers.add(listener)
  currentSemanticDateNow = Date.now()

  if (semanticDateNowInterval === null) {
    semanticDateNowInterval = setInterval(notifySemanticDateNowSubscribers, semanticDateRefreshMs)
  }

  return () => {
    semanticDateNowSubscribers.delete(listener)

    if (semanticDateNowSubscribers.size === 0 && semanticDateNowInterval !== null) {
      clearInterval(semanticDateNowInterval)
      semanticDateNowInterval = null
    }
  }
}

export const useSemanticDateNow = (): number =>
  useSyncExternalStore(
    subscribeSemanticDateNow,
    getSemanticDateNowSnapshot,
    getSemanticDateNowSnapshot
  )

export const formatSemanticLexicalDateDifference = (
  timestamp: number | null | undefined,
  options: SemanticLexicalDateDifferenceOptions = {}
): SemanticLexicalDateDifference | null => {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null

  const nowTimestamp = options.now === undefined ? Date.now() : getDateTimestamp(options.now)
  if (!Number.isFinite(nowTimestamp)) return null

  const now = new Date(nowTimestamp)
  if (Number.isNaN(now.getTime())) return null

  const calendarDayDifference = getCalendarDayDifference(date, now)
  const timeLabel = formatClockTime(date)
  const sameYear = date.getFullYear() === now.getFullYear()
  let label: string

  if (calendarDayDifference === 0) {
    const differenceMs = now.getTime() - date.getTime()
    label =
      differenceMs >= 0
        ? formatPastDifference(differenceMs)
        : formatFutureDifference(Math.abs(differenceMs))
  } else if (calendarDayDifference === -1) {
    label = `Yesterday ${timeLabel}`
  } else if (calendarDayDifference === 1) {
    label = `Tomorrow ${timeLabel}`
  } else {
    label = `${formatDate(date, !sameYear)} ${timeLabel}`
  }

  return {
    dateTime: date.toISOString(),
    label,
    title: formatAbsoluteDateTime(date)
  }
}
