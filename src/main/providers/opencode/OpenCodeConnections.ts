import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import type {
  ProviderConnection,
  ProviderConnectInput,
  ProviderConnectionAttempt,
  ProviderConnectionAttemptStatus,
  ProviderConnectionStatus
} from '../../../shared/providerConnections'
import type { OpenCodeCredentialTypes } from './OpenCodeConnectionStorage'
import { getOpenCodeV2Client } from './OpenCodeV2Client.ts'
import type { OpenCodeClient, FormField } from '@opencode/client'

const v2Attempts = new WeakMap<OpencodeClient, Map<string, string>>()
const v2Integration = async (native: OpenCodeClient, providerID: string): Promise<string> =>
  (await native.provider.get({ providerID })).data.integrationID ?? providerID
const promptsFromFields = (fields?: readonly FormField[]) =>
  fields?.flatMap((field) =>
    field.type === 'string'
      ? [
          {
            key: field.key,
            type: field.options ? ('select' as const) : ('text' as const),
            message: field.title ?? field.description ?? field.key,
            placeholder: field.placeholder,
            options: field.options?.map((option) => ({
              label: option.label ?? String(option.value),
              value: String(option.value)
            }))
          }
        ]
      : []
  )

// SDK failures can contain request bodies. Keep keys, prompt inputs, and codes out of IPC/logs.
const request = async <T>(action: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch {
    throw new Error(`Unable to ${action}. Check that OpenCode is up to date and try again.`)
  }
}

export const listOpenCodeConnections = async (
  client: OpencodeClient,
  _readCredentials: () => Promise<OpenCodeCredentialTypes>,
  getStatus: (providerId: string) => ProviderConnectionStatus | undefined = () => undefined
): Promise<ProviderConnection[]> => {
  const native = getOpenCodeV2Client(client)
  if (native)
    return request('load connections', async () => {
      const [providers, integrations] = await Promise.all([
        native.provider.list(),
        native.integration.list()
      ])
      return providers.data
        .map((provider): ProviderConnection => {
          const integration = integrations.data.find(
            (item) => item.id === (provider.integrationID ?? provider.id)
          )
          return {
            id: provider.id,
            name: provider.name,
            methods: integration?.methods.flatMap<ProviderConnection['methods'][number]>(
              (method) =>
                method.type === 'key'
                  ? [
                      {
                        type: 'key' as const,
                        label: method.label,
                        prompts: promptsFromFields(method.form)
                      }
                    ]
                  : method.type === 'oauth'
                    ? [
                        {
                          type: 'oauth' as const,
                          id: method.id,
                          label: method.label,
                          prompts: promptsFromFields(method.form)
                        }
                      ]
                    : []
            ) ?? [{ type: 'key', label: 'API key' }],
            connections: (integration?.connections ?? []).map((connection) => ({
              ...(connection.type === 'env'
                ? { type: 'env' as const, name: connection.name }
                : { type: 'credential' as const, id: connection.id, label: connection.label }),
              ...(getStatus(provider.id) ? { status: getStatus(provider.id) } : {})
            }))
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    })
  throw new Error('OpenCode 2 client is unavailable.')
}

export const connectOpenCode = async (
  client: OpencodeClient,
  input: ProviderConnectInput
): Promise<ProviderConnectionAttempt | null> => {
  const native = getOpenCodeV2Client(client)
  if (native)
    return request('connect the provider', async () => {
      const integrationID = await v2Integration(native, input.integrationId)
      if (input.method === 'key') {
        await native.integration.connect.key({
          integrationID,
          key: input.key!,
          answer: input.inputs
        })
        return null
      }
      const result = (
        await native.integration.oauth.connect({
          integrationID,
          methodID: input.methodId!,
          answer: input.inputs
        })
      ).data
      let attempts = v2Attempts.get(client)
      if (!attempts) {
        attempts = new Map()
        v2Attempts.set(client, attempts)
      }
      attempts.set(result.attemptID, integrationID)
      return {
        attemptId: result.attemptID,
        url: result.url,
        instructions: result.instructions,
        mode: result.mode
      }
    })
  throw new Error('OpenCode 2 client is unavailable.')
}

export const getOpenCodeConnectionAttempt = async (
  client: OpencodeClient,
  attemptId: string
): Promise<ProviderConnectionAttemptStatus> => {
  const native = getOpenCodeV2Client(client)
  if (native) {
    const integrationID = v2Attempts.get(client)?.get(attemptId)
    if (!integrationID) return { status: 'expired' }
    const status = await request('check authorization', () =>
      native.integration.oauth.status({ integrationID, attemptID: attemptId })
    )
    return status.data
  }
  return { status: 'expired' }
}
export const completeOpenCodeConnection = async (
  client: OpencodeClient,
  attemptId: string,
  code: string
): Promise<void> => {
  const native = getOpenCodeV2Client(client)
  if (native) {
    const integrationID = v2Attempts.get(client)?.get(attemptId)
    if (!integrationID) throw new Error('Authorization expired. Connect again to retry.')
    await request('complete authorization', () =>
      native.integration.oauth.complete({ integrationID, attemptID: attemptId, code })
    )
    return
  }
  throw new Error('OpenCode 2 client is unavailable.')
}
export const cancelOpenCodeConnection = async (
  client: OpencodeClient,
  attemptId: string
): Promise<void> => {
  const native = getOpenCodeV2Client(client)
  if (native) {
    const integrationID = v2Attempts.get(client)?.get(attemptId)
    if (integrationID)
      await request('cancel authorization', () =>
        native.integration.oauth.cancel({ integrationID, attemptID: attemptId })
      )
    v2Attempts.get(client)?.delete(attemptId)
    return
  }
}
export const deleteOpenCodeConnection = async (
  client: OpencodeClient,
  credentialId: string
): Promise<void> => {
  const native = getOpenCodeV2Client(client)
  if (native) {
    await request('remove the connection', () =>
      native.credential.remove({ credentialID: credentialId })
    )
    return
  }
  throw new Error('OpenCode 2 client is unavailable.')
}
