import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence.ts'
import type { ProviderAccountRateLimit } from '../../../shared/provider'

export const openCodeGoUsageEndpoint = 'https://opencode.ai/zen/go/v1/usage'
const openCodeGoUsageTimeoutMs = 15_000

type OpenCodeGoUsageWindow = {
  status?: unknown
  percent?: unknown
  resetsAt?: unknown
}

type OpenCodeGoUsagePayload = {
  rolling?: OpenCodeGoUsageWindow | null
  weekly?: OpenCodeGoUsageWindow | null
  monthly?: OpenCodeGoUsageWindow | null
}

export class OpenCodeGoNoSubscriptionError extends Error {
  constructor() {
    super('OpenCode Go subscription not found.')
    this.name = 'OpenCodeGoNoSubscriptionError'
  }
}

export class OpenCodeGoApiKeyMissingError extends Error {
  constructor() {
    super('OpenCode Go API key not found.')
    this.name = 'OpenCodeGoApiKeyMissingError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getApiKeyFromEntry = (entry: unknown): string | null => {
  if (!isRecord(entry)) return null
  if (entry.type === 'api' && typeof entry.key === 'string' && entry.key.trim()) {
    return entry.key.trim()
  }
  return null
}

export const extractOpenCodeGoApiKey = (store: unknown): string | null => {
  if (!isRecord(store)) return null
  return getApiKeyFromEntry(store['opencode-go']) ?? getApiKeyFromEntry(store.opencode) ?? null
}

export const parseOpenCodeAuthContent = (content: string): string | null => {
  try {
    return extractOpenCodeGoApiKey(JSON.parse(content))
  } catch (error) {
    console.error('[caught:OpenCodeUsage:parseOpenCodeAuthContent]', error)
    return null
  }
}

// OpenCode uses a valid OPENCODE_AUTH_CONTENT as the entire auth store, even
// when it contains no Go key. Only malformed JSON falls back to auth.json.
export const resolveOpenCodeAuthContent = async (
  envContent: string | undefined,
  readAuthFile: () => Promise<string | null>
): Promise<string | null> => {
  if (envContent) {
    try {
      JSON.parse(envContent)
      return envContent
    } catch (error) {
      console.error('[caught:OpenCodeUsage:resolveOpenCodeAuthContent]', error)
      // Match OpenCode's fallback for malformed environment content.
    }
  }
  return readAuthFile()
}

export const getOpenCodeAuthPath = (env: NodeJS.ProcessEnv, home: string): string => {
  const dataHome = env.XDG_DATA_HOME
  return join(
    dataHome && isAbsolute(dataHome) ? dataHome : join(home, '.local', 'share'),
    'opencode',
    'auth.json'
  )
}

// Read both sources in the same target environment as the OpenCode process.
// NUL separates arbitrary, potentially multiline JSON without shell interpolation.
export const openCodeAuthReadScript = [
  'set -eu',
  `printf '%s\\0' "\${OPENCODE_AUTH_CONTENT:-}"`,
  'case "${XDG_DATA_HOME:-}" in',
  '  /*) sele_data_home="$XDG_DATA_HOME" ;;',
  '  *) sele_data_home="$HOME/.local/share" ;;',
  'esac',
  'if [ -f "$sele_data_home/opencode/auth.json" ]; then',
  '  cat "$sele_data_home/opencode/auth.json"',
  'fi'
].join('\n')

const readTargetOpenCodeAuthContent = async (
  container?: AppContainerTarget | null
): Promise<string | null> => {
  const { getHostCommand } = await import('../../hostProcess')
  const command = await getHostCommand('sh', ['-c', openCodeAuthReadScript], {
    container,
    env: process.env
  })
  const { execFile } = await import('node:child_process')
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        maxBuffer: 256 * 1024,
        timeout: 15_000
      },
      (error, stdout) => {
        if (error)
          reject(new Error('Could not read OpenCode credentials in the selected environment.'))
        else resolve(stdout)
      }
    )
    child.stdin?.end()
  })
  const separator = output.indexOf('\0')
  if (separator < 0) throw new Error('Invalid OpenCode credential response.')
  return resolveOpenCodeAuthContent(
    output.slice(0, separator),
    async () => output.slice(separator + 1) || null
  )
}

export const usesLocalOpenCodeAuth = (
  container: AppContainerTarget | null | undefined,
  flatpak: boolean,
  hasHostBridge: boolean
): boolean => container?.kind !== 'container' && !flatpak && !hasHostBridge

