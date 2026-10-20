import { access, appendFile, mkdir, readFile, readdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import type { TranscriptMessage } from './ChatTranscript.ts'
import { withMigrationNote } from './ChatTranscript.ts'

export const historyMessageId = (
  scope: string,
  message: TranscriptMessage,
  index: number
): string => {
  const hash = createHash('sha256')
    .update(`${scope}\0${message.id ?? `${index}:${message.role}:${message.content}`}`)
    .digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

export const claudeHistoryPath = async (id: string, cwd: string): Promise<string> => {
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  for (const project of await readdir(root).catch((error) => {
    if (error.code === 'ENOENT') return [] as string[]
    throw error
  })) {
    const candidate = join(root, project, `${id}.jsonl`)
    try {
      await access(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
}

export const readHistoryLines = async (path: string): Promise<Record<string, unknown>[]> => {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

export const appendHistoryLines = async (path: string, records: unknown[]): Promise<void> => {
  if (!records.length) return
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, {
    mode: 0o600
  })
  const file = await open(path, 'r+')
  try {
    await file.sync()
  } finally {
    await file.close()
  }
}

export const encodeClaudeHistory = (
  id: string,
  cwd: string,
  messages: TranscriptMessage[],
  parentUuid: string | null,
  existing = new Set<string>()
): unknown[] =>
  messages.flatMap((message, index) => {
    const uuid = historyMessageId(id, message, index)
    if (existing.has(uuid)) return []
    const entry = {
      parentUuid,
      isSidechain: false,
      userType: 'external',
      cwd,
      sessionId: id,
      uuid,
      timestamp: new Date(Date.now() + index).toISOString(),
      type: message.role,
      message:
        message.role === 'user'
          ? { role: 'user', content: [{ type: 'text', text: withMigrationNote(message.content) }] }
          : {
              id: `msg_${uuid}`,
              type: 'message',
              role: 'assistant',
              model: 'imported-history',
              content: [{ type: 'text', text: message.content }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 }
            }
    }
    parentUuid = uuid
    return [entry]
  })

export const copilotHistoryPath = (id: string): string =>
  join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'session-state', id, 'events.jsonl')

export const encodeCopilotHistory = (
  messages: TranscriptMessage[],
  parentId: string | null,
  existing = new Set<string>(),
  nextTurn = 0
): unknown[] => {
  const records: unknown[] = []
  let interactionId = randomUUID()
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') interactionId = randomUUID()
    const turnId = String(nextTurn)
    const events =
      message.role === 'user'
        ? [
            {
              type: 'user.message',
              data: {
                content: withMigrationNote(message.content),
                transformedContent: withMigrationNote(message.content),
                messageId: randomUUID(),
                turnId,
                interactionId
              }
            }
          ]
        : [
            { type: 'assistant.turn_start', data: { turnId, interactionId } },
            {
              type: 'assistant.message',
              data: {
                content: message.content,
                messageId: randomUUID(),
                toolRequests: [],
                turnId,
                interactionId
              }
            },
            { type: 'assistant.turn_end', data: { turnId } }
          ]
    for (const event of events) {
      const id = historyMessageId(`copilot-${event.type}`, message, index)
      if (existing.has(id)) continue
      records.push({ ...event, id, parentId, timestamp: new Date().toISOString() })
      parentId = id
    }
    if (message.role === 'assistant') nextTurn++
  }
  return records
}
