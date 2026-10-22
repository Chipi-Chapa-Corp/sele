// Deterministic model server for provider end-to-end tests.
// Speaks OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages (streaming).
// Behaviour is scripted by directives inside user messages:
//   #work N        run N shell tool calls before answering
//   #delay MS      wait MS before every model response in this turn (default 0)
//   #agent N       delegate once to a subagent tool whose prompt is "#work N"
//   #text N        answer with N markdown paragraphs
//   #hold NAME     keep running shell tools until the test calls release(NAME)
//   #slow MS       each shell tool sleeps MS (default 200)
// The final answer echoes every user message of the current turn as `Reply to: a | b`.
const http = require('node:http')
const fs = require('node:fs')

const released = new Set()
const shellToolNames = /^(shell|shell_command|exec_command|local_shell|bash|Bash|powershell)$/
const agentToolNames = /^(Task|Agent|task|spawn_agent)$/
const waitToolNames = /^(wait_agent)$/

function textOf(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : part.type === 'text' || part.type === 'input_text' || part.type === 'output_text'
            ? part.text
            : ''
      )
      .join('')
  return ''
}

// Normalized conversation: {role:'user'|'assistant'|'tool', text, toolCalls}
function normalizeResponses(body) {
  const messages = []
  const input =
    typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input
  for (const item of input ?? []) {
    if (
      item.type === 'function_call' ||
      item.type === 'custom_tool_call' ||
      item.type === 'local_shell_call'
    )
      messages.push({ role: 'assistant', text: '', toolCalls: [item.name ?? 'shell'] })
    else if (item.type?.endsWith('_call_output'))
      messages.push({
        role: 'tool',
        text: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
      })
    else if (item.role === 'user' || item.role === 'assistant' || item.role === 'developer')
      messages.push({
        role: item.role === 'developer' ? 'system' : item.role,
        text: textOf(item.content)
      })
  }
  return messages
}

function normalizeChat(body) {
  const messages = []
  for (const item of body.messages ?? []) {
    if (item.role === 'tool') messages.push({ role: 'tool', text: '' })
    else if (item.role === 'assistant')
      messages.push({
        role: 'assistant',
        text: textOf(item.content),
        toolCalls: (item.tool_calls ?? []).map((call) => call.function?.name)
      })
    else messages.push({ role: item.role, text: textOf(item.content) })
  }
  return messages
}

function normalizeAnthropic(body) {
  const messages = []
  for (const item of body.messages ?? []) {
    const parts =
      typeof item.content === 'string' ? [{ type: 'text', text: item.content }] : item.content
    if (item.role === 'user') {
      if (parts.some((part) => part.type === 'tool_result'))
        messages.push({ role: 'tool', text: '' })
      const text = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      if (text) messages.push({ role: 'user', text })
    } else if (item.role === 'system') {
      messages.push({ role: 'system', text: parts.map((part) => part.text ?? '').join('\n') })
    } else {
      messages.push({
        role: 'assistant',
        text: parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
        toolCalls: parts.filter((part) => part.type === 'tool_use').map((part) => part.name)
      })
    }
  }
  return messages
}

// Provider CLIs wrap user text in reminders and context; keep only the user's own lines.
function userIntent(text) {
  const stripped = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
    .replace(/<([a-z_-]+)>[\s\S]*?<\/\1>/g, '')
    .trim()
  return stripped
}

function directive(texts, name, fallback) {
  let value = fallback
  for (const text of texts) {
    const match = new RegExp('#' + name + '\\s+(\\d+)').exec(text)
    if (match) value = Math.max(value ?? 0, Number(match[1]))
  }
  return value
}

