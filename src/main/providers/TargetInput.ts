import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AppContainerTarget } from '../../shared/app'
import { getHostCommand } from '../hostProcess'

/** Container launchers can consume stdin during startup. Send payloads only after our shell is ready. */
export const runTargetInput = async (
  container: AppContainerTarget | null | undefined,
  script: string,
  args: string[],
  input: string | Buffer,
  env?: NodeJS.ProcessEnv,
  cwd?: string
): Promise<string> => {
  const marker = `sele-input-ready:${randomUUID()}\n`
  const command = await getHostCommand(
    'sh',
    ['-c', `printf '%s\\n' "$1"; shift\n${script}`, 'sele-input', marker.trim(), ...args],
    { container, env, cwd }
  )
  return new Promise((resolve, reject) => {
    let ready = false
    let output = ''
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        env: command.env,
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        timeout: 120_000
      },
      (error, stdout) => {
        if (error) reject(error)
        else if (!ready) reject(new Error('The target did not accept the import payload.'))
        else resolve(stdout.slice(stdout.indexOf(marker) + marker.length))
      }
    )
    child.stdout?.on('data', (chunk) => {
      if (ready) return
      output += chunk
      if (output.includes(marker)) {
        ready = true
        child.stdin?.end(input)
      }
    })
    child.stdin?.on('error', reject)
  })
}
