import {
  OpenCode,
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessageInfo,
  type ModelInfo,
  type FormField,
  type PermissionRuleset as V2Permissions
} from '@opencode/client'
import type { OpencodeClient, Session, PermissionRuleset, Part, Message } from '@opencode-ai/sdk/v2'
import type { OpenCodeMessageWithParts } from './OpenCodeItemRenderers'

// Keep Sele's transcript projection independent of the native v2 wire format.
const nativeClients = new WeakMap<OpencodeClient, OpenCodeClient>()
export const getOpenCodeV2Client = (client: OpencodeClient): OpenCodeClient | undefined =>
  nativeClients.get(client)
type ChatPreview = { messages: OpenCodeMessageWithParts[]; hasOlder: boolean }
const previews = new WeakMap<
  OpencodeClient,
  Map<string, { updatedAt: number; read: Promise<ChatPreview> }>
>()

/** Sidebar discovery needs a prompt preview, never full assistant/tool bodies. */
export const readOpenCodeChatPreview = async (
  client: OpencodeClient,
  session: Pick<Session, 'id' | 'directory' | 'time'>
): Promise<ChatPreview> => {
  const native = nativeClients.get(client)
  if (!native) {
    const result = await client.session.messages(
      { sessionID: session.id, directory: session.directory, limit: 8 },
      { throwOnError: true }
    )
    return {
      messages: result.data,
      hasOlder: Boolean(result.response.headers.get('x-next-cursor'))
    }
  }
  let cached = previews.get(client)
  if (!cached) previews.set(client, (cached = new Map()))
  const previous = cached.get(session.id)
  if (previous?.updatedAt === session.time.updated) return previous.read
  const read = native.message
    .list({ sessionID: session.id, type: 'user', limit: 1, order: 'desc' })
    .then((page) => ({
      messages: page.data.flatMap((message) => {
        const converted = fromOpenCodeV2Message(message, session as unknown as SessionInfo)
        return converted ? [converted] : []
      }),
      hasOlder: Boolean(page.cursor.next)
    }))
  const entry = { updatedAt: session.time.updated, read }
  cached.set(session.id, entry)
  while (cached.size > 1000) cached.delete(cached.keys().next().value!)
  try {
    return await read
  } catch (error) {
    if (cached.get(session.id) === entry) cached.delete(session.id)
    throw error
  }
}
const zeroTokens = () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })
const nativeTool = (name: string): string => ({ shell: 'bash', subagent: 'task' })[name] ?? name
const nativeAction = (name: string): string =>
  ({ bash: 'shell', task: 'subagent', write: 'edit', patch: 'edit' })[name] ?? name
export const toOpenCodeV2Permissions = (rules: PermissionRuleset = []): V2Permissions =>
  rules.map((rule) => ({
    action: nativeAction(rule.permission),
    resource: rule.pattern,
    effect: rule.action
  }))
const errorInfo = (error: unknown) => {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : null
  const response =
    value?.response && typeof value.response === 'object'
      ? (value.response as Record<string, unknown>)
      : null
  return {
    name: value?.type === 'aborted' ? 'MessageAbortedError' : 'APIError',
    ...(typeof value?.type === 'string' ? { type: value.type } : {}),
    ...(typeof value?.retryAfterMs === 'number' ? { retryAfterMs: value.retryAfterMs } : {}),
    data: {
      message: value && 'message' in value ? String(value.message) : String(error),
      ...(typeof value?.status === 'number'
        ? { statusCode: value.status, isRetryable: value.status === 429 || value.status >= 500 }
        : {}),
      ...(typeof response?.body === 'string' ? { responseBody: response.body } : {})
    }
  }
}
const partId = (messageId: string, index: number) =>
  `${messageId}:${String(index).padStart(8, '0')}`

export const fromOpenCodeV2Session = (session: SessionInfo): Session =>
  ({
    ...session,
    title: session.title ?? 'New session',
    directory: session.location.directory,
    slug: session.id,
    version: '2',
    projectID: session.projectID,
    permission: session.permissions?.map((rule) => ({
      permission:
        rule.action === 'shell' ? 'bash' : rule.action === 'subagent' ? 'task' : rule.action,
      pattern: rule.resource,
      action: rule.effect
    }))
  }) as unknown as Session

