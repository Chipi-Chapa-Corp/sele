import { parentPort } from 'node:worker_threads'
import { execFile, type ChildProcess, type ExecFileException } from 'node:child_process'
import type { HostCommand } from './hostProcess'
import type { BufferedCommandOptions, BufferedCommandReply } from './BufferedCommandWorker'

const children = new Set<ChildProcess>()
let disposing = false
const closeIfDone = (): void => {
  if (disposing && !children.size) parentPort?.close()
}
parentPort?.on(
  'message',
  (
    request:
      | { id: number; command: HostCommand; options: BufferedCommandOptions }
      | { dispose: true }
  ) => {
    if ('dispose' in request) {
      disposing = true
      for (const child of children) child.kill('SIGKILL')
      closeIfDone()
      return
    }
    const reply = (error: ExecFileException | null, stdout = '', stderr = ''): void => {
      const result: BufferedCommandReply = {
        id: request.id,
        stdout,
        stderr,
        error: error
          ? { message: error.message, code: error.code, killed: error.killed, signal: error.signal }
          : null
      }
      parentPort!.postMessage(result)
    }
    try {
      const child = execFile(
        request.command.file,
        request.command.args,
        {
          cwd: request.command.cwd,
          env: request.command.env,
          encoding: 'utf8',
          timeout: request.options.timeout,
          maxBuffer: request.options.maxBuffer,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          children.delete(child)
          reply(error, stdout, stderr)
          closeIfDone()
        }
      )
      children.add(child)
      child.stdin?.on('error', () => {}) // Early child exit can close stdin before input is delivered.
      child.stdin?.end(request.options.input)
    } catch (error) {
      reply(error instanceof Error ? error : new Error(String(error)))
      closeIfDone()
    }
  }
)
