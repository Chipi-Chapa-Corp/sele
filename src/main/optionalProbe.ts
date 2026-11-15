import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import {
  isExpectedCommandAbsenceError,
  isExpectedFileAbsenceError
} from '../shared/expectedAbsence.ts'
import { quotePosixShellArg } from './targetShell.ts'

export const isExecutableFile = async (
  file: string,
  accessFile: (path: string, mode: number) => Promise<void> = access
): Promise<boolean> => {
  try {
    await accessFile(file, constants.X_OK)
    return true
  } catch (error) {
    if (!isExpectedFileAbsenceError(error) && (error as ProcessFailure | null)?.code !== 'EACCES') {
      console.error('[hostProcess:isExecutableFile] Unable to inspect executable candidate', error)
    }
    return false
  }
}

export const isExpectedShellCandidateAbsence = (error: unknown, detail = ''): boolean => {
  if (isExpectedFileAbsenceError(error)) return true
  return (
    (error as ProcessFailure | null)?.code === 1 &&
    /(?:failed to execute[^\n]*no such file|no such file or directory[^\n]*(?:shell|executable)?)/i.test(
      detail
    )
  )
}

export const loadOptionalFile = async <T>(
  load: () => Promise<T>,
  warning: string
): Promise<T | null> => {
  try {
    return await load()
  } catch (error) {
    if (isExpectedFileAbsenceError(error)) return null
    console.warn(warning, error)
    return null
  }
}

export const availabilityFoundMarker = '__SELE_COMMAND_AVAILABLE__'

export const getContainerCommandAvailabilityScript = (command: string): string =>
  `if command -v ${quotePosixShellArg(command)} >/dev/null 2>&1; then printf '%s\\n' '${availabilityFoundMarker}'; fi`

type ProcessFailure = {
  code?: unknown
  killed?: unknown
  signal?: unknown
}

const isExitCode = (error: unknown, codes: readonly number[]): boolean =>
  codes.includes((error as ProcessFailure | null)?.code as number)

const wasInterrupted = (error: unknown): boolean =>
  (error as ProcessFailure | null)?.killed === true ||
  Boolean((error as ProcessFailure | null)?.signal)

export const isExpectedOptionalGitProbeFailure = (
  args: readonly string[],
  error: unknown,
  stderr: string
): boolean => {
  if (wasInterrupted(error)) return false

  const command = args.find((argument) => !argument.startsWith('-'))
  if (!command) return false

  if (command === 'config') {
    if (args.includes('--get') || args.includes('--get-all')) {
      return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
    }
    if (args.includes('--unset-all')) {
      return !stderr.trim() && isExpectedCommandAbsenceError(error, [5])
    }
    return false
  }

  if (command === 'symbolic-ref' && args.includes('--quiet')) {
    return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
  }

  if (command === 'merge-base') {
    return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
  }

  if (command === 'apply' && args.includes('--reverse') && args.includes('--check')) {
    return (
      isExpectedCommandAbsenceError(error, [1]) &&
      /(?:patch failed|patch does not apply)/i.test(stderr)
    )
  }

  if (command === 'rev-parse') {
    if (args.includes('--verify') && args.includes('--quiet')) {
      return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
    }

    if (!isExitCode(error, [128])) return false
    const normalizedStderr = stderr.toLocaleLowerCase()
    if (args.includes('--show-toplevel') && normalizedStderr.includes('not a git repository')) {
      return true
    }

    const probesHead = args.includes('HEAD')
    const probesUpstream = args.includes('@{upstream}')
    if (!probesHead && !probesUpstream) return false
    return (
      normalizedStderr.includes('needed a single revision') ||
      normalizedStderr.includes('unknown revision') ||
      normalizedStderr.includes('ambiguous argument') ||
      normalizedStderr.includes('no upstream configured') ||
      normalizedStderr.includes('no such branch')
    )
  }

  if (command === 'log' && isExitCode(error, [128])) {
    const normalizedStderr = stderr.toLocaleLowerCase()
    return (
      normalizedStderr.includes('does not have any commits yet') ||
      (normalizedStderr.includes('your current branch') &&
        normalizedStderr.includes('does not have any commits'))
    )
  }

  return false
}

export const logUnexpectedOptionalGitProbeFailure = (
  args: readonly string[],
  error: unknown,
  stderr: string,
  message: string
): void => {
  if (isExpectedOptionalGitProbeFailure(args, error, stderr)) return
  console.warn(message, error)
}