export const getOpenCodeGoApiKey = async (
  container?: AppContainerTarget | null
): Promise<string> => {
  const { getCurrentContainerHostBridge } = await import('../../currentContainer')
  const useLocalFileSystem = usesLocalOpenCodeAuth(
    container,
    Boolean(process.env.FLATPAK_ID),
    Boolean(await getCurrentContainerHostBridge())
  )
  const content = useLocalFileSystem
    ? await resolveOpenCodeAuthContent(process.env.OPENCODE_AUTH_CONTENT, async () => {
        try {
          return await readFile(getOpenCodeAuthPath(process.env, homedir()), 'utf8')
        } catch (error) {
          if (isExpectedFileAbsenceError(error)) return null
          throw new Error('Could not read OpenCode credentials in the selected environment.')
        }
      })
    : await readTargetOpenCodeAuthContent(container)
  const apiKey = content ? parseOpenCodeAuthContent(content) : null
  if (!apiKey) throw new OpenCodeGoApiKeyMissingError()
  return apiKey
}

export const fetchOpenCodeGoUsage = async (
  apiKey: string,
  fetchFn: typeof fetch = fetch
): Promise<OpenCodeGoUsagePayload> => {
  const response = await fetchFn(openCodeGoUsageEndpoint, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
      'user-agent': 'sele'
    },
    signal: AbortSignal.timeout(openCodeGoUsageTimeoutMs)
  }).catch((error: unknown) => {
    throw new Error(
      error instanceof Error
        ? `OpenCode Go usage request failed: ${error.message}`
        : 'OpenCode Go usage request failed.'
    )
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch (error) {
    console.error('[caught:OpenCodeUsage:fetchOpenCodeGoUsage]', error)
    payload = null
  }
  if (response.status === 401) {
    throw new Error('OpenCode Go API key was rejected. Run `opencode auth login` again.')
  }
  if (isRecord(payload) && payload.type === 'error') {
    const error = isRecord(payload.error) ? payload.error : null
    const message = typeof error?.message === 'string' ? error.message : ''
    if (error?.type === 'EntitlementError' && /subscription/i.test(message)) {
      throw new OpenCodeGoNoSubscriptionError()
    }
    throw new Error(`OpenCode Go usage request failed with status ${response.status}.`)
  }
  if (!response.ok) {
    throw new Error(`OpenCode Go usage request failed with status ${response.status}.`)
  }
  if (!isRecord(payload) || !isRecord(payload.usage)) {
    throw new Error('OpenCode Go returned an invalid usage response.')
  }
  const usage = payload.usage as Record<string, unknown>
  const normalizeWindow = (value: unknown): OpenCodeGoUsageWindow | null =>
    isRecord(value) ? (value as OpenCodeGoUsageWindow) : null
  return {
    rolling: normalizeWindow(usage.rolling),
    weekly: normalizeWindow(usage.weekly),
    monthly: normalizeWindow(usage.monthly)
  }
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value))

const toResetsAt = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

export const mapOpenCodeGoUsageToRateLimits = (
  usage: OpenCodeGoUsagePayload
): ProviderAccountRateLimit[] => {
  const rateLimits: ProviderAccountRateLimit[] = []
  const addLimit = (
    id: string,
    displayLabel: string,
    window: OpenCodeGoUsageWindow | null | undefined,
    windowMinutes: number
  ): void => {
    const percent = typeof window?.percent === 'number' ? window.percent : null
    if (percent == null || !Number.isFinite(percent)) return
    rateLimits.push({
      id,
      label: 'OpenCode Go',
      displayLabel,
      kind: rateLimits.length === 0 ? 'primary' : 'secondary',
      usedPercent: clampPercent(percent),
      windowMinutes,
      resetsAt: toResetsAt(window?.resetsAt)
    })
  }
  addLimit('five_hour', '5-hour limit', usage.rolling, 300)
  addLimit('weekly', 'Weekly limit', usage.weekly, 10_080)
  addLimit('monthly', 'Monthly limit', usage.monthly, 43_200)
  return rateLimits
}

export const getOpenCodeGoRateLimits = async (
  container?: AppContainerTarget | null,
  fetchFn: typeof fetch = fetch
): Promise<ProviderAccountRateLimit[]> => {
  const apiKey = await getOpenCodeGoApiKey(container)
  const usage = await fetchOpenCodeGoUsage(apiKey, fetchFn)
  return mapOpenCodeGoUsageToRateLimits(usage)
}
