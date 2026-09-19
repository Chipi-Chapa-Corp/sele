type ErrorWithCode = {
  code?: unknown
  killed?: unknown
  message?: unknown
  signal?: unknown
}

const getErrorCode = (error: unknown): string | number | null => {
  if (typeof error !== 'object' || error === null) return null
  const code = (error as ErrorWithCode).code
  return typeof code === 'string' || typeof code === 'number' ? code : null
}

const getErrorMessage = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return ''
  const message = (error as ErrorWithCode).message
  return typeof message === 'string' ? message : ''
}

export const isExpectedFileAbsenceError = (error: unknown): boolean => {
  const code = getErrorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export const isExpectedCommandAbsenceError = (
  error: unknown,
  expectedExitCodes: readonly number[] = []
): boolean => {
  const commandError = typeof error === 'object' && error !== null ? (error as ErrorWithCode) : null
  const message = getErrorMessage(error)
  if (
    commandError?.killed === true ||
    commandError?.signal != null ||
    /(?:timed?\s*out|timeout)/i.test(message)
  ) {
    return false
  }
  if (isExpectedFileAbsenceError(error)) return true
  const code = getErrorCode(error)
  if (code === 127 || (typeof code === 'number' && expectedExitCodes.includes(code))) return true
  return (
    /(?:^|\s)(?:command not found|not found: command)(?:$|\s)/i.test(message) ||
    /\bexecutable was not found(?::|\b)/i.test(message) ||
    /\bnot found:\s*[A-Za-z0-9_.+-]+\.?\s*$/i.test(message)
  )
}

export const isExpectedUrlParseError = (error: unknown): boolean => error instanceof TypeError
