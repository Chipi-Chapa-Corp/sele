import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { release, type as systemType } from 'node:os'
import { z } from 'zod'
import type { PredictionClient } from './CodexPromptSuggestions.ts'

// Temporary Desktop compatibility, based on Desktop 26.1027.30824. No local prompt or
// eligibility override: an unavailable/disabled configuration always means no prediction.
const predictionConfig = z.object({
  is_enabled: z.boolean(),
  unsupported_models: z.array(z.string()).optional(),
  live_sample_rate: z.number().min(0).max(1).optional(),
  catch_up_sample_rate: z.number().min(0).max(1).optional(),
  prompt: z.string().min(1),
  prompt_version: z.string(),
  prediction_reasoning_effort: z.string().transform((value) => value || null)
})
export const predictionSafetyPolicy = z.object({
  st: z.record(z.string(), z.number()).optional(),
  ubl: z.array(z.string()).optional(),
  abl: z.array(z.string()).optional()
})
export type PredictionSafetyPolicy = z.infer<typeof predictionSafetyPolicy>
export type DesktopPredictionSettings = z.infer<typeof predictionConfig> & {
  useThreadSample: boolean
  disableMcp: boolean
  safetyPolicy?: PredictionSafetyPolicy
}

type Principal = { userId: string; accountId: string; token: string; fedramp: boolean }
type BootstrapContext = {
  app_version: string
  stable_id: string
  locale: string
  system_name: string
  system_version: string
}
type Dependencies = {
  fetch?: typeof fetch
  context?: () => Promise<BootstrapContext>
  now?: () => number
}

