import type { Message, Session, GlobalSession } from '@opencode-ai/sdk/v2'
import type { TranscriptMessage } from '../ChatTranscript'
import { withMigrationNote } from '../ChatTranscript'
import { historyMessageId } from '../NativeHistoryImport'

export const encodeOpenCodeHistory = (
  session: Session | GlobalSession,
  messages: TranscriptMessage[],
  model: { providerID: string; modelID: string }
) => {
  let parentID = ''
  const start = Date.now() - messages.length
  return messages.map((message, index) => {
    const created = start + index
    const suffix = historyMessageId(session.id, message, index).replaceAll('-', '')
    const id = `msg_${suffix}`
    const info: Message =
      message.role === 'user'
        ? { id, sessionID: session.id, time: { created }, role: 'user', agent: 'build', model }
        : {
            id,
            sessionID: session.id,
            time: { created, completed: created },
            role: 'assistant',
            parentID,
            modelID: model.modelID,
            providerID: model.providerID,
            mode: 'build',
            agent: 'build',
            path: { cwd: session.directory, root: session.directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: 'stop'
          }
    if (message.role === 'user') parentID = id
    return {
      info,
      parts: [
        {
          id: `prt_${suffix}`,
          sessionID: session.id,
          messageID: id,
          type: 'text' as const,
          text: message.role === 'user' ? withMigrationNote(message.content) : message.content
        }
      ]
    }
  })
}
