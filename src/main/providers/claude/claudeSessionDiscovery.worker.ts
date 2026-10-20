import { parentPort } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { readLocalClaudeSessionInfo } from './ClaudeSessionSummary'
import type { HostCommand } from '../../hostProcess'
import { ClaudeSessionCatalog, listLocalClaudeSessionCandidates } from './ClaudeSessionCatalog'
import {
  listRemoteClaudeSessionCandidates,
  readRemoteClaudeSessionInfo
} from './ClaudeRemoteSessionDiscovery'

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

const catalog = new ClaudeSessionCatalog()
port.on('message', (message) => {
  if (message.type === 'commandResult') {
    const pending = pendingCommands.get(message.id)
    pendingCommands.delete(message.id)
    if (message.error) pending?.reject(new Error(message.error))
    else pending?.resolve(message.command)
    return
  }
  if (message.type !== 'list') return
  // Independent environments must not queue behind a slow remote host.
  void (async () => {
    const run = async (script: string, args: string[] = []): Promise<string> =>
      execute(await resolveCommand(message.id, script, args))
    try {
      const page = await catalog.list(
        message.scope,
        message.cursor ?? null,
        Math.max(1, Math.min(message.limit ?? 50, 100)),
        new Set<string>(message.hiddenSessionIds ?? []),
        message.remote
          ? () => listRemoteClaudeSessionCandidates(run)
          : listLocalClaudeSessionCandidates,
        message.remote
          ? (candidate) => readRemoteClaudeSessionInfo(candidate, run)
          : readLocalClaudeSessionInfo
      )
      port.postMessage({ type: 'result', id: message.id, page })
    } catch (error) {
      console.error('Unable to discover Claude sessions.', error)
      port.postMessage({
        type: 'result',
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })()
})
