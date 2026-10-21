export type ProviderConnectionPrompt = {
  type: 'text' | 'select'
  key: string
  message: string
  placeholder?: string
  options?: { label: string; value: string; hint?: string }[]
  when?: { key: string; op: 'eq' | 'neq'; value: string }
}

export type ProviderConnectionMethod =
  | { type: 'key'; id?: string; label?: string; prompts?: ProviderConnectionPrompt[] }
  | { type: 'oauth'; id: string; label: string; prompts?: ProviderConnectionPrompt[] }

export type ProviderConnection = {
  id: string
  name: string
  methods: ProviderConnectionMethod[]
  connections: (
    | {
        type: 'credential'
        id: string
        label: string
        status?: ProviderConnectionStatus
        /** Admin/management key Sele uses only to read balances; it never serves models. */
        usageOnly?: boolean
      }
    | { type: 'env'; name: string; status?: ProviderConnectionStatus }
  )[]
}

export const connectionServesModels = (
  connection: ProviderConnection['connections'][number]
): boolean => connection.type === 'env' || !connection.usageOnly

/** Result of the last real request or connection check that used this credential. */
export type ProviderConnectionStatus =
  | { state: 'verified'; checkedAt: number }
  | { state: 'failed'; message: string; checkedAt: number }
  | { state: 'unverified'; message: string; checkedAt: number }

export const openCodeConnectionsNeedCheck = (
  providers: ProviderConnection[],
  now = Date.now()
): boolean =>
  providers.some((entry) =>
    entry.connections.some(
      (connection) => !connection.status || now - connection.status.checkedAt > 15 * 60_000
    )
  )

export const getOpenCodeConnectionFailure = (
  providers: ProviderConnection[],
  model: string
): { name: string; message: string } | null => {
  const separator = model.indexOf('/')
  if (separator < 1) return null
  const providerId = model.slice(0, separator)
  const provider = providers.find((entry) => entry.id === providerId)
  // OpenCode can also serve models without a saved credential. Do not block those models,
  // or a working provider merely because another provider's key has expired.
  const connections = provider?.connections.filter(connectionServesModels) ?? []
  if (!provider || !connections.length) return null
  const statuses = connections.map((connection) => connection.status)
  if (!statuses.every((status) => status?.state === 'failed')) return null
  const failed = statuses.find((status) => status?.state === 'failed')
  return failed?.state === 'failed' ? { name: provider.name, message: failed.message } : null
}

export type ProviderConnectInput = {
  integrationId: string
  method: 'key' | 'oauth'
  methodId?: string
  key?: string
  inputs?: Record<string, string>
}

export type ProviderConnectionAttempt = {
  attemptId: string
  url: string
  instructions: string
  mode: 'auto' | 'code'
}

export type ProviderConnectionAttemptStatus = {
  status: 'pending' | 'complete' | 'failed' | 'expired'
  message?: string
}

export const isConnectionPromptVisible = (
  prompt: ProviderConnectionPrompt,
  inputs: Record<string, string>
): boolean => {
  if (!prompt.when) return true
  const matches = inputs[prompt.when.key] === prompt.when.value
  return prompt.when.op === 'eq' ? matches : !matches
}
