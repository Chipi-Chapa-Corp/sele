import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CodexDesktopPredictionConfig,
  type DesktopPredictionSettings,
  type PredictionSafetyPolicy
} from './CodexDesktopPredictionConfig.ts'
import type { PredictionClient, PredictionNotification } from './CodexPromptSuggestions.ts'

const resultSchema = z.object({ suggestion: z.string().trim().nullable() })
const moderationSide = z.record(
  z.string(),
  z.object({
    outputs: z.array(
      z.object({
        results: z.array(
          z.object({
            labels: z.array(z.string()).optional(),
            _modapi_scores: z.record(z.string(), z.number()).optional()
          })
        )
      })
    )
  })
)
const moderationSchema = z.object({
  prompt: moderationSide.optional(),
  generation: moderationSide.optional()
})

const supports = (version: string | null | undefined, minimum: number[]): boolean => {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/)
  if (!match) return false
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? Infinity)]
  for (let index = 0; index < parts.length; index++) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index]
  }
  return true
}

const suppressed = (metadata: unknown[], policy?: PredictionSafetyPolicy): boolean => {
  if (!policy) return false
  for (const value of metadata) {
    const parsed = moderationSchema.safeParse(value)
    if (!parsed.success) continue
    for (const side of ['prompt', 'generation'] as const) {
      const labels = side === 'prompt' ? policy.ubl : policy.abl
      for (const item of Object.values(parsed.data[side] ?? {}))
        for (const output of item.outputs)
          for (const result of output.results) {
            if (result.labels?.some((label) => labels?.includes(label))) return true
            if (
              side === 'prompt' &&
              Object.entries(policy.st ?? {}).some(
                ([label, threshold]) => (result._modapi_scores?.[label] ?? -Infinity) >= threshold
              )
            )
              return true
          }
    }
  }
  return false
}

type Job = { turnId: string; abort: AbortController; promise: Promise<void> }
type Dependencies = {
  config?: Pick<CodexDesktopPredictionConfig, 'load' | 'clear'>
  random?: () => number
  timeoutMs?: number
}

/** Removable implementation of Desktop 26.1027.30824's composer-prediction orchestration. */
export class CodexDesktopPredictions {
  private client: PredictionClient
  private publish: (notification: PredictionNotification) => void
  private config: Pick<CodexDesktopPredictionConfig, 'load' | 'clear'>
  private random: () => number
  private timeoutMs: number
  private jobs = new Map<string, Job>()
  private temporaryThreads = new Set<string>()
  private moderation = new Map<string, unknown[]>()
  private unsubscribe: () => void

  constructor(
    client: PredictionClient,
    publish: (notification: PredictionNotification) => void,
    dependencies: Dependencies = {}
  ) {
    this.client = client
    this.publish = publish
    this.config = dependencies.config ?? new CodexDesktopPredictionConfig(client)
    this.random = dependencies.random ?? Math.random
    this.timeoutMs = dependencies.timeoutMs ?? 30_000
    this.unsubscribe = client.onNotification((notification) => {
      const params = notification.params as
        | { threadId?: string; turnId?: string; metadata?: unknown }
        | undefined
      if (!params?.threadId) return
      if (notification.method === 'turn/started') this.cancel(params.threadId)
      if (notification.method === 'thread/closed') this.temporaryThreads.delete(params.threadId)
      if (notification.method !== 'turn/moderationMetadata' || !params.turnId) return
      const key = JSON.stringify([params.threadId, params.turnId])
      this.moderation.set(key, [...(this.moderation.get(key) ?? []), params.metadata])
      if (this.moderation.size > 64) this.moderation.delete(this.moderation.keys().next().value!)
    })
  }

  request(threadId: string, sourceTurnId: string): Promise<void> {
    const existing = this.jobs.get(threadId)
    if (existing?.turnId === sourceTurnId) return existing.promise
    this.cancel(threadId)
    const abort = new AbortController()
    const job: Job = { turnId: sourceTurnId, abort, promise: Promise.resolve() }
    this.jobs.set(threadId, job)
    job.promise = this.generate(threadId, sourceTurnId, abort.signal).then((text) => {
      if (abort.signal.aborted || this.jobs.get(threadId) !== job) return
      this.publish({
        method: 'thread/prediction/updated',
        params: {
          threadId,
          sourceTurnId,
          result: text ? { type: 'completed', text } : { type: 'skipped' }
        }
      })
    })
    return job.promise
  }

  cancel(threadId: string): void {
    this.jobs.get(threadId)?.abort.abort()
    this.jobs.delete(threadId)
  }

  isTemporaryThread(threadId: string): boolean {
    return this.temporaryThreads.has(threadId)
  }

  clear(): void {
    for (const job of this.jobs.values()) job.abort.abort()
    this.jobs.clear()
    this.config.clear()
    this.moderation.clear()
    // Keep hiding temporary-thread events until thread/closed, including during cleanup.
  }

  dispose(): void {
    this.clear()
    this.unsubscribe()
  }

