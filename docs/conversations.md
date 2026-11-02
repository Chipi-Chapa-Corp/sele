# Conversations

## Opening and history

Provider transcripts are authoritative. SQLite `conversation_view` stores a bounded latest
viewport for each processed chat. Sidebar pages install these views before making rows
selectable, so selecting a known chat synchronously displays its messages without provider
I/O. Unknown chats need initial ingestion; the first view is committed before publication.

Views have no TTL or LRU eviction. Active writes coalesce over 250 ms; completion flushes
promptly and shutdown awaits writes. Codex and Claude use a shared account namespace for
history; credential bindings remain separate. Background refresh can update the view but
saved display data cannot grant sending, editing, or approval permissions. Failed refreshes
keep saved messages visible with a retry action. Delayed stored replies must not overwrite
newer live state.

Older history uses bounded cursor pages, with tool bodies loaded on expansion. Claude reads
file ranges through `ClaudeHistoryPages`; Codex uses native turn windows. Preserve cursor
identity and viewport anchors when appends or delayed replies arrive. Full-history reads are
reserved for operations such as export and must not replace the current paging state.

Live transcript projections are disposable adapter caches. Claude overlays mutable SDK
partials and rolls them back after publication; Codex replays changed item suffixes from
checkpoints. Authoritative replacement or edits invalidate projections. See
`ClaudeItemRenderers.ts`, `CodexItemRenderers.ts`, and `providers/transcriptProjection/`.

## Queued messages

`PersistentPendingMessages.ts` saves queued messages and unconfirmed steering in SQLite
`pending_messages`. Restore once when a chat first loads; publishing an unloaded chat must
not erase its saved queue. Provider history acknowledgements remove already-delivered
steering so it is not submitted twice. Attachments remain local paths.

Restored messages stay paused until the user acts. Steering retains priority over queued
messages. Sending resumes the queue; edit, delete, and per-message send controls still apply.

## Linked chats

Drag up to five other chats into the composer. Loading or failed context chips block Send;
cancelling a chip stops its preparation. Chips are not persisted with drafts.

`provider:prepare-linked-chat-context` creates a hidden fork without modifying the source.
Claude, Copilot, and OpenCode use native compaction summaries; Codex uses the configurable
summary prompt because its compaction output is encrypted. Forks inherit the source account.
Sending prepends the summaries as linked-chat context. Editing reuses the saved summaries;
a failed send restores the chips. See `linkedChatContext.ts` and `linkedChats.ts`.

## Codex restart recovery

`codexRuntime.cjs` owns a detached app-server connection scoped to profile, account,
environment, and executable/home. One authenticated UI can attach at a time. Closing Sele
detaches the UI; reopening restores ownership and reads history without replaying `turn/start`.
Idle workers exit after five minutes when no turns, requests, or RPCs remain.

Approvals and undispatched UI tools wait for reconnection. An already-dispatched client tool
with a lost result fails with an unknown outcome and is never replayed automatically. Output
uses backpressure rather than disconnecting on large replies. OS shutdown, runtime failure,
remote disconnect, or sandbox termination can still stop work. Other providers retain their
own process lifetimes.

Checks: `test:conversation-views`, `test:chat-state`, `test:pending-messages`,
`test:linked-chats`, and `test:codex-transport` via `npm run`. The full-app opening fixture is
`scripts/tests/test-persistent-chat-opening.cjs`. Run GUI portions with isolation as described
in the [repository guide](README.md).
