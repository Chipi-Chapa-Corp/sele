import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RunClaudeSessionCommand } from './ClaudeRemoteSessionStore.ts'

export const claudeHistoryBlockSize = 64 * 1024
const remoteChunkBlocks = 16

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
    // Every command pays for a process and shell start. Fetch aligned 1 MiB chunks and
    // serve the reader's backward 64 KiB scan from them instead of one command per block.
    const chunks = new Map<number, Promise<Buffer>>()
    const fetchChunk = (chunk: number): Promise<Buffer> => {
      let pending = chunks.get(chunk)
      if (!pending) {
        pending = run(
          `
current=$(stat -c '%d:%i %s %Y %y' "$1" 2>/dev/null || stat -f '%d:%i %z %m %Sm' -t '%Y-%m-%dT%H:%M:%S' "$1") || exit 5
[ "\${current%% *}" = "$4" ] || exit 5
rest=\${current#* }
size=\${rest%% *}
[ "$size" -ge "$6" ] || exit 5
if [ "$size" = "$6" ]; then [ "$current" = "$5" ] || exit 5; fi
dd if="$1" bs=65536 skip="$2" count="$3" 2>/dev/null | base64
`,
          [
            path,
            String(chunk * remoteChunkBlocks),
            String(remoteChunkBlocks),
            identity,
            version,
            size
          ]
        ).then((data) => Buffer.from(data, 'base64'))
        pending.catch(() => chunks.delete(chunk))
        chunks.set(chunk, pending)
      }
      return pending
    }
    const chunkSize = remoteChunkBlocks * claudeHistoryBlockSize
    return {
      identity: `${path}:${identity}`,
      size: Number(size),
      modified: Number(modified) * 1000,
      version,
      read: async (offset, length) => {
        const end = Math.min(offset + length, Number(size))
        if (end <= offset) return Buffer.alloc(0)
        const first = Math.floor(offset / chunkSize)
        const last = Math.floor((end - 1) / chunkSize)
        const parts = await Promise.all(
          Array.from({ length: last - first + 1 }, (_, index) => fetchChunk(first + index))
        )
        const start = offset - first * chunkSize
        return Buffer.concat(parts).subarray(start, start + (end - offset))
      },
      close: async () => {},
      // Cached chunks cannot reveal a concurrent rewrite; re-check the file itself once.
      validate: async () => {
        const current = (
          await run(
            `stat -c '%d:%i %s %Y %y' "$1" 2>/dev/null || stat -f '%d:%i %z %m %Sm' -t '%Y-%m-%dT%H:%M:%S' "$1"`,
            [path]
          )
        ).trim()
        const [currentIdentity, currentSize] = current.split(/\s+/)
        return (
          currentIdentity === identity &&
          (Number(currentSize) > Number(size) || current === version)
        )
      }
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
