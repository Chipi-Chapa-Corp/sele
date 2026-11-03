const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isExpectedProviderErrorBodyParseError = (error: unknown): boolean =>
  error instanceof SyntaxError

const normalizeCode = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase()

const limitCodes = new Set([
  'ratelimit',
  'ratelimiterror',
  'ratelimited',
  'ratelimitexceeded',
  'usagelimitexceeded',
  'usagelimit',
  'gousagelimiterror',
  'freeusagelimiterror',
  'freetierlimit',
  'providerfreelimit',
  'quota',
  'quotaexceeded',
  'sessionquotaexceeded',
  'insufficientquota',
  'insufficientcredits',
  'insufficientbalance',
  'billingerror',
  'billingnotconfigured',
  'subscriptionrequired'
])

const isLimitCode = (value: string): boolean => {
  const code = normalizeCode(value)
  return limitCodes.has(code) || /^(?:user|integration).*ratelimited$/.test(code)
}

// Native request/authentication categories take precedence over incidental limit wording.
const nonUsageLimitCodes = new Set([
  'authentication',
  'authenticationfailed',
  'authorization',
  'permissiondenied',
  'invalidapikey',
  'oauthorgnotallowed',
  'accountonhold',
  'contextlimit',
  'contextlengthexceeded',
  'contextwindowexceeded',
  'contextoverflowerror',
  'maxoutputtokens',
  'errormaxturns',
  'errormaxbudgetusd',
  'errormaxstructuredoutputretries'
])

const limitMessagePattern =
  /\b(?:HTTP\s*|status(?:\s*code)?[\s:=]*|error[\s:]+)429\b|^429\b|too many requests|\brate[ _-]?limit(?:ed|s|exceeded|error)?\b|\busage[ _-]?limits?\b|free usage exceeded|(?:exceed|exhaust|deplet)\w*.{0,40}\bquota\b|\bquota\b.{0,40}(?:exceed|exhaust|deplet)|\binsufficient[ _-]?(?:quota|credits?|balance)\b|\bout of (?:credits?|balance)\b|(?:usage|spending|billing)[ _-]?(?:cap|limit).{0,40}(?:reach|exceed)|(?:limit|quota).{0,40}(?:resets?\b|try again in)|(?:hit|reached) (?:your|the) limit|(?:not enough|insufficient) credits|credit balance is too low|subscription required/i

const isLimitMessage = (text: string): boolean =>
  isLimitCode(text) ||
  limitMessagePattern.test(text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '))

/** Inspect error envelopes only. Never pass ordinary assistant text or tool output here. */
export const isProviderUsageLimitError = (error: unknown): boolean => {
  const seen = new Set<object>()
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 6) return false
    if (typeof value === 'string') {
      const text = value.trim()
      if (!text.startsWith('{')) return isLimitMessage(text)
      try {
        return visit(JSON.parse(text), depth + 1)
      } catch (error) {
        // Provider response bodies can be plain text or truncated JSON.
        if (isExpectedProviderErrorBodyParseError(error)) return isLimitMessage(text)
        throw error
      }
    }
    if (!isRecord(value) || seen.has(value)) return false
    seen.add(value)
    if (
      [value.status, value.statusCode, value.httpStatusCode].some(
        (status) => status === 429 || status === '429'
      )
    )
      return true
    const codes = [
      value.code,
      value.type,
      value.name,
      value.errorType,
      value.errorCode,
      value.codexErrorInfo
    ].filter((code): code is string => typeof code === 'string')
    if (codes.some(isLimitCode)) return true
    if (codes.some((code) => nonUsageLimitCodes.has(normalizeCode(code)))) return false
    return [
      value.message,
      value.additionalDetails,
      value.error,
      value.data,
      value.cause,
      value.responseBody,
      value.reason,
      value.codexErrorInfo
    ].some((nested) => visit(nested, depth + 1))
  }
  return visit(error, 0)
}