export const fromOpenCodeV2Message = (
  message: SessionMessageInfo,
  session: SessionInfo,
  parentID = ''
): OpenCodeMessageWithParts | null => {
  const imported = message.metadata?.seleImport
  if (
    message.type === 'synthetic' &&
    imported &&
    typeof imported === 'object' &&
    !Array.isArray(imported) &&
    typeof imported.content === 'string'
  ) {
    if (imported.role === 'assistant')
      return fromOpenCodeV2Message(
        {
          id: message.id,
          type: 'assistant',
          time: { ...message.time, completed: message.time.created },
          agent: session.agent ?? 'build',
          model: session.model ?? { providerID: '', id: '' },
          content: [{ type: 'text', text: imported.content }],
          finish: 'stop',
          cost: 0,
          tokens: zeroTokens()
        },
        session,
        parentID
      )
    if (imported.role === 'user')
      return fromOpenCodeV2Message(
        { id: message.id, type: 'user', time: message.time, text: imported.content },
        session,
        parentID
      )
  }
  if (
    message.type !== 'assistant' &&
    message.type !== 'user' &&
    message.type !== 'synthetic' &&
    message.type !== 'compaction'
  )
    return null
  if (message.type === 'user' || message.type === 'synthetic') {
    return {
      info: {
        id: message.id,
        sessionID: session.id,
        role: 'user',
        agent: session.agent ?? 'build',
        time: message.time,
        model: { providerID: session.model?.providerID ?? '', modelID: session.model?.id ?? '' }
      },
      parts: [
        {
          id: partId(message.id, 0),
          sessionID: session.id,
          messageID: message.id,
          type: 'text',
          text: message.text,
          ...(message.type === 'synthetic' ? { synthetic: true } : {})
        },
        ...(message.type === 'user' ? (message.files ?? []) : []).map((file, index) => ({
          id: partId(message.id, index + 1),
          sessionID: session.id,
          messageID: message.id,
          type: 'file' as const,
          mime: 'mime' in file ? String(file.mime) : 'application/octet-stream',
          filename: 'name' in file ? String(file.name) : undefined,
          url: 'uri' in file ? String(file.uri) : 'path' in file ? String(file.path) : ''
        }))
      ]
    }
  }
  if (message.type === 'compaction') {
    const selected = 'model' in message ? (message.model ?? session.model) : session.model
    return {
      info: {
        id: message.id,
        sessionID: session.id,
        role: 'assistant',
        parentID,
        summary: true,
        agent: 'compaction',
        mode: 'compaction',
        providerID: selected?.providerID ?? '',
        modelID: selected?.id ?? '',
        path: { cwd: session.location.directory, root: session.location.directory },
        time: {
          ...message.time,
          ...(message.status !== 'running' ? { completed: message.time.created } : {})
        },
        tokens: 'tokens' in message ? (message.tokens ?? zeroTokens()) : zeroTokens(),
        cost: 'cost' in message ? (message.cost ?? 0) : 0
      } as Message,
      parts: [
        {
          id: partId(message.id, 0),
          sessionID: session.id,
          messageID: message.id,
          type: 'compaction',
          auto: message.reason === 'auto'
        }
      ]
    }
  }
  const info = {
    id: message.id,
    sessionID: session.id,
    role: 'assistant',
    parentID,
    time: message.time,
    agent: message.agent,
    mode: message.agent,
    providerID: message.model.providerID,
    modelID: message.model.id,
    path: { cwd: session.location.directory, root: session.location.directory },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? zeroTokens(),
    finish: message.finish,
    ...(message.error ? { error: errorInfo(message.error) } : {})
  } as Message
  const parts = message.content.map((content, index): Part => {
    const base = { id: partId(message.id, index), sessionID: session.id, messageID: message.id }
    if (content.type !== 'tool')
      return {
        ...base,
        type: content.type,
        text: content.text,
        ...(content.type === 'reasoning'
          ? {
              time: {
                start: content.time?.created ?? message.time.created,
                end: content.time?.completed
              }
            }
          : {})
      } as Part
    const state = content.state
    const common = {
      ...base,
      type: 'tool' as const,
      callID: content.id,
      tool: nativeTool(content.name)
    }
    if (state.status === 'streaming')
      return { ...common, state: { status: 'pending', input: {}, raw: '' } }
    const input = state.input
    const time = {
      start: content.time.ran ?? content.time.created,
      end: content.time.completed ?? message.time.completed ?? message.time.created
    }
    if (state.status === 'running')
      return {
        ...common,
        state: { status: 'running', input, metadata: state.metadata, time: { start: time.start } }
      }
    const output = (state.content ?? [])
      .flatMap((item) => (item.type === 'text' ? [item.text] : []))
      .join('\n')
    if (state.status === 'error')
      return {
        ...common,
        state: {
          status: 'error',
          input,
          error: state.error.message,
          metadata: state.metadata,
          time
        }
      }
    return {
      ...common,
      state: {
        status: 'completed',
        input,
        output,
        title: typeof state.metadata?.title === 'string' ? state.metadata.title : content.name,
        metadata: state.metadata ?? {},
        time,
        attachments: state.content.flatMap((item, fileIndex) =>
          item.type === 'file'
            ? [
                {
                  id: `${base.id}:file:${fileIndex}`,
                  sessionID: session.id,
                  messageID: message.id,
                  type: 'file' as const,
                  mime: item.mime,
                  url: item.uri,
                  filename: item.name ?? undefined
                }
              ]
            : []
        )
      }
    }
  })
  return { info, parts }
}

