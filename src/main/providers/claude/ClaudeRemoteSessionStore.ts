import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import { isExpectedCommandAbsenceError } from '../../../shared/expectedAbsence.ts'

export type RunClaudeSessionCommand = (script: string, args?: string[]) => Promise<string>
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** SDK-compatible transcript access; the caller chooses the process that reads/parses it. */
export class ClaudeRemoteSessionStore implements SessionStore {
  constructor(private readonly run: RunClaudeSessionCommand) {}

  listSessions = async (): Promise<Array<{ sessionId: string; mtime: number }>> => {
    const output = await this.run(`
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/*.jsonl; do
  [ -f "$path" ] || continue
  file=\${path##*/}
  session=\${file%.jsonl}
  modified=$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path" 2>/dev/null || echo 0)
  printf '%s\\t%s\\n' "$session" "$modified"
done
`)
    return output.split('\n').flatMap((line) => {
      const [sessionId, seconds] = line.split('\t')
      const mtime = Number.parseInt(seconds ?? '', 10) * 1_000
      return sessionId && Number.isFinite(mtime) ? [{ sessionId, mtime }] : []
    })
  }

  load = async (key: SessionKey): Promise<SessionStoreEntry[] | null> => {
    const output = await this.run(
      `
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
if [ -n "$2" ]; then
  suffix="$1/$2.jsonl"
else
  suffix="$1.jsonl"
fi
for path in "$root"/*/"$suffix"; do
  [ -f "$path" ] || continue
  cat "$path"
  exit 0
done
exit 4
`,
      [key.sessionId, key.subpath ?? '']
    ).catch((error: unknown) => {
      if (isExpectedCommandAbsenceError(error, [4])) return null
      throw error
    })
    if (output === null) return null
    return output.split('\n').flatMap((line): SessionStoreEntry[] => {
      if (!line.trim()) return []
      try {
        const entry: unknown = JSON.parse(line)
        return isRecord(entry) && typeof entry.type === 'string' ? [entry as SessionStoreEntry] : []
      } catch (error) {
        console.error('Unable to parse a Claude remote transcript entry.', error)
        return []
      }
    })
  }

  listSubkeys = async (key: { projectKey: string; sessionId: string }): Promise<string[]> => {
    const output = await this.run(
      `
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/"$1"/subagents/*.jsonl; do
  [ -f "$path" ] || continue
  file=\${path##*/}
  printf 'subagents/%s\n' "\${file%.jsonl}"
done
`,
      [key.sessionId]
    )
    return output
      .split('\n')
      .map((subpath) => subpath.trim())
      .filter(Boolean)
  }

  append = async (key: SessionKey, entries: SessionStoreEntry[]): Promise<void> => {
    if (key.subpath) throw new Error('Claude subagent session writes are unavailable remotely.')
    const payload = entries.map((entry) => JSON.stringify(entry)).join('\n')
    await this.run(
      `
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/"$1.jsonl"; do
  [ -f "$path" ] || continue
  printf '%s\\n' "$2" >> "$path"
  exit 0
done
exit 4
`,
      [key.sessionId, payload]
    )
  }
}
