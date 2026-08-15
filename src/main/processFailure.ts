const getProcessOutput = (value: string | Buffer | null | undefined): string => {
  if (value == null) return ''
  return Buffer.isBuffer(value) ? value.toString('utf8').trim() : value.trim()
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message.trim() : typeof error === 'string' ? error.trim() : ''

type ProcessFailureOptions = {
  label?: string
  timeoutMs?: number
}

type ProcessErrorDetails = {
  code?: unknown
  killed?: unknown
  signal?: unknown
}

const getProcessErrorDetails = (error: unknown): ProcessErrorDetails =>
  error && typeof error === 'object' ? (error as ProcessErrorDetails) : {}

const formatTimeout = (timeoutMs: number): string => {
  if (timeoutMs % 1_000 === 0) return `${timeoutMs / 1_000} seconds`
  return `${timeoutMs} ms`
}

export const getProcessFailureMessage = (
  error: unknown,
  stdout: string | Buffer | null | undefined,
  stderr: string | Buffer | null | undefined,
  options: ProcessFailureOptions = {}
): string => {
  const output = [getProcessOutput(stderr), getProcessOutput(stdout)].filter(Boolean)
  const uniqueOutput = [...new Set(output)]
  if (uniqueOutput.length > 0) return uniqueOutput.join('\n')

  const label = options.label?.trim() || 'Command'
  const details = getProcessErrorDetails(error)

  if (details.killed === true && options.timeoutMs != null) {
    return `${label} timed out after ${formatTimeout(options.timeoutMs)} without producing diagnostic output.`
  }
  if (details.code === 'ENOENT') {
    return `${label} could not start because its executable was not found.`
  }
  if (details.code === 'EACCES') {
    return `${label} could not start because its executable is not accessible.`
  }
  if (typeof details.code === 'number') {
    return `${label} failed with exit code ${details.code} without producing diagnostic output.`
  }
  if (typeof details.signal === 'string' && details.signal) {
    return `${label} was terminated by signal ${details.signal} without producing diagnostic output.`
  }

  const message = getErrorMessage(error)
  if (message && !/^Command failed(?::|$)/i.test(message)) return message

  return `${label} failed without producing diagnostic output.`
}