// Sele and the CLIs ask the model for chat titles; answer with a stable title from the prompt.
function titleRequest(messages, body) {
  const all = messages.map((message) => message.text ?? '').join('\n')
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.text)
    .join('\n')
  const users = messages.filter((message) => message.role === 'user')
  // Agent system prompts mention titles too, so only a title-only conversation qualifies.
  const asks =
    /title generator/i.test(system) ||
    (users.length <= 2 &&
      /(short|concise|brief)[^\n]{0,40}title|provide a short title/i.test(
        users.map((m) => m.text).join('\n')
      ))
  if (!asks || messages.some((message) => message.role === 'tool' || message.toolCalls?.length))
    return null
  const prompt =
    /User prompt:\s*([\s\S]*)$/i.exec(all)?.[1] ??
    userIntent([...messages].reverse().find((message) => message.role === 'user')?.text ?? '')
  const title =
    prompt
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^<\/?[a-z_-]+>/.test(line))
      .at(-1)
      ?.replace(/#\w+(\s+[\w-]+)?/g, '')
      .replace(/["`]/g, '')
      .trim()
      .slice(0, 36) || 'Scripted chat'
  const json =
    body.text?.format?.type === 'json_schema' || /^json/.test(body.response_format?.type ?? '')
  return { text: json ? JSON.stringify({ title }) : title, title: true }
}

function decide(messages, tools, body = {}) {
  const title = titleRequest(messages, body)
  if (title) return title
  let start = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'assistant' && message.text && !message.toolCalls?.length) {
      start = index + 1
      break
    }
  }
  const turn = messages.slice(start)
  const users = turn
    .filter((message) => message.role === 'user')
    .map((message) => userIntent(message.text))
    .filter((text) => text && !/^\[?(Request interrupted|Continue)/i.test(text))
  const toolResults = turn.filter((message) => message.role === 'tool').length
  const agentCalls = turn.filter((message) =>
    message.toolCalls?.some(
      (name) => agentToolNames.test(name ?? '') || waitToolNames.test(name ?? '')
    )
  ).length
  const spawned = turn.filter((message) =>
    message.toolCalls?.some((name) => agentToolNames.test(name ?? ''))
  ).length
  const waited = turn.filter((message) =>
    message.toolCalls?.some((name) => waitToolNames.test(name ?? ''))
  ).length
  // Codex returns the spawned agent id in the spawn_agent output.
  const agentId = turn
    .filter((message) => message.role === 'tool')
    .map((message) =>
      /"agent_id"\s*:\s*"([^"]+)"|\b([0-9a-f]{8}-[0-9a-f-]{27,})\b/.exec(message.text ?? '')
    )
    .find(Boolean)
  const work = directive(users, 'work', 0)
  const agent = directive(users, 'agent', null)
  const delay = directive(users, 'delay', 0)
  const paragraphs = directive(users, 'text', 1)
  const sleepMs = directive(users, 'slow', 200)
  const shell = tools.find((tool) => shellToolNames.test(tool.name))
  const agentTool = tools.find((tool) => agentToolNames.test(tool.name))
  const step = toolResults - agentCalls + 1
  const waitTool = tools.find((tool) => waitToolNames.test(tool.name))
  if (agent !== null && agentTool && spawned === 0)
    return { delay, tool: agentTool, kind: 'agent', prompt: '#work ' + agent }
  if (agent !== null && waitTool && spawned > 0 && waited === 0 && agentId)
    return { delay, tool: waitTool, kind: 'wait', target: agentId[1] ?? agentId[2] }
  if (shell && toolResults - agentCalls < work)
    return { delay, tool: shell, kind: 'shell', step, sleepMs }
  const hold = users.map((text) => /#hold\s+([\w-]+)/.exec(text)?.[1]).find(Boolean)
  if (shell && hold && !released.has(hold))
    return { delay: Math.max(delay, 250), tool: shell, kind: 'shell', step, hold, sleepMs }
  const echoed = users.length ? users.join(' | ') : 'empty'
  const extra = Array.from(
    { length: Math.max(0, paragraphs - 1) },
    (_, index) =>
      `Paragraph ${index + 2}: the scripted provider confirms every requested step, keeps formatting stable, and reports results.`
  )
  return { delay, text: ['Reply to: ' + echoed, ...extra].join('\n\n') }
}

function argumentsFor(decision) {
  const schema = decision.tool.schema ?? {}
  const properties = schema.properties ?? {}
  const command = `sleep ${((decision.sleepMs ?? 200) / 1000).toFixed(2)}; echo step-${decision.step ?? 0}`
  const args = {}
  if (decision.kind === 'wait') return { targets: [decision.target], timeout_ms: 60000 }
  if (decision.kind === 'agent') {
    for (const [key, value] of Object.entries(properties)) {
      if (/prompt|message|task|instructions/i.test(key) && value.type === 'string')
        args[key] = decision.prompt
      else if (/description|name|title/i.test(key)) args[key] = 'Scripted subagent'
      else if (/subagent_type|agent_type/i.test(key)) args[key] = 'general-purpose'
      else if ((schema.required ?? []).includes(key) && value.type === 'string')
        args[key] = 'general'
    }
    if (!Object.keys(args).length) args.prompt = decision.prompt
    return args
  }
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'command' || key === 'cmd')
      args[key] = value.type === 'array' ? ['bash', '-lc', command] : command
    else if (key === 'description') args[key] = 'Run scripted step ' + decision.step
    else if ((schema.required ?? []).includes(key)) {
      if (value.type === 'string') args[key] = value.enum?.[0] ?? 'sync'
      else if (value.type === 'number' || value.type === 'integer') args[key] = 30
      else if (value.type === 'boolean') args[key] = false
    }
  }
  if (!('command' in args) && !('cmd' in args)) args.command = command
  return args
}

