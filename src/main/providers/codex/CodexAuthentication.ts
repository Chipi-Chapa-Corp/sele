/** Match account-auth failures, without treating connector/site authorization or rate limits as account expiry. */
export function isCodexAuthenticationFailure(error: unknown, depth = 0): boolean {
  if (depth > 8 || !error || typeof error !== 'object') return false
  const value = error as {
    code?: unknown
    status?: unknown
    codexErrorInfo?: unknown
    message?: unknown
  }
  const data = (error as { data?: unknown }).data
  if (
    data &&
    typeof data === 'object' &&
    data !== error &&
    isCodexAuthenticationFailure(data, depth + 1)
  )
    return true
  if (value.code === 'authentication_failed' || value.codexErrorInfo === 'unauthorized') return true
  const info = value.codexErrorInfo
  if (info && typeof info === 'object' && 'unauthorized' in info) return true
  return (
    typeof value.message === 'string' &&
    /refresh token (?:has )?(?:expired|been revoked|already been used)|refresh token.*(?:invalid|revoked)|access token could not be refreshed|please (?:sign|log) in again|authentication[_ ]failed|not (?:logged|signed) in|(?:ChatGPT|Codex|OAuth).{0,50}(?:authentication|credentials|token).{0,30}(?:expired|revoked|invalid)/i.test(
      value.message
    )
  )
}
