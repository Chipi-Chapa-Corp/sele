import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import { getHostCommand } from '../../hostProcess'

export type OpenCodeCredentialTypes = Record<string, string>

export const parseOpenCodeCredentialTypes = (content: string): OpenCodeCredentialTypes => {
  const data: unknown = JSON.parse(content)
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid credential store')
  return Object.fromEntries(
    Object.entries(data).flatMap(([id, value]) =>
      value && typeof value === 'object' && 'type' in value && typeof value.type === 'string'
        ? [[id, value.type]]
        : []
    )
  )
}

// Read on the selected target, and discard credential values before returning metadata.
export const readOpenCodeCredentialTypes = async (
  container?: AppContainerTarget | null
): Promise<OpenCodeCredentialTypes> => {
  try {
    let content: string
    if (process.platform === 'win32' && !container) {
      content = await readFile(
        join(
          process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
          'opencode',
          'auth.json'
        ),
        'utf8'
      ).catch((error) => {
        if (isExpectedFileAbsenceError(error)) return '{}'
        throw error
      })
    } else {
      const command = await getHostCommand(
        'sh',
        [
          '-c',
          'file="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json"; if [ -f "$file" ]; then cat "$file"; else printf "{}"; fi'
        ],
        { container, env: process.env }
      )
      content = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          command.file,
          command.args,
          {
            cwd: command.cwd,
            env: command.env,
            timeout: 15_000,
            maxBuffer: 4 * 1024 * 1024,
            encoding: 'utf8',
            windowsHide: true
          },
          (error, stdout) => {
            if (error) reject(new Error('Unable to read OpenCode credential metadata.'))
            else resolve(stdout)
          }
        )
        child.stdin?.end()
      })
    }
    return parseOpenCodeCredentialTypes(content)
  } catch {
    throw new Error('Unable to read OpenCode credential metadata.')
  }
}