  private async generate(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<string | null> {
    const configSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
    const settings = await this.config.load(configSignal)
    if (!settings || !settings.is_enabled || this.random() >= (settings.live_sample_rate ?? 1))
      return null
    const parent = await this.client.request<{
      model: string
      modelProvider: string
      collaborationMode?: { mode?: string }
    }>(
      'thread/resume',
      {
        threadId,
        history: null,
        path: null,
        model: null,
        modelProvider: null,
        cwd: null,
        approvalPolicy: null,
        sandbox: null,
        config: null,
        personality: null,
        excludeTurns: true
      },
      { signal }
    )
    signal.throwIfAborted()
    if (
      parent.collaborationMode?.mode === 'plan' ||
      parent.modelProvider !== 'openai' ||
      settings.unsupported_models?.includes(parent.model) ||
      !supports(this.client.serverVersion, [0, 162, 0, 20])
    )
      return null
    const prompt = `${settings.prompt}\n\nReturn only JSON matching this schema: ${JSON.stringify(z.toJSONSchema(resultSchema))}.`
    const metadata = {
      prediction_source_thread_id: threadId,
      prediction_source_turn_id: turnId,
      prediction_trigger: 'live'
    }
    let text: string | null
    if (settings.useThreadSample && supports(this.client.serverVersion, [0, 164, 0, 11])) {
      const response = await this.client.request<{ text: string | null }>(
        'thread/sample',
        {
          threadId,
          expectedTurnId: turnId,
          prompt,
          effort: settings.prediction_reasoning_effort,
          threadSource: 'composer_predictions',
          turnTrigger: 'composer_predictions',
          responsesapiClientMetadata: metadata,
          disableMcp: settings.disableMcp
        },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) }
      )
      signal.throwIfAborted()
      text = response.text
    } else {
      text = await this.fork(threadId, prompt, metadata, settings, signal)
    }
    if (!text) return null
    const result = resultSchema.parse(JSON.parse(text))
    if (
      suppressed(
        this.moderation.get(JSON.stringify([threadId, turnId])) ?? [],
        settings.safetyPolicy
      )
    )
      return null
    return result.suggestion || null
  }

  private async fork(
    threadId: string,
    prompt: string,
    metadata: Record<string, string>,
    settings: DesktopPredictionSettings,
    signal: AbortSignal
  ): Promise<string | null> {
    // Do not abandon a fork RPC on cancellation: its response owns the temporary ID to reclaim.
    const fork = await this.client.request<{ thread: { id: string } }>('thread/fork', {
      threadId,
      experimentalPredictionMode: true,
      ...(settings.disableMcp && supports(this.client.serverVersion, [0, 164, 0, 7])
        ? { experimentalDisablePredictionMcp: true }
        : {}),
      config: { thread_unload_delay_secs: 10 },
      ephemeral: true,
      excludeTurns: true,
      threadSource: 'composer_predictions'
    })
    const id = fork.thread.id
    this.temporaryThreads.add(id)
    try {
      signal.throwIfAborted()
      return await this.turn(id, prompt, metadata, settings.prediction_reasoning_effort, signal)
    } finally {
      await this.client
        .request('thread/unsubscribe', { threadId: id }, { requireConnection: true })
        .catch(() => {})
    }
  }

  private turn(
    threadId: string,
    prompt: string,
    metadata: Record<string, string>,
    effort: string | null,
    parentSignal: AbortSignal
  ): Promise<string | null> {
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(this.timeoutMs)])
    let turnId: string | undefined
    let text: string | null = null
    let settled = false
    const interrupt = (): void => {
      if (turnId)
        void this.client
          .request('turn/interrupt', { threadId, turnId }, { requireConnection: true })
          .catch(() => {})
    }
    return new Promise<string | null>((resolve, reject) => {
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true
        unsubscribe()
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(text)
      }
      const abort = (): void => {
        interrupt()
        finish(signal.reason)
      }
      const unsubscribe = this.client.onNotification(({ method, params: value }) => {
        const params = value as
          | {
              threadId?: string
              turnId?: string
              delta?: string
              turn?: { id: string; status?: string }
              item?: { type?: string; text?: string }
            }
          | undefined
        if (params?.threadId !== threadId) return
        if (params.turnId && turnId && params.turnId !== turnId) return
        if (method === 'turn/started') turnId = params.turn?.id
        if (method === 'item/agentMessage/delta') text = `${text ?? ''}${params.delta ?? ''}`
        if (method === 'item/completed' && params.item?.type === 'agentMessage')
          text = params.item.text ?? null
        if (method === 'turn/completed' && (!turnId || params.turn?.id === turnId))
          finish(
            params.turn?.status === 'completed' ? undefined : new Error('Prediction turn failed')
          )
      })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) return abort()
      void this.client
        .request<{ turn: { id: string } }>('turn/start', {
          threadId,
          turnTrigger: 'composer_predictions',
          responsesapiClientMetadata: metadata,
          clientUserMessageId: randomUUID(),
          input: [{ type: 'text', text: prompt, text_elements: [] }],
          effort,
          outputSchema: null
        })
        .then(
          (response) => {
            turnId = response.turn.id
            if (signal.aborted) interrupt()
          },
          (error) => finish(error)
        )
    })
  }
}
