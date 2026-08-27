import type { BrowserCookieImportResult } from '../../shared/browser'

const skipReasonLabels: ReadonlyArray<
  readonly [keyof BrowserCookieImportResult['skipReasons'], string]
> = [
  ['contextual', 'container/private-context'],
  ['expired', 'expired'],
  ['invalid', 'invalid'],
  ['partitioned', 'partitioned'],
  ['protected', 'protected by unsupported encryption'],
  ['rejected', 'rejected during import']
]

export const getBrowserCookieImportMessage = (
  result: BrowserCookieImportResult,
  profileName: string
): string => {
  const reasons = skipReasonLabels.flatMap(([reason, label]) => {
    const count = result.skipReasons[reason]
    return count > 0 ? [`${count} ${label}`] : []
  })
  const explainedSkipped = Object.values(result.skipReasons).reduce(
    (total, count) => total + count,
    0
  )
  const otherSkipped = Math.max(0, result.skipped - explainedSkipped)
  if (otherSkipped > 0) reasons.push(`${otherSkipped} other`)

  const cookieLabel = result.total === 1 ? 'cookie' : 'cookies'
  const skippedMessage =
    result.skipped > 0
      ? ` Skipped ${result.skipped}${reasons.length > 0 ? `: ${reasons.join(', ')}` : ''}.`
      : ''

  return `Imported ${result.imported} of ${result.total} ${cookieLabel} from ${profileName}.${skippedMessage}`
}
