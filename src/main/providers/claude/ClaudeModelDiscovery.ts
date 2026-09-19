import type { ModelInfo, Query } from '@anthropic-ai/claude-agent-sdk'

type ClaudeModelQuery = Pick<Query, 'reinitialize' | 'supportedModels'>

/** Reinitialization returns the fresh catalog; supportedModels() remains tied to the first one. */
export const discoverClaudeModels = async (
  control: ClaudeModelQuery,
  refresh: boolean
): Promise<ModelInfo[]> =>
  refresh ? (await control.reinitialize()).models : await control.supportedModels()
