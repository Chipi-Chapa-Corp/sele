import { parseClaudeSessionSummary } from './ClaudeSessionSummary.ts'
import type { ClaudeSessionCandidate } from './ClaudeSessionCatalog.ts'
import type { RunClaudeSessionCommand } from './ClaudeRemoteSessionStore.ts'

export const listRemoteClaudeSessionCandidates = async (
  run: RunClaudeSessionCommand
): Promise<ClaudeSessionCandidate[]> => {
  const output = await run(`
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
[ -d "$root" ] || exit 0
if stat -c '%Y' "$root" >/dev/null 2>&1; then
  find "$root" -mindepth 2 -maxdepth 2 -type f -name '*.jsonl' -exec sh -c 'stat -c "$0" "$@" 2>/dev/null || true' '%Y\t%n' {} +
else
  find "$root" -mindepth 2 -maxdepth 2 -type f -name '*.jsonl' -exec sh -c 'stat -f "$0" "$@" 2>/dev/null || true' '%m\t%N' {} +
fi
`)
  return output.split('\n').flatMap((line) => {
    const separator = line.indexOf('\t')
    const path = line.slice(separator + 1)
    const sessionId = path.slice(path.lastIndexOf('/') + 1, -6)
    const mtime = Number(line.slice(0, separator)) * 1000
    return separator > 0 && /^[a-f0-9-]{36}$/i.test(sessionId) && Number.isFinite(mtime)
      ? [{ sessionId, mtime, path }]
      : []
  })
}

/** Same head/tail budget as the local SDK; never transfer or parse a full large transcript. */
export const readRemoteClaudeSessionInfo = async (
  candidate: ClaudeSessionCandidate,
  run: RunClaudeSessionCommand
) => {
  const output = await run(
    `
[ -f "$1" ] || exit 0
size=$(stat -c %s "$1" 2>/dev/null || stat -f %z "$1") || exit 1
printf '%s\\n' "$size"
head -c 65536 "$1" | base64 | tr -d '\\n'
printf '\\n'
tail -c 65536 "$1" | base64 | tr -d '\\n'
printf '\\n'
sidecar="\${1%.jsonl}/custom-title.json"
if [ -f "$sidecar" ]; then head -c 65536 "$sidecar" | base64 | tr -d '\\n'; fi
printf '\\n'
`,
    [candidate.path]
  )
  if (!output) return undefined
  const [size, encodedHead, encodedTail, encodedTitle] = output.split('\n')
  return parseClaudeSessionSummary(
    candidate.sessionId,
    Number(size),
    Buffer.from(encodedHead, 'base64'),
    Buffer.from(encodedTail, 'base64'),
    encodedTitle ? Buffer.from(encodedTitle, 'base64') : undefined,
    async (target) =>
      (await run(
        `
path="\${1%/*}/$2.jsonl"
if [ -f "$path" ]; then
  if { head -c 65536 "$path"; tail -c 65536 "$path"; } | grep -q '"parentUuid":'; then printf yes; fi
fi
exit 0
`,
        [candidate.path, target]
      )) === 'yes'
  )
}
