import { randomUUID } from 'node:crypto'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import type {
  ProviderConnection,
  ProviderConnectInput,
  ProviderConnectionAttempt,
  ProviderConnectionAttemptStatus,
  ProviderConnectionStatus
} from '../../../shared/providerConnections'
import type { OpenCodeCredentialTypes } from './OpenCodeConnectionStorage'

// SDK failures can contain request bodies. Keep keys, prompt inputs, and codes out of IPC/logs.
const request = async <T>(action: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch {
    throw new Error(`Unable to ${action}. Check that OpenCode is up to date and try again.`)
  }
}

type Attempt = {
  providerId: string
  method: number
  abort: AbortController
  status: ProviderConnectionAttemptStatus['status']
  timer: ReturnType<typeof setTimeout>
}
const attempts = new WeakMap<OpencodeClient, Map<string, Attempt>>()

export const listOpenCodeConnections = async (
  client: OpencodeClient,
  readCredentials: () => Promise<OpenCodeCredentialTypes>,
  getStatus: (providerId: string) => ProviderConnectionStatus | undefined = () => undefined
): Promise<ProviderConnection[]> => {
  const status = (id: string): { status?: ProviderConnectionStatus } => {
    const value = getStatus(id)
    return value ? { status: value } : {}
  }
  const [catalog, auth, credentials] = await Promise.all([
    request('load connections', () => client.provider.list({}, { throwOnError: true })),
    request('load connection methods', () => client.provider.auth({}, { throwOnError: true })),
    readCredentials()
  ])
  const providers = catalog.data.all.map(
    (provider): ProviderConnection => ({
      id: provider.id,
      name: provider.name,
      methods: auth.data[provider.id]?.length
        ? auth.data[provider.id].map((method, index) =>
            method.type === 'oauth'
              ? { type: 'oauth', id: String(index), label: method.label, prompts: method.prompts }
              : { type: 'key', label: method.label, prompts: method.prompts }
          )
        : [{ type: 'key', label: 'API key' }],
      connections: [
        ...(credentials[provider.id]
          ? [
              {
                type: 'credential' as const,
                id: provider.id,
                label: credentials[provider.id] === 'oauth' ? 'Signed in' : 'API key',
                ...status(provider.id)
              }
            ]
          : []),
        ...(catalog.data.connected.includes(provider.id) && provider.source === 'env'
          ? [
              {
                type: 'env' as const,
                name: provider.env.join(', '),
                ...status(provider.id)
              }
            ]
          : [])
      ]
    })
  )
  for (const id of Object.keys(credentials)) {
    if (!providers.some((provider) => provider.id === id))
      providers.push({
        id,
        name: id,
        methods: [{ type: 'key', label: 'API key' }],
        connections: [
          {
            type: 'credential',
            id,
            label: credentials[id] === 'oauth' ? 'Signed in' : 'API key',
            ...status(id)
          }
        ]
      })
  }
  return providers.sort((a, b) => a.name.localeCompare(b.name))
}

const getAttempt = (client: OpencodeClient, attemptId: string): Attempt => {
  const attempt = attempts.get(client)?.get(attemptId)
  if (!attempt) throw new Error('Authorization expired. Connect again to retry.')
  return attempt
}
const callback = async (client: OpencodeClient, attempt: Attempt, code?: string): Promise<void> => {
  try {
    await request('complete authorization', () =>
      client.provider.oauth.callback(
        {
          providerID: attempt.providerId,
          method: attempt.method,
          code
        },
        { throwOnError: true, signal: attempt.abort.signal }
      )
    )
    if (!attempt.abort.signal.aborted) {
      await request('refresh OpenCode connections', () =>
        client.instance.dispose({}, { throwOnError: true })
      )
      attempt.status = 'complete'
    }
  } catch (error) {
    if (!attempt.abort.signal.aborted) attempt.status = 'failed'
    throw error
  }
}

export const connectOpenCode = async (
  client: OpencodeClient,
  input: ProviderConnectInput
): Promise<ProviderConnectionAttempt | null> => {
  if (input.method === 'key') {
    await request('save the API key', () =>
      client.auth.set(
        {
          providerID: input.integrationId,
          auth: {
            type: 'api',
            key: input.key!,
            ...(input.inputs && Object.keys(input.inputs).length > 0
              ? { metadata: input.inputs }
              : {})
          }
        },
        { throwOnError: true }
      )
    )
    await request('refresh OpenCode connections', () =>
      client.instance.dispose({}, { throwOnError: true })
    )
    return null
  }
  const method = Number(input.methodId)
  if (!Number.isSafeInteger(method) || method < 0) throw new Error('Invalid connection method')
  const { data } = await request('start authorization', () =>
    client.provider.oauth.authorize(
      {
        providerID: input.integrationId,
        method,
        inputs: input.inputs
      },
      { throwOnError: true }
    )
  )
  if (!data) throw new Error('Unable to start authorization.')
  const attemptId = randomUUID()
  let entries = attempts.get(client)
  if (!entries) {
    entries = new Map()
    attempts.set(client, entries)
  }
  const attempt: Attempt = {
    providerId: input.integrationId,
    method,
    abort: new AbortController(),
    status: 'pending',
    timer: setTimeout(() => {
      if (attempt.status === 'pending') {
        attempt.status = 'expired'
        attempt.abort.abort()
      }
      entries.delete(attemptId)
    }, 10 * 60_000)
  }
  attempt.timer.unref()
  entries.set(attemptId, attempt)
  if (data.method === 'auto')
    void callback(client, attempt).catch((error) =>
      console.error('[OpenCodeConnections:authorize]', error)
    )
  return { attemptId, url: data.url, instructions: data.instructions, mode: data.method }
}

export const getOpenCodeConnectionAttempt = async (
  client: OpencodeClient,
  attemptId: string
): Promise<ProviderConnectionAttemptStatus> => {
  const attempt = attempts.get(client)?.get(attemptId)
  if (!attempt) return { status: 'expired' }
  const result = { status: attempt.status }
  return result
}
export const completeOpenCodeConnection = async (
  client: OpencodeClient,
  attemptId: string,
  code: string
): Promise<void> => {
  const attempt = getAttempt(client, attemptId)
  await callback(client, attempt, code)
}
export const cancelOpenCodeConnection = async (
  client: OpencodeClient,
  attemptId: string
): Promise<void> => {
  const entries = attempts.get(client)
  const attempt = entries?.get(attemptId)
  if (!attempt) return
  attempt.abort.abort()
  clearTimeout(attempt.timer)
  entries?.delete(attemptId)
}
export const deleteOpenCodeConnection = async (
  client: OpencodeClient,
  credentialId: string
): Promise<void> => {
  await request('remove the connection', () =>
    client.auth.remove({ providerID: credentialId }, { throwOnError: true })
  )
  await request('refresh OpenCode connections', () =>
    client.instance.dispose({}, { throwOnError: true })
  )
}
