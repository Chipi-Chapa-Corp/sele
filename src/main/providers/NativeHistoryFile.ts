import { randomUUID } from 'node:crypto'
import { open, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
  return nativeHistoryFileAt(path, container, remote)
}

export const nativeHistoryFileAt = (
  path: string,
  container?: AppContainerTarget | null,
  remote = container?.kind === 'container' || isRunningInFlatpak()
) => {
  const lines = (records: unknown[]) =>
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
  return {
    remove: async (): Promise<void> => {
      if (remote) await run(container, 'rm -f -- "$1"', [path])
      else await rm(path, { force: true })
    },
    replace: async (records: unknown[]): Promise<void> => {
      const text = lines(records)
      if (remote) {
        await run(
          container,
          `umask 077; tmp=$(mktemp "$1.sele-XXXXXX") || exit; trap 'rm -f -- "$tmp"' EXIT; cat > "$tmp" && mv -- "$tmp" "$1"`,
          [path],
          text
        )
        return
      }
      const staged = `${path}.sele-${randomUUID()}`
      try {
        const file = await open(staged, 'wx', 0o600)
        try {
          await file.writeFile(text)
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(staged, path)
      } finally {
        await rm(staged, { force: true })
      }
    },
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
        lines(records)
      )
    }
  }
}

export const findCodexHistorySegments = async (
  path: string,
  threadId: string,
  container: AppContainerTarget | null | undefined,
  remote: boolean
): Promise<string[]> => {
  if (!/^[a-f\d-]+$/i.test(threadId)) return []
  let root = dirname(path)
  for (let directory = root; dirname(directory) !== directory; directory = dirname(directory)) {
    if (['sessions', 'archived_sessions'].includes(basename(directory))) {
      root = directory
      break
    }
  }
  if (remote)
    return (await run(container, 'find "$1" -type f -name "*$2*.jsonl" -print0', [root, threadId]))
      .split('\0')
      .filter((file) => file && file !== path)
  const files = await readdir(root, { recursive: true, withFileTypes: true })
  return files.flatMap((file) => {
    if (!file.isFile() || !file.name.includes(threadId) || !file.name.endsWith('.jsonl')) return []
    const candidate = join(file.parentPath, file.name)
    return candidate === path ? [] : [candidate]
  })
}
