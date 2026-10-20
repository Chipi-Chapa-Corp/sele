import { runTargetInput } from './TargetInput'
import { execFile } from 'node:child_process'
import { getHostCommand, isRunningInFlatpak } from '../hostProcess'
import type { AppContainerTarget } from '../../shared/app'
import {
  appendHistoryLines,
  claudeHistoryPath,
  copilotHistoryPath,
  readHistoryLines
} from './NativeHistoryImport'

const run = async (
  container: AppContainerTarget | null | undefined,
  script: string,
  args: string[],
  input = ''
): Promise<string> => {
  if (input) return runTargetInput(container, script, args, input, process.env)
  const command = await getHostCommand('sh', ['-lc', script, 'sele-history-import', ...args], {
    container,
    env: process.env
  })
  return new Promise((resolve, reject) => {
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
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
    child.stdin?.on('error', reject)
    child.stdin?.end(input)
  })
}

/** Resolve paths in the provider's runtime, including container homes and Flatpak hosts. */
export const nativeHistoryFile = async (
  provider: 'claude' | 'copilot',
  id: string,
  cwd: string,
  container?: AppContainerTarget | null
) => {
  const remote = container?.kind === 'container' || isRunningInFlatpak()
  const path = !remote
    ? provider === 'claude'
      ? await claudeHistoryPath(id, cwd)
      : copilotHistoryPath(id)
    : await run(
        container,
        provider === 'claude'
          ? `
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/"$1.jsonl"; do
  [ -f "$path" ] || continue
  printf '%s' "$path"
  exit 0
done
printf '%s' "$root/$2/$1.jsonl"
`
          : `printf '%s' "\${COPILOT_HOME:-"$HOME/.copilot"}/session-state/$1/events.jsonl"`,
        [id, cwd.replace(/[^a-zA-Z0-9]/g, '-')]
      )
  return {
    read: async (): Promise<Record<string, unknown>[]> => {
      if (!remote) return readHistoryLines(path)
      const text = await run(container, 'if [ -f "$1" ]; then cat "$1"; fi', [path])
      return text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
    },
    append: async (records: unknown[]): Promise<void> => {
      if (!records.length) return
      if (!remote) return appendHistoryLines(path, records)
      await run(
        container,
        'umask 077; mkdir -p "$(dirname "$1")" && cat >> "$1"',
        [path],
        `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      )
    }
  }
}