let log = process.env.MOCK_MODEL_LOG
  ? fs.createWriteStream(process.env.MOCK_MODEL_LOG, { flags: 'a' })
  : null
const stats = { requests: 0, byPath: {}, lastUsers: [], seen: [] }
const seen = new Map()
let counter = 0
const id = (prefix) => `${prefix}_${Date.now().toString(36)}${(++counter).toString(36)}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
}

async function streamResponses(res, body, decision) {
  const responseId = id('resp')
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  sse(res)
  const base = {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: body.model,
    status: 'in_progress',
    output: []
  }
  send('response.created', { response: base })
  const output = []
  if (decision.text) {
    const item = {
      id: id('msg'),
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
      content: []
    }
    send('response.output_item.added', { output_index: 0, item })
    send('response.content_part.added', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] }
    })
    for (const chunk of decision.text.match(/[\s\S]{1,24}/g)) {
      send('response.output_text.delta', {
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: chunk
      })
      await sleep(4)
    }
    send('response.output_text.done', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: decision.text
    })
    const done = {
      ...item,
      status: 'completed',
      content: [{ type: 'output_text', text: decision.text, annotations: [] }]
    }
    send('response.output_item.done', { output_index: 0, item: done })
    output.push(done)
  } else {
    const args = JSON.stringify(argumentsFor(decision))
    const item = {
      id: id('fc'),
      type: 'function_call',
      status: 'in_progress',
      call_id: id('call'),
      name: decision.tool.name,
      ...(decision.tool.namespace ? { namespace: decision.tool.namespace } : {}),
      arguments: ''
    }
    send('response.output_item.added', { output_index: 0, item })
    send('response.function_call_arguments.delta', {
      item_id: item.id,
      output_index: 0,
      delta: args
    })
    send('response.function_call_arguments.done', {
      item_id: item.id,
      output_index: 0,
      arguments: args
    })
    const done = { ...item, status: 'completed', arguments: args }
    send('response.output_item.done', { output_index: 0, item: done })
    output.push(done)
  }
  send('response.completed', {
    response: {
      ...base,
      status: 'completed',
      output,
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 120
      }
    }
  })
  res.end()
}

async function streamChat(res, body, decision) {
  const chunkId = id('chatcmpl')
  const created = Math.floor(Date.now() / 1000)
  const send = (delta, finish = null, extra = {}) =>
    res.write(
      `data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
    )
  const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
  if (!body.stream) {
    const message = decision.text
      ? { role: 'assistant', content: decision.text }
      : {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: id('call'),
              type: 'function',
              function: {
                name: decision.tool.name,
                arguments: JSON.stringify(argumentsFor(decision))
              }
            }
          ]
        }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(
      JSON.stringify({
        id: chunkId,
        object: 'chat.completion',
        created,
        model: body.model,
        choices: [{ index: 0, message, finish_reason: decision.text ? 'stop' : 'tool_calls' }],
        usage
      })
    )
  }
  sse(res)
  send({ role: 'assistant', content: '' })
  if (decision.text) {
    for (const chunk of decision.text.match(/[\s\S]{1,24}/g)) {
      send({ content: chunk })
      await sleep(4)
    }
    send({}, 'stop')
  } else {
    send({
      tool_calls: [
        {
          index: 0,
          id: id('call'),
          type: 'function',
          function: { name: decision.tool.name, arguments: JSON.stringify(argumentsFor(decision)) }
        }
      ]
    })
    send({}, 'tool_calls')
  }
  res.write(
    `data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created, model: body.model, choices: [], usage })}\n\n`
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

async function streamAnthropic(res, body, decision) {
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  const message = {
    id: id('msg'),
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  }
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    const content = decision.text
      ? [{ type: 'text', text: decision.text }]
      : [
          {
            type: 'tool_use',
            id: id('toolu'),
            name: decision.tool.name,
            input: argumentsFor(decision)
          }
        ]
    return res.end(
      JSON.stringify({
        ...message,
        content,
        stop_reason: decision.text ? 'end_turn' : 'tool_use',
        usage: { ...message.usage, output_tokens: 20 }
      })
    )
  }
  sse(res)
  send('message_start', { message })
  if (decision.text) {
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    for (const chunk of decision.text.match(/[\s\S]{1,24}/g)) {
      send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } })
      await sleep(4)
    }
  } else {
    send('content_block_start', {
      index: 0,
      content_block: { type: 'tool_use', id: id('toolu'), name: decision.tool.name, input: {} }
    })
    send('content_block_delta', {
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(argumentsFor(decision)) }
    })
  }
  send('content_block_stop', { index: 0 })
  send('message_delta', {
    delta: { stop_reason: decision.text ? 'end_turn' : 'tool_use', stop_sequence: null },
    usage: { output_tokens: 20 }
  })
  send('message_stop', {})
  res.end()
}

