import type { Message, OpencodeClient, Provider, Session } from '@opencode-ai/sdk/v2'
import { parseOpenCodeModelId } from './OpenCodeModels.ts'

export const isDefaultOpenCodeTitle = (title: string): boolean =>
  /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(title)

export const selectOpenCodeTitleModels = (
  providers: Provider[],
  connected: string[],
  configuredModel: string | undefined,
  chatModel: string | undefined
): string[] => {
  const available = providers
    .filter((provider) => connected.includes(provider.id))
    .flatMap((provider) =>
      Object.values(provider.models)
        .filter(
          (model) =>
            model.status !== 'deprecated' &&
            model.capabilities.input.text &&
            model.capabilities.output.text
        )
        .map((model) => ({ id: `${provider.id}/${model.id}`, model }))
    )
  const ids = new Set(available.map(({ id }) => id))
  // A catalog entry alone does not establish billing access. Only try paid models
  // that the user selected; discover free alternatives without hardcoded names.
  const free = available.filter(
    ({ model }) =>
      model.cost.input === 0 &&
      model.cost.output === 0 &&
      model.cost.cache.read === 0 &&
      model.cost.cache.write === 0 &&
      (model.cost.tiers ?? []).every(
        (tier) =>
          tier.input === 0 && tier.output === 0 && tier.cache.read === 0 && tier.cache.write === 0
      )
  )
  return [...new Set([configuredModel, chatModel, ...free.map(({ id }) => id)])]
    .filter((id): id is string => Boolean(id && ids.has(id)))
    .slice(0, 3)
}

const normalizeTitle = (text: string): string | null => {
  const title = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
    .replace(/^title:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
  return title ? (title.length <= 100 ? title : `${title.slice(0, 97).trimEnd()}...`) : null
}

export const generateOpenCodeChatTitle = async (
  client: OpencodeClient,
  directory: string,
  prompt: string,
  models: string[],
  isCurrent: () => boolean,
  reportUsage: (session: Session, message: Message) => void
): Promise<string | null> => {
  for (const modelId of models) {
    if (!isCurrent()) return null
    let session: Session | undefined
    const request = { throwOnError: true as const, signal: AbortSignal.timeout(30_000) }
    try {
      session = (
        await client.session.create(
          {
            directory,
            title: 'Sele one-shot',
            metadata: { sele: { purpose: 'oneShot' } },
            permission: [{ permission: '*', pattern: '*', action: 'deny' }]
          },
          request
        )
      ).data
      if (!isCurrent()) return null
      const result = (
        await client.session.prompt(
          {
            sessionID: session.id,
            directory,
            agent: 'build',
            model: parseOpenCodeModelId(modelId),
            system:
              'Generate only a concise plain-text chat title, at most 100 characters. Do not answer the prompt or use tools.',
            parts: [{ type: 'text', text: `Name this conversation:\n${prompt.slice(0, 2000)}` }]
          },
          request
        )
      ).data
      reportUsage(session, result.info)
      if (result.info.error) throw new Error('OpenCode title model returned an error')
      const title = normalizeTitle(
        result.parts
          .flatMap((part) =>
            part.type === 'text' && !part.synthetic && !part.ignored ? [part.text] : []
          )
          .join('\n')
      )
      if (title) return title
      throw new Error('OpenCode title model returned no title')
    } catch (error) {
      console.error(`[OpenCodeChatTitle] Title generation failed with ${modelId}`, error)
    } finally {
      if (session) {
        const parameters = { sessionID: session.id, directory }
        // Aborting the HTTP request alone does not stop the server's generation.
        await client.session
          .abort(parameters, {
            throwOnError: true,
            signal: AbortSignal.timeout(5000)
          })
          .catch((error) =>
            console.error('[OpenCodeChatTitle] Unable to stop title session', error)
          )
        await client.session
          .delete(parameters, {
            throwOnError: true,
            signal: AbortSignal.timeout(5000)
          })
          .catch((error) =>
            console.error('[OpenCodeChatTitle] Unable to remove title session', error)
          )
      }
    }
  }
  return null
}
