# Per-chat accounts

Codex and Claude chats save their account selection. A chat picker changes that chat;
Settings and the new-chat picker change the default for future chats. Older discovered
chats bind to the default on first encounter. Forks, including linked-chat summaries,
inherit their source account. Native history stays shared.

`ChatAccounts.ts` pools runtimes by account and environment. Retries, queued sends,
approvals, subagents, edits, usage, and model discovery route through the saved binding.
Missing credentials fail without using another account. Switching drains the chat's pending
operations and stops its turn; other chats retain their sessions. Codex must receive
`thread/closed` after unsubscribe before saving the new binding: the unsubscribe reply
alone does not release its writer lock. A failed handoff keeps the previous binding.

## Credential isolation

Codex uses account shadow homes on Linux, macOS, and Windows. Existing
`<CODEX_HOME>/sele/accounts/<id>` credentials are retained, and Codex owns login/refresh.
`CodexAccountView.ts` and `CodexShadowHome.ts` prepare the selected `CODEX_HOME` with private
file-backed credentials and links to canonical sessions, config, skills, plugins, memories,
and writer locks. SQLite stays shared through `CODEX_SQLITE_HOME`. Authentication locks,
model caches, and temporary files stay private; conflicting files/links fail without being
overwritten. Discovery and updates use the canonical home.

Windows requires Developer Mode or symbolic-link permission. No privileged helper is used;
legacy installed helpers are left on disk. POSIX launchers track default changes for
unbound settings sessions while chat runtimes remain pinned. Windows settings changes
reset the unbound runtime.

Claude selects only its credential store through `CLAUDE_SECURESTORAGE_CONFIG_DIR`; chats,
settings, plugins, and memory remain shared. Managed accounts clear inherited API/OAuth
token overrides. The default account uses existing CLI authentication. Usage caches remain
per account. See `ClaudeAccountStore.ts` and the root [setup guide](../README.md).

## Checks

- `npm test -- ChatAccounts CodexAccount ClaudeAccount`: routing, storage, and credential isolation.
- `npm run test:runtime -- codex-account-handoff`: installed Codex with fixture keys/history;
  checks shared state, writer exclusion, and repeated handoffs without inference. Set
  `SELE_TEST_CODEX_NATIVE=1` for the shell-free launch path used on Windows.
- `npm run test:ui -- chat-account-switch account-limits`: picker, IPC, usage, and saved bindings; run with [GUI isolation](README.md).
