import { isExpectedCommandAbsenceError } from '../../../shared/expectedAbsence.ts'
import { parentPort } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import type { HostCommand } from '../../hostProcess'
import { ClaudeRemoteSessionStore } from './ClaudeRemoteSessionStore'

const port = parentPort!
let commandId = 0
const pendingCommands = new Map<
  number,
  {
    resolve: (command: HostCommand) => void
    reject: (error: Error) => void
  }
>()
const resolveCommand = (requestId: number, script: string, args: string[]): Promise<HostCommand> =>
  new Promise((resolve, reject) => {
    const id = ++commandId
    pendingCommands.set(id, { resolve, reject })
    port.postMessage({ type: 'command', id, requestId, script, args })
  })

const execute = (command: HostCommand): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        env: command.env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
    child.stdin?.end()
  })

// Serialize discovery, and bound transcript reads within one SDK listing. Only compact
// session metadata crosses back to Electron; JSON parsing/SDK serialization/GC stay here.
let queue = Promise.resolve()
port.on('message', (message) => {
  if (message.type === 'commandResult') {
    const pending = pendingCommands.get(message.id)
    pendingCommands.delete(message.id)
    if (message.error) pending?.reject(new Error(message.error))
    else pending?.resolve(message.command)
    return
  }
  if (message.type !== 'list') return
  queue = queue.then(async () => {
    let commands = Promise.resolve()
    const store = message.remote
      ? new ClaudeRemoteSessionStore((script, args = []) => {
          const result = commands.then(async () =>
            execute(await resolveCommand(message.id, script, args))
          )
          commands = result.then(
            () => undefined,
            (error) => {
              if (!isExpectedCommandAbsenceError(error, [4])) {
                console.error('Unable to read Claude discovery transcript.', error)
              }
            }
          )
          return result
        })
      : undefined
    try {
      const sessions = await listSessions({ includeProgrammatic: true, sessionStore: store })
      port.postMessage({ type: 'result', id: message.id, sessions })
    } catch (error) {
      console.error('Unable to discover Claude sessions.', error)
      port.postMessage({
        type: 'result',
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
})
