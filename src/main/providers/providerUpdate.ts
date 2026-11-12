import { execFile } from 'node:child_process'
import type { AppContainerTarget } from '../../shared/app'
import { isExpectedCommandAbsenceError } from '../../shared/expectedAbsence.ts'
import type {
  ProviderChat,
  ProviderSourceOptions,
  ProviderUpdateAvailability,
  ProviderUpdateImpact
} from '../../shared/provider'
import type { HostCommand } from '../hostProcess'
import type { ProviderAdapter } from './ProviderAdapter'

export type ProviderUpdateOptions = {
  container?: AppContainerTarget | null
  env?: NodeJS.ProcessEnv
}

export type ProviderCommandOutput = {
  stdout: string
  stderr: string
}

export const versionCheckTimeoutMs = 20_000
export const updateTimeoutMs = 10 * 60_000

export const runProviderCommand = (
  command: HostCommand,
  timeout: number,
  describeFailure: (output: ProviderCommandOutput) => string,
  clean = (text: string): string => text.trim()
): Promise<ProviderCommandOutput> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        maxBuffer: 2 * 1024 * 1024,
        timeout
      },
      (error, stdout, stderr) => {
        const output = { stdout: clean(stdout), stderr: clean(stderr) }
        if (error) reject(new Error(describeFailure(output) || error.message))
        else resolve(output)
      }
    )
    child.stdin?.end()
  })

export const parseProviderVersion = (value: string): string | null =>
  /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(value)?.[1] ?? null

export const readProviderVersion = (output: ProviderCommandOutput, name: string): string => {
  const version = parseProviderVersion(`${output.stdout}\n${output.stderr}`)
  if (!version) throw new Error(`Unable to read ${name} version.`)
  return version
}

export const compareProviderVersions = (firstVersion: string, secondVersion: string): number => {
  const first = /^(\d+)\.(\d+)\.(\d+)/.exec(firstVersion)
  const second = /^(\d+)\.(\d+)\.(\d+)/.exec(secondVersion)
  if (!first || !second) return firstVersion.localeCompare(secondVersion)

  return (
    Number(first[1]) - Number(second[1]) ||
    Number(first[2]) - Number(second[2]) ||
    Number(first[3]) - Number(second[3])
  )
}

export const getProviderUpdateAvailabilityFromVersions = (
  currentVersion: string,
  latestVersion: string
): ProviderUpdateAvailability | null =>
  compareProviderVersions(currentVersion, latestVersion) < 0
    ? { currentVersion, latestVersion }
    : null

export const getLatestProviderVersion = async (
  url: string,
  name: string,
  metadataError: string,
  format: 'json' | 'text' = 'json'
): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), versionCheckTimeoutMs)

  try {
    const response = await fetch(url, {
      headers: { accept: format === 'json' ? 'application/json' : 'text/plain' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(metadataError)

    const body: unknown =
      format === 'json'
        ? ((await response.json()) as { version?: unknown }).version
        : await response.text()
    const version = typeof body === 'string' ? parseProviderVersion(body) : null
    if (!version) throw new Error(`Unable to read latest ${name} version.`)
    return version
  } finally {
    clearTimeout(timeout)
  }
}

export const getInstalledProviderUpdateAvailability = async (
  getCurrentVersion: () => Promise<string>,
  getLatestVersion: () => Promise<string>
): Promise<ProviderUpdateAvailability | null> => {
  let currentVersion: string
  try {
    currentVersion = await getCurrentVersion()
  } catch (error) {
    if (isExpectedCommandAbsenceError(error)) return null
    throw error
  }
  return getProviderUpdateAvailabilityFromVersions(currentVersion, await getLatestVersion())
}

type ProviderUpdateAdapter = Pick<ProviderAdapter, 'getChats' | 'stopChat'>

const activeChatStatuses = new Set<NonNullable<ProviderChat['status']>>([
  'active',
  'waitingOnApproval',
  'waitingOnUserInput'
])

export const collectActiveProviderChats = async (
  adapter: ProviderUpdateAdapter,
  options: ProviderSourceOptions = {}
): Promise<ProviderChat[]> => {
  const activeChats = new Map<string, ProviderChat>()
  const visitedCursors = new Set<string>()
  let cursor: string | null = null

  do {
    const page = await adapter.getChats({
      ...options,
      cursor,
      limit: 100
    })

    page.chats.forEach((chat) => {
      if (chat.status && activeChatStatuses.has(chat.status)) activeChats.set(chat.id, chat)
    })

    const nextCursor = page.nextCursor
    if (!nextCursor || visitedCursors.has(nextCursor)) break
    visitedCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)

  return Array.from(activeChats.values())
}

export const getProviderUpdateImpact = async (
  adapter: ProviderUpdateAdapter,
  options: ProviderSourceOptions = {}
): Promise<ProviderUpdateImpact> => ({
  activeChatCount: (await collectActiveProviderChats(adapter, options)).length
})

export const stopActiveProviderChats = async (
  adapter: ProviderUpdateAdapter,
  chats: readonly ProviderChat[]
): Promise<void> => {
  const results = await Promise.allSettled(chats.map((chat) => adapter.stopChat(chat.id)))
  const failures = results.filter((result) => result.status === 'rejected')
  failures.forEach((failure) =>
    console.error('[providerUpdate:stopActiveProviderChats]', failure.reason)
  )
  if (failures.length === 0) return

  const firstFailure = failures[0].reason
  const detail = firstFailure instanceof Error ? firstFailure.message : String(firstFailure)
  throw new Error(
    `Unable to stop ${failures.length} of ${chats.length} active chats before updating: ${detail}`
  )
}
