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
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : null
    if (!isExpectedFileAbsenceError(error) && code !== 'EACCES') {
      console.error('[hostProcess:isExecutableFile] Unable to inspect executable candidate', error)
    }
    return false
  }
}

export const isExpectedShellCandidateAbsence = (error: unknown, detail = ''): boolean => {
  if (isExpectedFileAbsenceError(error)) return true
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : null
  return (
    code === 1 &&
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
  typeof error === 'object' &&
  error !== null &&
  typeof (error as ProcessFailure).code === 'number' &&
  codes.includes((error as ProcessFailure).code as number)

const wasInterrupted = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as ProcessFailure).killed === true || Boolean((error as ProcessFailure).signal))

const includesArgument = (args: readonly string[], argument: string): boolean =>
  args.includes(argument)

export const isExpectedOptionalGitProbeFailure = (
  args: readonly string[],
  error: unknown,
  stderr: string
): boolean => {
  if (wasInterrupted(error)) return false

  const command = args.find((argument) => !argument.startsWith('-'))
  if (!command) return false

  if (command === 'config') {
    if (includesArgument(args, '--get') || includesArgument(args, '--get-all')) {
      return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
    }
    if (includesArgument(args, '--unset-all')) {
      return !stderr.trim() && isExpectedCommandAbsenceError(error, [5])
    }
    return false
  }

  if (command === 'symbolic-ref' && includesArgument(args, '--quiet')) {
    return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
  }

  if (command === 'merge-base') {
    return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
  }

  if (
    command === 'apply' &&
    includesArgument(args, '--reverse') &&
    includesArgument(args, '--check')
  ) {
    return (
      isExpectedCommandAbsenceError(error, [1]) &&
      /(?:patch failed|patch does not apply)/i.test(stderr)
    )
  }

  if (command === 'rev-parse') {
    if (includesArgument(args, '--verify') && includesArgument(args, '--quiet')) {
      return !stderr.trim() && isExpectedCommandAbsenceError(error, [1])
    }

    if (!isExitCode(error, [128])) return false
    const normalizedStderr = stderr.toLocaleLowerCase()
    if (
      includesArgument(args, '--show-toplevel') &&
      normalizedStderr.includes('not a git repository')
    ) {
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