let contextPromise: Promise<BootstrapContext> | undefined
const desktopContext = (): Promise<BootstrapContext> => {
  contextPromise ??= (async () => {
    const { app } = await import('electron')
    const path = join(app.getPath('userData'), 'codex-predictions-installation-id')
    let stableId: string
    try {
      stableId = (await readFile(path, 'utf8')).trim()
      if (!/^[\da-f-]{36}$/i.test(stableId)) throw new Error('Invalid prediction installation ID')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      stableId = randomUUID()
      try {
        await writeFile(path, stableId, { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        stableId = (await readFile(path, 'utf8')).trim()
      }
    }
    return {
      app_version: app.getVersion(),
      stable_id: stableId,
      locale: app.getLocale(),
      system_name: systemType(),
      system_version: release()
    }
  })().catch((error) => {
    contextPromise = undefined
    throw error
  })
  return contextPromise
}

const principalFromToken = (token: string): Principal | null => {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    const auth = claims['https://api.openai.com/auth']
    const userId = auth?.user_id ?? auth?.chatgpt_user_id
    const accountId = auth?.chatgpt_account_id ?? auth?.account_id
    if (typeof userId !== 'string' || typeof accountId !== 'string') return null
    return { userId, accountId, token, fedramp: auth.chatgpt_account_is_fedramp === true }
  } catch {
    return null
  }
}

// Statsig's published payload uses either readable keys or unsigned DJB2 keys.
const statsigKey = (name: string): string => {
  let hash = 0
  for (let index = 0; index < name.length; index++)
    hash = (Math.imul(hash, 31) + name.charCodeAt(index)) | 0
  return String(hash >>> 0)
}
const entry = (values: unknown, name: string): { value?: unknown } | undefined => {
  if (!values || typeof values !== 'object') return undefined
  const record = values as Record<string, { value?: unknown }>
  return record[name] ?? record[statsigKey(name)]
}

export class CodexDesktopPredictionConfig {
  private client: PredictionClient
  private fetch: typeof fetch
  private context: () => Promise<BootstrapContext>
  private now: () => number
  private cache?: {
    key: string
    expires: number
    settings: DesktopPredictionSettings | null
  }

  constructor(client: PredictionClient, dependencies: Dependencies = {}) {
    this.client = client
    this.fetch =
      dependencies.fetch ??
      (async (input, init) => {
        const { net } = await import('electron')
        return net.fetch(input, init)
      })
    this.context = dependencies.context ?? desktopContext
    this.now = dependencies.now ?? Date.now
  }

  clear(): void {
    this.cache = undefined
  }

  private async principal(signal: AbortSignal, refreshToken = false): Promise<Principal | null> {
    const status = await this.client.request<{ authMethod?: string; authToken?: string }>(
      'getAuthStatus',
      { includeToken: true, refreshToken },
      { signal }
    )
    if (
      !['chatgpt', 'chatgptAuthTokens'].includes(status.authMethod ?? '') ||
      typeof status.authToken !== 'string'
    )
      return null
    return principalFromToken(status.authToken)
  }

  private async json(
    path: string,
    principal: Principal,
    signal: AbortSignal,
    body?: unknown
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${principal.token}`,
      'ChatGPT-Account-Id': principal.accountId,
      'X-OpenAI-Attach-Auth': '1',
      // Desktop's HTTP feature originator; the app-server handshake remains Sele's.
      originator: 'Codex Desktop'
    }
    if (principal.fedramp) headers['X-OpenAI-Fedramp'] = 'true'
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await this.fetch(`https://chatgpt.com/backend-api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      redirect: 'error'
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw Object.assign(new Error(`Prediction configuration HTTP ${response.status}`), {
        status: response.status
      })
    }
    return response.json()
  }

  async load(signal: AbortSignal): Promise<DesktopPredictionSettings | null> {
    let principal = await this.principal(signal)
    if (!principal) return null
    const key = JSON.stringify([principal.userId, principal.accountId])
    if (this.cache?.key === key && this.cache.expires > this.now()) return this.cache.settings
    let settings: DesktopPredictionSettings | null = null
    try {
      let data: unknown
      try {
        data = await this.json('/wham/predictions/config', principal, signal)
      } catch (error) {
        if ((error as { status?: number }).status !== 401) throw error
        const refreshed = await this.principal(signal, true)
        if (!refreshed || JSON.stringify([refreshed.userId, refreshed.accountId]) !== key)
          return null
        principal = refreshed
        data = await this.json('/wham/predictions/config', principal, signal)
      }
      const config = predictionConfig.parse(data)
      if (config.is_enabled) {
        const bootstrap = await this.bootstrap(principal, signal)
        settings = { ...config, ...bootstrap }
      }
    } catch {
      signal.throwIfAborted()
      // Match Desktop: a failed config request is a cached, optional skip.
    }
    signal.throwIfAborted()
    this.cache = { key, expires: this.now() + 300_000, settings }
    return settings
  }

  private async bootstrap(
    principal: Principal,
    signal: AbortSignal
  ): Promise<Pick<DesktopPredictionSettings, 'useThreadSample' | 'disableMcp' | 'safetyPolicy'>> {
    const defaults = { useThreadSample: false, disableMcp: false }
    try {
      const context = await this.context()
      signal.throwIfAborted()
      const response = (await this.json('/wham/statsig/bootstrap', principal, signal, {
        ...context,
        app_session_id: randomUUID(),
        brand_name: 'codex',
        build_flavor: 'prod',
        window_type: 'electron'
      })) as { statsigPayload?: unknown }
      if (typeof response.statsigPayload !== 'string') return defaults
      const payload = JSON.parse(response.statsigPayload)
      if (
        payload.user?.userID !== principal.userId ||
        payload.user?.customIDs?.account_id !== principal.accountId
      )
        return defaults
      const policy = predictionSafetyPolicy.safeParse(
        entry(payload.dynamic_configs, 'codex-app-cumberbatch-mod-policy')?.value
      )
      return {
        useThreadSample:
          entry(payload.feature_gates, 'codex-app-cumberbatch-thread-sample')?.value === true,
        disableMcp:
          entry(payload.feature_gates, 'codex-app-cumberbatch-disable-mcp')?.value === true,
        safetyPolicy: policy.success ? policy.data : undefined
      }
    } catch {
      signal.throwIfAborted()
      // Desktop uses these same defaults while its Statsig client is unavailable.
      return defaults
    }
  }
}