function toolsOf(body, flavor) {
  return (body.tools ?? [])
    .map((tool) =>
      flavor === 'anthropic'
        ? { name: tool.name, schema: tool.input_schema }
        : flavor === 'chat'
          ? { name: tool.function?.name, schema: tool.function?.parameters }
          : tool.type === 'namespace'
            ? (tool.tools ?? []).map((inner) => ({
                name: inner.name,
                schema: inner.parameters,
                namespace: tool.name
              }))
            : { name: tool.name ?? tool.type, schema: tool.parameters }
    )
    .flat()
    .filter((tool) => tool.name)
}

const models = ['mock-model', 'gpt-5.5', 'claude-sonnet-4-5']

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  const path = req.url.split('?')[0].replace(/^\/v1/, '').replace(/\/$/, '')
  stats.requests++
  stats.byPath[path] = (stats.byPath[path] ?? 0) + 1
  try {
    if (path === '/__release') {
      release(new URL(req.url, 'http://x').searchParams.get('name'))
      res.writeHead(204)
      return res.end()
    }
    if (req.method === 'GET' && path === '/__stats') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(stats))
    }
    if (req.method === 'GET' && path === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({
          object: 'list',
          data: models.map((model) => ({
            id: model,
            object: 'model',
            created: 0,
            owned_by: 'mock',
            type: 'model',
            display_name: model
          })),
          models: models.map((model) => ({ slug: model, display_name: model }))
        })
      )
    }
    const body = raw ? JSON.parse(raw) : {}
    if (path === '/messages/count_tokens') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ input_tokens: 100 }))
    }
    const flavor =
      path === '/responses'
        ? 'responses'
        : path === '/chat/completions'
          ? 'chat'
          : path === '/messages'
            ? 'anthropic'
            : null
    if (!flavor || req.method !== 'POST') {
      log?.write(JSON.stringify({ unknown: true, method: req.method, url: req.url }) + '\n')
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: 'not found: ' + req.url } }))
    }
    const messages =
      flavor === 'responses'
        ? normalizeResponses(body)
        : flavor === 'chat'
          ? normalizeChat(body)
          : normalizeAnthropic(body)
    const tools = toolsOf(body, flavor)
    const decision = decide(messages, tools, body)
    const system = [
      textOf(body.system),
      textOf(body.instructions),
      ...messages.filter((message) => message.role === 'system').map((message) => message.text)
    ].join('\n')
    // Title generators replay the prompt without tools; they do not deliver a message.
    const auxiliary = Boolean(decision.title) || (tools.length === 0 && /title/i.test(system))
    if (!auxiliary)
      for (const message of messages)
        if (message.role === 'user') {
          const text = userIntent(message.text)
          if (text && !seen.has(text)) {
            seen.set(text, Date.now())
            stats.seen.push({ text: text.slice(0, 500), at: Date.now() })
          }
        }
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    stats.lastUsers.push(userIntent(lastUser?.text ?? '').slice(0, 200))
    if (stats.lastUsers.length > 200) stats.lastUsers.shift()
    log?.write(
      JSON.stringify({
        at: new Date().toISOString(),
        path,
        model: body.model,
        tools: tools.map((tool) => tool.name),
        messages: messages.map((message) => ({
          role: message.role,
          text: message.text?.slice(0, 160),
          toolCalls: message.toolCalls
        })),
        decision: decision.text
          ? { text: decision.text.slice(0, 160) }
          : { tool: decision.tool.name, kind: decision.kind, args: argumentsFor(decision) }
      }) + '\n'
    )
    if (process.env.MOCK_MODEL_DUMP)
      log?.write(JSON.stringify({ dump: body }).slice(0, 200000) + '\n')
    if (decision.delay) await sleep(decision.delay)
    if (flavor === 'responses') await streamResponses(res, body, decision)
    else if (flavor === 'chat') await streamChat(res, body, decision)
    else await streamAnthropic(res, body, decision)
  } catch (error) {
    log?.write(JSON.stringify({ error: String(error?.stack ?? error) }) + '\n')
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: String(error) } }))
  }
})

function start({ port = Number(process.env.MOCK_MODEL_PORT ?? 0), logFile = null } = {}) {
  if (logFile) log = fs.createWriteStream(logFile, { flags: 'a' })
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  )
}

/** Let every turn holding `name` finish. */
function release(name) {
  released.add(name)
}

/** First time each user message reached the model, in delivery order. */
function delivered() {
  return stats.seen.slice()
}

module.exports = { start, server, decide, release, delivered, stats }

if (require.main === module)
  start().then((port) => console.log(`mock model server listening on ${port}`))
