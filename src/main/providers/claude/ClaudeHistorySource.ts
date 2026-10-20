import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RunClaudeSessionCommand } from './ClaudeRemoteSessionStore.ts'

export const claudeHistoryBlockSize = 64 * 1024

export type ClaudeHistorySource = {
  identity: string
  size: number
  modified: number
  version?: string
  read: (offset: number, length: number) => Promise<Buffer>
  close: () => Promise<void>
  validate?: () => Promise<boolean>
}

/** Only range reads cross the remote transport; no cat of the complete transcript. */
export const openClaudeHistorySource = async (
  sessionId: string,
  run?: RunClaudeSessionCommand
): Promise<ClaudeHistorySource> => {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error('Invalid Claude session ID')
  if (run) {
    const output = await run(
      `
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/"$1.jsonl"; do
  [ -f "$path" ] || continue
  printf '%s\\n' "$path"
  stat -c '%d:%i %s %Y %y' "$path" 2>/dev/null || stat -f '%d:%i %z %m %Sm' -t '%Y-%m-%dT%H:%M:%S' "$path"
  exit 0
done
exit 4
`,
      [sessionId]
    )
    const newline = output.indexOf('\n')
    const path = output.slice(0, newline)
    const [identity, size, modified] = output
      .slice(newline + 1)
      .trim()
      .split(/\s+/)
    const version = output.slice(newline + 1).trim()
    if (newline < 0 || !identity || !Number.isSafeInteger(Number(size)))
      throw new Error('Invalid Claude transcript metadata')
    return {
      identity: `${path}:${identity}`,
      size: Number(size),
      modified: Number(modified) * 1000,
      version,
      read: async (offset, length) => {
        const block = Math.floor(offset / claudeHistoryBlockSize)
        const skip = offset % claudeHistoryBlockSize
        const count = Math.ceil((skip + length) / claudeHistoryBlockSize)
        const data = await run(
          `
current=$(stat -c '%d:%i %s %Y %y' "$1" 2>/dev/null || stat -f '%d:%i %z %m %Sm' -t '%Y-%m-%dT%H:%M:%S' "$1") || exit 5
[ "\${current%% *}" = "$4" ] || exit 5
rest=\${current#* }
size=\${rest%% *}
[ "$size" -ge "$6" ] || exit 5
if [ "$size" = "$6" ]; then [ "$current" = "$5" ] || exit 5; fi
dd if="$1" bs=65536 skip="$2" count="$3" 2>/dev/null | base64
`,
          [path, String(block), String(count), identity, version, size]
        )
        return Buffer.from(data, 'base64').subarray(skip, skip + length)
      },
      close: async () => {}
    }
  }
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  for (const project of await readdir(root)) {
    let file: Awaited<ReturnType<typeof open>>
    try {
      file = await open(join(root, project, `${sessionId}.jsonl`), 'r')
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
      throw error
    }
    const stat = await file.stat()
    return {
      identity: `${stat.dev}:${stat.ino}`,
      size: stat.size,
      modified: stat.mtimeMs,
      version: `${stat.mtimeMs}:${stat.ctimeMs}`,
      read: async (offset, length) => {
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await file.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      },
      close: () => file.close(),
      validate: async () => {
        const current = await file.stat()
        return (
          current.size >= stat.size &&
          (current.size > stat.size ||
            (current.mtimeMs === stat.mtimeMs && current.ctimeMs === stat.ctimeMs))
        )
      }
    }
  }
  throw new Error('Claude session was not found.')
}
