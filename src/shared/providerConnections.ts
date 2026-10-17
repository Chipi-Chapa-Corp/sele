export type ProviderConnectionPrompt = {
  type: 'text' | 'select'
  key: string
  message: string
  placeholder?: string
  options?: { label: string; value: string; hint?: string }[]
  when?: { key: string; op: 'eq' | 'neq'; value: string }
}

export type ProviderConnectionMethod =
  | { type: 'key'; label?: string; prompts?: ProviderConnectionPrompt[] }
  | { type: 'oauth'; id: string; label: string; prompts?: ProviderConnectionPrompt[] }

export type ProviderConnection = {
  id: string
  name: string
  methods: ProviderConnectionMethod[]
  connections: ({ type: 'credential'; id: string; label: string } | { type: 'env'; name: string })[]
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
