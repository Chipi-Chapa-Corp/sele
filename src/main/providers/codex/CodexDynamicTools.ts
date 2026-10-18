import { record } from '../../../shared/elicitation.ts'
import { validateElicitation } from './CodexElicitationValidation.ts'

export type CodexDynamicToolSpec = {
  type: 'function'
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
export type CodexDynamicToolResult = {
  success: boolean
  contentItems: Array<
    | { type: 'inputText'; text: string }
    | { type: 'inputImage'; imageUrl: string }
    | { type: 'inputAudio'; audioUrl: string }
  >
}
type Handler = (
  arguments_: Record<string, unknown>,
  context: {
    threadId: string
    turnId: string
    callId: string
    signal: AbortSignal
  }
) => Promise<CodexDynamicToolResult> | CodexDynamicToolResult

// Tools are explicitly registered by the host. Names received from a model never select code to load.
export class CodexDynamicTools {
  private tools = new Map<
    string,
    { spec: CodexDynamicToolSpec; handler: Handler; namespace: string | null }
  >()
  private threads = new Map<string, Set<string>>()
  private active = new Set<AbortController>()
  private blockedThreads = new Set<string>()

  isReadOnly(threadId: string): boolean {
    return this.blockedThreads.has(threadId)
  }

  setReadOnly(threadId: string, readOnly: boolean): void {
    if (readOnly) this.blockedThreads.add(threadId)
    else this.blockedThreads.delete(threadId)
  }

  register(
    spec: CodexDynamicToolSpec,
    handler: Handler,
    namespace: string | null = null
  ): () => void {
    const key = `${namespace ?? ''}:${spec.name}`
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(spec.name) ||
      (namespace !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) ||
      this.tools.has(key)
    )
      throw new Error('Invalid or duplicate dynamic tool name')
    const registered = { spec: structuredClone(spec), handler, namespace }
    this.tools.set(key, registered)
    return () => {
      if (this.tools.get(key) === registered) this.tools.delete(key)
    }
  }

  get specs(): Array<
    | CodexDynamicToolSpec
    | { type: 'namespace'; name: string; description: string; tools: CodexDynamicToolSpec[] }
  > {
    const standalone: CodexDynamicToolSpec[] = []
    const namespaces = new Map<string, CodexDynamicToolSpec[]>()
    for (const value of this.tools.values()) {
      if (!value.namespace) standalone.push(value.spec)
      else namespaces.set(value.namespace, [...(namespaces.get(value.namespace) ?? []), value.spec])
    }
    return [
      ...standalone,
      ...Array.from(namespaces, ([name, tools]) => ({
        type: 'namespace' as const,
        name,
        description: `Host tools: ${name}`,
        tools
      }))
    ]
  }

  bind(threadId: string, specs: unknown): void {
    this.threads.set(
      threadId,
      new Set(
        Array.isArray(specs)
          ? specs.flatMap((spec) => {
              const value = record(spec)
              if (
                value?.type === 'namespace' &&
                typeof value.name === 'string' &&
                Array.isArray(value.tools)
              )
                return value.tools.flatMap((tool) => {
                  const key = `${value.name}:${record(tool)?.name}`
                  return this.tools.has(key) ? [key] : []
                })
              const key = `:${value?.name}`
              return value?.type === 'function' && this.tools.has(key) ? [key] : []
            })
          : []
      )
    )
  }

  inherit(threadId: string, parentThreadId: string): void {
    this.threads.set(threadId, new Set(this.threads.get(parentThreadId) ?? []))
    this.setReadOnly(threadId, this.blockedThreads.has(parentThreadId))
  }

  async call(params: unknown): Promise<CodexDynamicToolResult> {
    const request = record(params)
    const fail = (text: string): CodexDynamicToolResult => ({
      success: false,
      contentItems: [{ type: 'inputText', text }]
    })
    if (
      !request ||
      typeof request.threadId !== 'string' ||
      typeof request.turnId !== 'string' ||
      typeof request.callId !== 'string' ||
      typeof request.tool !== 'string'
    )
      return fail('Invalid client tool request.')
    if (this.blockedThreads.has(request.threadId))
      return fail('Client tools are unavailable while this conversation has read-only access.')
    const key = `${request.namespace ?? ''}:${request.tool}`
    const tool = this.tools.get(key)
    if (!tool || !this.threads.get(request.threadId)?.has(key))
      return fail(`Client tool ${request.tool} is not registered for this conversation in Sele.`)
    const arguments_ = record(request.arguments)
    if (!arguments_) return fail('Client tool arguments must be an object.')
    const error = validateElicitation(tool.spec.inputSchema, arguments_)
    if (error) return fail(error)
    const controller = new AbortController()
    this.active.add(controller)
    try {
      const result = await tool.handler(arguments_, {
        threadId: request.threadId,
        turnId: request.turnId,
        callId: request.callId,
        signal: controller.signal
      })
      if (
        !result ||
        typeof result.success !== 'boolean' ||
        !Array.isArray(result.contentItems) ||
        !result.contentItems.every(
          (item) =>
            (item.type === 'inputText' && typeof item.text === 'string') ||
            (item.type === 'inputImage' && typeof item.imageUrl === 'string') ||
            (item.type === 'inputAudio' && typeof item.audioUrl === 'string')
        )
      )
        return fail('The client tool returned an invalid result.')
      return result
    } catch {
      return fail('The client tool failed to execute.')
    } finally {
      this.active.delete(controller)
    }
  }

  clear(): void {
    for (const controller of this.active) controller.abort()
    this.active.clear()
    this.threads.clear()
    this.blockedThreads.clear()
  }
}