type Params = {
  sessionID?: string
  directory?: string
  messageID?: string
  requestID?: string
  title?: string
  agent?: string
  model?: { providerID: string; modelID?: string; id?: string; variant?: string }
  variant?: string
  permission?: PermissionRuleset
  metadata?: SessionInfo['metadata']
  system?: string
  parts?: Array<{ type: string; text?: string; mime?: string; filename?: string; url?: string }>
  limit?: number
  cursor?: number
  before?: string
  roots?: boolean
  parentID?: string
  reply?: 'once' | 'always' | 'reject'
  answers?: string[][]
  auto?: boolean
}
type RequestOptions = { signal?: AbortSignal }
type LegacyEvent = {
  directory: string
  payload: { type: string; properties: Record<string, unknown> }
}

export const createOpenCodeV2Client = (options: {
  baseUrl: string
  headers?: HeadersInit
  fetch?: typeof fetch
}): OpencodeClient => {
  const native = OpenCode.make(options)
  const sessions = new Map<string, SessionInfo>()
  const lastUsers = new Map<string, { id: string; created: number }>()
  const messages = new Map<string, OpenCodeMessageWithParts>()
  const nativeExecutions = new Set<string>()
  const cursors = new Map<string, Map<number, string | undefined>>()
  const interactions = new Map<string, { sessionID: string; fields?: FormField[] }>()
  const result = <T>(data: T, cursor?: string | null) => ({
    data,
    response: new Response(null, { headers: cursor ? { 'x-next-cursor': cursor } : {} }),
    request: new Request(options.baseUrl)
  })
  const remember = (session: SessionInfo) => {
    sessions.set(session.id, session)
    return session
  }
  const getSession = async (id: string, request?: RequestOptions): Promise<SessionInfo> =>
    sessions.get(id) ?? remember(await native.session.get({ sessionID: id }, request))
  const id = (p: Params): string => {
    if (!p.sessionID) throw new Error('Missing OpenCode session')
    return p.sessionID
  }
  const location = (p: Params) => (p.directory ? { directory: p.directory } : undefined)
  const convert = (message: SessionMessageInfo, session: SessionInfo, parentID?: string) => {
    const imported = message.metadata?.seleImport
    if (
      (message.type === 'user' ||
        (message.type === 'synthetic' &&
          imported &&
          typeof imported === 'object' &&
          !Array.isArray(imported) &&
          imported.role === 'user')) &&
      message.time.created >= (lastUsers.get(session.id)?.created ?? 0)
    )
      lastUsers.set(session.id, { id: message.id, created: message.time.created })
    const parent = lastUsers.get(session.id)
    return fromOpenCodeV2Message(
      message,
      session,
      parentID ?? (parent && parent.created <= message.time.created ? parent.id : message.id)
    )
  }
  const model = (p: Params) =>
    p.model
      ? {
          providerID: p.model.providerID,
          id: p.model.modelID ?? p.model.id ?? '',
          ...((p.variant ?? p.model.variant) ? { variant: p.variant ?? p.model.variant } : {})
        }
      : undefined
  const prepare = async (p: Params, request?: RequestOptions) => {
    if (p.model) await native.session.switchModel({ sessionID: id(p), model: model(p)! }, request)
    if (p.agent) await native.session.switchAgent({ sessionID: id(p), agent: p.agent }, request)
  }
  const prompt = async (p: Params, request?: RequestOptions) => {
    await prepare(p, request)
    if (p.system)
      await native.session.instructions.entry.put(
        { sessionID: id(p), key: 'sele.system', value: p.system },
        request
      )
    else
      await native.session.instructions.entry.remove(
        { sessionID: id(p), key: 'sele.system' },
        request
      )
    const text = (p.parts ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n\n')
    return native.session.prompt(
      {
        sessionID: id(p),
        text,
        files: (p.parts ?? []).flatMap((part) =>
          part.type === 'file' && part.url
            ? [
                {
                  type: 'media' as const,
                  uri: part.url,
                  mime: part.mime ?? 'application/octet-stream',
                  ...(part.filename ? { name: part.filename } : {})
                }
              ]
            : []
        )
      },
      request
    )
  }
  const readMessages = async (p: Params, request?: RequestOptions) => {
    const session = await getSession(id(p), request)
    const limit = p.limit ?? 100
    const pages: SessionMessageInfo[][] = []
    const seen = new Set<string>()
    let cursor = p.before
    let count = 0
    do {
      const page = await native.message.list(
        { sessionID: id(p), limit, ...(cursor ? { cursor } : { order: 'desc' as const }) },
        request
      )
      pages.unshift(page.data.reverse())
      count += page.data.filter(
        (message) =>
          message.type === 'user' ||
          message.type === 'synthetic' ||
          (message.type === 'assistant' &&
            (Boolean(message.error) ||
              message.content.some((content) => content.type === 'tool' || content.text.trim())))
      ).length
      const next = page.cursor.next ?? undefined
      if (next && (next === cursor || seen.has(next)))
        throw new Error('OpenCode history pagination did not advance.')
      if (next) seen.add(next)
      cursor = next
    } while (count < limit && cursor)
    // Native pages include structural records. Fill the requested visible-message budget.
    let parentID: string | undefined
    const raw = pages.flat()
    if (!p.before) {
      const pending = await native.session.inbox.list({ sessionID: id(p) }, request)
      const ids = new Set(raw.map((message) => message.id))
      for (const item of pending)
        if (item.type === 'synthetic' && item.payload.metadata?.seleImport && !ids.has(item.id))
          raw.push({
            id: item.id,
            type: 'synthetic',
            time: item.time,
            text: item.payload.text,
            metadata: item.payload.metadata
          })
    }
    const data = raw.flatMap((message) => {
      if (message.type === 'user') parentID = message.id
      const record = convert(message, session, parentID)
      return record ? [record] : []
    })
    return result(data, cursor)
  }
  const permission = (request: import('@opencode/client').PermissionRequest) => {
    interactions.set(request.id, { sessionID: request.sessionID })
    return {
      ...request,
      permission: nativeTool(request.action),
      patterns: request.resources,
      always: request.save ?? request.resources,
      metadata: {
        ...request.metadata,
        ...(request.message ? { description: request.message } : {})
      }
    }
  }
  const question = (form: import('@opencode/client').FormInfo) => {
    interactions.set(form.id, { sessionID: form.sessionID, fields: form.fields })
    return {
      id: form.id,
      sessionID: form.sessionID,
      questions: form.fields.map((field) => ({
        header: form.title,
        question: field.title ?? field.description ?? form.title,
        options:
          'options' in field
            ? (field.options?.map((option) => ({
                label: option.label ?? String(option.value),
                description: ''
              })) ?? [])
            : [],
        multiple: field.type === 'multiselect',
        custom: 'custom' in field ? field.custom : true
      }))
    }
  }
  const catalog = async (p: Params = {}, request?: RequestOptions) => {
    const [providers, models, defaultModel, integrations] = await Promise.all([
      native.provider.list({ location: location(p) }, request),
      native.model.list({ location: location(p) }, request),
      native.model.default({ location: location(p) }, request),
      native.integration.list({ location: location(p) }, request)
    ])
    const all = providers.data.map((provider) => ({
      ...provider,
      source: integrations.data
        .find((item) => item.id === provider.integrationID)
        ?.connections.some((connection) => connection.type === 'env')
        ? 'env'
        : 'api',
      env: [],
      options: {},
      models: Object.fromEntries(
        models.data
          .filter((entry) => entry.providerID === provider.id && entry.enabled)
          .map((entry: ModelInfo) => [
            entry.id,
            {
              ...entry,
              capabilities: {
                temperature: entry.capabilities.temperature ?? false,
                toolcall: entry.capabilities.tools,
                attachment: entry.capabilities.input.some((type) => type !== 'text'),
                input: Object.fromEntries(entry.capabilities.input.map((type) => [type, true])),
                output: Object.fromEntries(entry.capabilities.output.map((type) => [type, true]))
              },
              cost: {
                ...(entry.cost.find((cost) => !cost.tier) ??
                  entry.cost[0] ?? { input: 0, output: 0, cache: { read: 0, write: 0 } }),
                tiers: entry.cost.filter((cost) => cost.tier)
              },
              variants: Object.fromEntries(
                entry.variants.map((variant) => [variant.id, variant.settings ?? {}])
              )
            }
          ])
      )
    }))
    const defaults = defaultModel.data
      ? { [defaultModel.data.providerID]: defaultModel.data.id }
      : {}
    return {
      all,
      providers: all,
      default: defaults,
      connected: providers.data
        .filter(
          (provider) =>
            provider.activation !== 'disabled' &&
            (integrations.data.find((item) => item.id === provider.integrationID)?.connections
              .length ||
              models.data.some((entry) => entry.providerID === provider.id && entry.enabled))
        )
        .map((provider) => provider.id)
    }
  }
  async function* eventStream(request?: RequestOptions): AsyncGenerator<LegacyEvent> {
    const stream = native.event.subscribe({ signal: request?.signal })
    for await (const event of stream) {
      if (!('data' in event)) continue
      const data = event.data as unknown as Record<string, unknown>
      const sessionID =
        typeof data.sessionID === 'string'
          ? data.sessionID
          : 'form' in data && data.form && typeof data.form === 'object' && 'sessionID' in data.form
            ? String(data.form.sessionID)
            : null
      if (!sessionID) continue
      const session = await getSession(sessionID, request).catch(() => undefined)
      if (!session) continue
      const emit = (type: string, properties: Record<string, unknown>): LegacyEvent => ({
        directory: session.location.directory,
        payload: { type, properties: { sessionID, ...properties } }
      })
      if (event.type === 'session.step.started') {
        const d = event.data
        const record = fromOpenCodeV2Message(
          {
            id: d.assistantMessageID,
            type: 'assistant',
            time: { created: d.started },
            agent: d.agent,
            model: d.model,
            content: []
          },
          session,
          lastUsers.get(sessionID)?.id
        )!
        messages.set(d.assistantMessageID, record)
        yield emit('message.updated', { info: record.info })
      } else if (
        event.type === 'session.text.started' ||
        event.type === 'session.reasoning.started' ||
        event.type === 'session.text.delta' ||
        event.type === 'session.reasoning.delta' ||
        event.type === 'session.text.ended' ||
        event.type === 'session.reasoning.ended'
      ) {
        const d = event.data
        let record = messages.get(d.assistantMessageID)
        if (!record) {
          const current = await native.session.message.get(
            { sessionID, messageID: d.assistantMessageID },
            request
          )
          record = convert(current, session) ?? undefined
          if (!record) continue
          messages.set(d.assistantMessageID, record)
          yield emit('message.updated', { info: record.info })
          for (const part of record.parts) yield emit('message.part.updated', { part })
          // A fetched snapshot may already include this delta. Reconcile at the next end event.
          if (event.type.endsWith('.delta')) continue
        }
        const previous = record.parts[d.ordinal]
        const text =
          'text' in d
            ? d.text
            : 'delta' in d
              ? (previous && 'text' in previous ? previous.text : '') + d.delta
              : ''
        const part = {
          id: partId(d.assistantMessageID, d.ordinal),
          sessionID,
          messageID: d.assistantMessageID,
          type: event.type.startsWith('session.reasoning')
            ? ('reasoning' as const)
            : ('text' as const),
          text
        }
        record.parts[d.ordinal] = part as Part
        yield emit('message.part.updated', { part: { ...part } })
      } else if (event.type.startsWith('session.tool.')) {
        const messageID = String(data.assistantMessageID)
        const record = messages.get(messageID)
        if (!record) continue
        const callID = String(data.id)
        let index = record.parts.findIndex((part) => part.type === 'tool' && part.callID === callID)
        if (index < 0) index = record.parts.length
        const previous = record.parts[index]
        const tool =
          previous?.type === 'tool' ? previous.tool : nativeTool(String(data.name ?? 'tool'))
        const input =
          typeof data.input === 'object' && data.input
            ? data.input
            : previous?.type === 'tool'
              ? previous.state.input
              : {}
        const metadata =
          data.metadata ??
          (previous?.type === 'tool' && 'metadata' in previous.state ? previous.state.metadata : {})
        const content = Array.isArray(data.content)
          ? (data.content as Array<{ type: string; text?: string; uri?: string; mime?: string }>)
          : []
        const output = content
          .filter((item) => item.type === 'text')
          .map((item) => item.text ?? '')
          .join('\n')
        const state =
          event.type === 'session.tool.success'
            ? {
                status: 'completed',
                input,
                metadata,
                title: tool,
                output,
                time: {
                  start: 'created' in event ? event.created : Date.now(),
                  end: 'created' in event ? event.created : Date.now()
                },
                attachments: content.flatMap((item, fileIndex) =>
                  item.type === 'file'
                    ? [
                        {
                          type: 'file',
                          id: `${partId(messageID, index)}:file:${fileIndex}`,
                          sessionID,
                          messageID,
                          mime: item.mime,
                          url: item.uri
                        }
                      ]
                    : []
                )
              }
            : event.type === 'session.tool.failed'
              ? {
                  status: 'error',
                  input,
                  metadata,
                  error: errorInfo(data.error).data.message,
                  time: {
                    start: 'created' in event ? event.created : Date.now(),
                    end: 'created' in event ? event.created : Date.now()
                  }
                }
              : {
                  status: 'running',
                  input,
                  metadata,
                  time: { start: 'created' in event ? event.created : Date.now() }
                }
        const part = {
          id: partId(messageID, index),
          sessionID,
          messageID,
          type: 'tool',
          callID,
          tool,
          state
        } as Part
        record.parts[index] = part
        yield emit('message.part.updated', { part })
      } else if (event.type === 'session.step.ended' || event.type === 'session.step.failed') {
        const d = event.data
        const current = await native.session.message.get(
          { sessionID, messageID: d.assistantMessageID },
          request
        )
        const previous = messages.get(d.assistantMessageID)
        const record = convert(
          current,
          session,
          previous?.info.role === 'assistant' ? previous.info.parentID : undefined
        )
        if (record) {
          yield emit('message.updated', { info: record.info })
          for (const part of record.parts) yield emit('message.part.updated', { part })
        }
        messages.delete(d.assistantMessageID)
      } else if (event.type === 'session.inbox.delivered') {
        const current = await native.session.message.get(
          { sessionID, messageID: event.data.inboxID },
          request
        )
        const record = convert(current, session)
        if (record) {
          yield emit('message.updated', { info: record.info })
          for (const part of record.parts) yield emit('message.part.updated', { part })
        }
      } else if (
        event.type === 'session.compaction.ended' ||
        event.type === 'session.compaction.failed'
      ) {
        const history = await native.message.list(
          { sessionID, type: 'compaction', limit: 1, order: 'desc' },
          request
        )
        const record = history.data[0] ? convert(history.data[0], session) : null
        if (record) {
          yield emit('message.updated', { info: record.info })
          for (const part of record.parts) yield emit('message.part.updated', { part })
        }
      } else if (event.type === 'permission.asked') {
        yield emit('permission.asked', permission(event.data))
      } else if (event.type === 'permission.replied') {
        yield emit('permission.replied', { requestID: event.data.requestID })
      } else if (event.type === 'form.created') {
        yield emit('question.asked', question(event.data.form))
      } else if (event.type === 'form.replied' || event.type === 'form.cancelled') {
        yield emit(event.type === 'form.replied' ? 'question.replied' : 'question.rejected', {
          requestID: event.data.id
        })
      } else if (event.type === 'session.execution.failed') {
        nativeExecutions.add(sessionID)
        yield emit('session.error', { error: errorInfo(event.data.error) })
        yield emit('session.idle', {})
      } else if (event.type === 'session.execution.interrupted') {
        nativeExecutions.add(sessionID)
        yield emit('session.error', {
          error: { name: 'MessageAbortedError', data: { message: 'Interrupted' } }
        })
        yield emit('session.idle', {})
      } else if (event.type === 'session.status' || event.type === 'session.idle') {
        if (event.type !== 'session.idle' || !nativeExecutions.has(sessionID))
          yield emit(event.type, data)
      } else if (event.type === 'session.execution.started') {
        nativeExecutions.add(sessionID)
        yield emit('session.status', { status: { type: 'busy' } })
      } else if (event.type === 'session.execution.succeeded') {
        nativeExecutions.add(sessionID)
        // Native v2 completion, rather than the optional compatibility idle event, drains queues.
        yield emit('session.idle', {})
        sessions.delete(sessionID)
      } else if (event.type === 'session.deleted') {
        yield emit('session.deleted', {})
        sessions.delete(sessionID)
        nativeExecutions.delete(sessionID)
      } else if (
        event.type === 'session.created' ||
        event.type === 'session.renamed' ||
        event.type === 'session.metadata.updated'
      ) {
        const current = remember(await native.session.get({ sessionID }, request))
        yield emit(event.type === 'session.created' ? 'session.created' : 'session.updated', {
          info: fromOpenCodeV2Session(current)
        })
      }
    }
  }

  const facade = {
    global: {
      health: async (request?: RequestOptions) =>
        result({ ...(await native.server.info(request)), healthy: true }),
      event: async (request?: RequestOptions) => ({ stream: eventStream(request) })
    },
    config: {
      providers: async (p: Params, request?: RequestOptions) => {
        const data = await catalog(p, request)
        return result({ providers: data.providers, default: data.default })
      },
      get: async (p: Params, request?: RequestOptions) => {
        const selected = await native.model.default({ location: location(p) }, request)
        return result({
          model: selected.data ? `${selected.data.providerID}/${selected.data.id}` : undefined
        })
      }
    },
    provider: {
      list: async (p: Params, request?: RequestOptions) => result(await catalog(p, request))
    },
    app: {
      skills: async (p: Params, request?: RequestOptions) =>
        result(
          (await native.skill.list({ location: location(p) }, request)).data.map((skill) => ({
            ...skill,
            description: skill.description ?? ''
          }))
        )
    },
    session: {
      get: async (p: Params, request?: RequestOptions) =>
        result(
          fromOpenCodeV2Session(remember(await native.session.get({ sessionID: id(p) }, request)))
        ),
      create: async (p: Params = {}, request?: RequestOptions) =>
        result(
          fromOpenCodeV2Session(
            remember(
              await native.session.create(
                {
                  location: location(p),
                  title: p.title,
                  agent: p.agent,
                  model: model(p),
                  permissions: toOpenCodeV2Permissions(p.permission),
                  metadata: p.metadata,
                  parentID: p.parentID
                },
                request
              )
            )
          )
        ),
      update: async (p: Params, request?: RequestOptions) => {
        await prepare(p, request)
        await native.session.update(
          {
            sessionID: id(p),
            title: p.title,
            ...(p.permission ? { permissions: toOpenCodeV2Permissions(p.permission) } : {}),
            metadata: p.metadata
          },
          request
        )
        return result(
          fromOpenCodeV2Session(remember(await native.session.get({ sessionID: id(p) }, request)))
        )
      },
      messages: readMessages,
      message: async (p: Params, request?: RequestOptions) => {
        const message = await native.session.message
          .get({ sessionID: id(p), messageID: p.messageID! }, request)
          .catch(async (error: unknown) => {
            if (
              !(
                error &&
                typeof error === 'object' &&
                '_tag' in error &&
                String(error._tag).includes('NotFound')
              )
            )
              throw error
            const pending = (await native.session.inbox.list({ sessionID: id(p) }, request)).find(
              (item) => item.id === p.messageID
            )
            if (!pending || pending.type !== 'synthetic' || !pending.payload.metadata?.seleImport)
              throw error
            return {
              id: pending.id,
              type: 'synthetic' as const,
              time: pending.time,
              text: pending.payload.text,
              metadata: pending.payload.metadata
            }
          })
        return result(convert(message, await getSession(id(p), request)))
      },
      promptAsync: async (p: Params, request?: RequestOptions) => result(await prompt(p, request)),
      prompt: async (p: Params, request?: RequestOptions) => {
        await prompt(p, request)
        await native.session.wait({ sessionID: id(p) }, request)
        const history = await readMessages({ ...p, limit: 100 }, request)
        const assistant = history.data.findLast((item) => item.info.role === 'assistant')
        if (!assistant) {
          const raw = await native.message.list(
            { sessionID: id(p), limit: 10, order: 'desc' },
            request
          )
          const failure = raw.data.find((item) => item.type === 'idle' && item.error)
          throw new Error(
            failure && 'error' in failure
              ? errorInfo(failure.error).data.message
              : `OpenCode returned no assistant response (${raw.data.map((item) => item.type).join(', ')}).`
          )
        }
        return result(assistant)
      },
      abort: async (p: Params, request?: RequestOptions) => {
        await native.session.interrupt({ sessionID: id(p) }, request)
        await native.session.wait({ sessionID: id(p) }, request)
        return result(undefined)
      },
      delete: async (p: Params, request?: RequestOptions) => {
        await native.session.remove({ sessionID: id(p) }, request)
        sessions.delete(id(p))
        return result(true)
      },
      fork: async (p: Params, request?: RequestOptions) =>
        result(
          fromOpenCodeV2Session(
            remember(await native.session.fork({ sessionID: id(p), before: p.messageID }, request))
          )
        ),
      children: async (p: Params, request?: RequestOptions) => {
        const children: Session[] = []
        let cursor: string | undefined
        do {
          const page = await native.session.list(
            { limit: 100, ...(cursor ? { cursor } : { parentID: id(p) }) },
            request
          )
          children.push(...page.data.map((item) => fromOpenCodeV2Session(remember(item))))
          cursor = page.cursor.next ?? undefined
        } while (cursor)
        return result(children)
      },
      status: async (_p: Params, request?: RequestOptions) =>
        result(
          Object.fromEntries(
            Object.keys(await native.session.active(request)).map((sessionID) => [
              sessionID,
              { type: 'busy' }
            ])
          )
        ),
      revert: async (p: Params, request?: RequestOptions) => {
        await native.session.revert.stage({ sessionID: id(p), messageID: p.messageID! }, request)
        await native.session.revert.commit({ sessionID: id(p) }, request)
        lastUsers.delete(id(p))
        for (const [messageID, message] of messages)
          if (message.info.sessionID === id(p)) messages.delete(messageID)
        return result(
          fromOpenCodeV2Session(remember(await native.session.get({ sessionID: id(p) }, request)))
        )
      },
      summarize: async (p: Params, request?: RequestOptions) => {
        await prepare(p, request)
        return result(await native.session.compact({ sessionID: id(p) }, request))
      }
    },
    experimental: {
      session: {
        list: async (p: Params = {}, request?: RequestOptions) => {
          const queryKey = JSON.stringify([p.directory, p.roots, p.limit])
          let offsets = cursors.get(queryKey)
          if (!offsets) {
            offsets = new Map([[0, undefined]])
            cursors.set(queryKey, offsets)
          }
          const offset = p.cursor ?? 0
          if (!offsets.has(offset)) {
            let position = 0
            let cursor: string | undefined
            while (position < offset) {
              const page = await native.session.list(
                {
                  limit: Math.min(p.limit ?? 100, offset - position),
                  ...(cursor
                    ? { cursor }
                    : { directory: p.directory, ...(p.roots ? { parentID: null } : {}) })
                },
                request
              )
              position += page.data.length
              cursor = page.cursor.next ?? undefined
              offsets.set(position, cursor)
              if (!cursor || !page.data.length) break
            }
            if (position < offset) return result([])
          }
          const cursor = offsets.get(offset)
          const page = await native.session.list(
            {
              limit: p.limit ?? 100,
              ...(cursor
                ? { cursor }
                : { directory: p.directory, ...(p.roots ? { parentID: null } : {}) })
            },
            request
          )
          offsets.set(offset + page.data.length, page.cursor.next ?? undefined)
          return result(page.data.map((item) => fromOpenCodeV2Session(remember(item))))
        }
      }
    },
    permission: {
      list: async (p: Params, request?: RequestOptions) =>
        result(
          (await native.permission.request.list({ location: location(p) }, request)).data.map(
            permission
          )
        ),
      reply: async (p: Params, request?: RequestOptions) => {
        const sessionID = p.sessionID ?? interactions.get(p.requestID!)?.sessionID
        if (!sessionID) throw new Error('Permission request expired.')
        return result(
          await native.permission.reply(
            { sessionID, requestID: p.requestID!, decision: p.reply! },
            request
          )
        )
      }
    },
    question: {
      list: async (p: Params, request?: RequestOptions) =>
        result((await native.form.list({ location: location(p) }, request)).data.map(question)),
      reply: async (p: Params, request?: RequestOptions) => {
        const entry = interactions.get(p.requestID!)
        if (!entry) throw new Error('Question expired.')
        const answer = Object.fromEntries(
          (entry.fields ?? []).map((field, index) => {
            const values = (p.answers?.[index] ?? []).map((label) =>
              'options' in field
                ? (field.options?.find((option) => option.label === label || option.value === label)
                    ?.value ?? label)
                : label
            )
            return [
              field.key,
              field.type === 'multiselect'
                ? values
                : field.type === 'boolean'
                  ? values[0] === 'true'
                  : field.type === 'number' || field.type === 'integer'
                    ? Number(values[0])
                    : (values[0] ?? '')
            ]
          })
        )
        const response = await native.session.form.reply(
          { sessionID: entry.sessionID, formID: p.requestID!, answer },
          request
        )
        interactions.delete(p.requestID!)
        return result(response)
      },
      reject: async (p: Params, request?: RequestOptions) => {
        const entry = interactions.get(p.requestID!)
        if (!entry) throw new Error('Question expired.')
        return result(
          await native.session.form.cancel(
            { sessionID: entry.sessionID, formID: p.requestID! },
            request
          )
        )
      }
    }
  } as unknown as OpencodeClient
  nativeClients.set(facade, native)
  return facade
}
