# Conversations

## Opening and history

Provider transcripts are authoritative. SQLite `conversation_view` stores the processed
message list for each chat. Sidebar discovery returns only metadata. Opening a chat
reads its saved messages locally alongside the provider refresh; warm in-memory views display
synchronously. Do not preload every saved transcript to construct the sidebar. Unknown chats
need initial ingestion; the first view is committed before publication.

SQLite stores the processed message list with full message text, attachments, ordering,
and history-page coordinates. Openings read that same list directly; there is no separate
last-message or truncated-text preview. Hidden tool bodies still load on expansion.
Every chat opens at the bottom. Scroll positions and follow-latest flags are not persisted.

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

## Background state recovery

Known-chat and native sidebar discovery schedule background reconciliation for active,
interrupted, failed, and unresolved conversations across Codex, Claude, Copilot, and
OpenCode. Two bounded latest-turn reads run at a time through the normal account- and
environment-scoped history APIs. Updated details flow through the usual sidebar and durable
view publication pipeline without selecting the chat. Unchanged discoveries coalesce;
superseded reads, changed account scopes, and shutdown cannot publish stale recovery data.
Failures retain the saved view and may retry on subsequent discovery. Recovery sends no
prompts and leaves restored queues paused. Provider runtimes retain their own lifetimes:
reading a stopped session does not restart its model turn.

## Codex restart recovery

`codexRuntime.cjs` owns a detached app-server connection scoped to profile, account,
environment, and executable/home. One authenticated UI can attach at a time. Closing Sele
detaches the UI; reopening restores ownership and reads history without replaying `turn/start`.
Idle workers exit after five minutes when no turns, background terminals, approvals, or RPCs remain.
Restoring a runtime also refreshes its background terminal controls.

Account discovery reattaches each configured Codex account's retained worker in the
background, once per account and execution environment. Sidebar discovery also checks saved
chat account bindings. Recovery reads and publishes the worker's chat state without waiting
for a chat to be selected; this includes retained chats beyond the first sidebar page.
Missing workers are left stopped. Recovery never launches a replacement worker or sends a
new turn, and restored queued messages remain paused.

Desktop workspace terminals use a separate detached PTY owner. Restarting Sele restores their
tabs in the original workspace, with bounded scrollback and the same shell, input, and resize
controls. Closing a tab explicitly stops its shell. Phone terminals still close on disconnect.
This applies to sessions created by this version; a process already orphaned by an older
version has no PTY to reconnect to and needs a fresh terminal session. OS shutdown and
terminal-owner failures can still end a session.

Approvals and undispatched UI tools wait for reconnection. An already-dispatched client tool
with a lost result fails with an unknown outcome and is never replayed automatically. Output
uses backpressure rather than disconnecting on large replies. OS shutdown, runtime failure,
remote disconnect, or sandbox termination can still stop work. Other providers retain their
own process lifetimes.

Marking a chat done stops its active work, subagents, and background terminal commands
before saving the done flag. Bulk completion uses the same cleanup. On Linux, cleanup also
finds detached helpers by their exact inherited chat environment marker, including Codex
processes left behind before a Sele restart. It checks the user and process start time before
signalling, allows graceful termination, then force-kills surviving processes. Cleanup runs
in the chat's saved host/container/SSH environment and requires Python 3 there. Native
provider cancellation remains available on other platforms. Undoing done does not restart
processes. Cleanup errors leave the chat unfinished so the action can be retried.

## Chat process ownership

New execution runtimes for Codex, Claude, Copilot, and OpenCode are scoped to one
chat and its saved account and execution environment. Forks receive their own runtime;
provider-created subagents remain descendants of the parent runtime. Discovery and
account utilities use separate runtimes. Codex's retained-worker identity includes
the ownership scope, so reconnecting never attaches one chat to another chat's worker.

On Linux with cgroup v2, Python 3, and a reachable systemd user manager (systemd 250+),
provider launches use recorded transient services with `ExitType=cgroup` and
`KillMode=control-group`. Ordinary descendants remain members after `nohup`, `setsid`,
reparenting, or clearing their environment. Receipts under `provider-processes-v1` in
the Sele profile record the exact units and target environment before launch. A
private target-side launch permit prevents delayed starts after cleanup. A missing
permit after an OS restart retires the old boundary; the next execution gets a fresh one.

The **Chat processes** button in the terminal toolbar lists kernel cgroup members
with their PID, command, and working directory. With no chat selected, it lists all
recorded launches, including launches that have not been assigned a chat. **Open log** is available when a
process's stdout or stderr is a regular file; it tails that exact file in a new
terminal. It does not recreate an interactive session for a process that discarded
its terminal. Existing provider terminal attachments continue to use their original
streams. **Stop all** cancels native work and scheduled retries, then stops the chat's
owned services. Marking the chat done uses the same ownership cleanup.

When the required manager or tools are unavailable, the provider can still run and
the process panel explicitly reports **Tracking unavailable**. A previously tracked
boundary never silently switches to untracked execution. Processes started before
this feature have no ownership receipt; their existing environment-marker cleanup
remains a best-effort compatibility path. Deliberate cgroup migration and work
submitted to external daemons or remote hosts are outside a local descendant boundary.
This is lifecycle ownership, not a security sandbox.

Checks: `npm test -- ProviderProcessStore ChatProcessRuntimes chatProcessCleanup conversationViews renderer/src/ PersistentPendingMessages
PendingMessageRestore linkedChats CodexAppServerClient CodexRuntime` and
`npm run test:integration -- database` cover state and storage.
The full-app opening fixture is
`scripts/tests/test-persistent-chat-opening.cjs`. Run GUI portions with isolation as described
in the [repository guide](README.md).

The opt-in `providerProcessCgroups` regression uses fixture providers to verify a
real environment-cleared `setsid` child, receipt recovery, and cleanup that preserves
a second chat. Run it with `SELE_TEST_PROCESS_CGROUPS=1` inside an isolated session
with its own systemd user manager. It skips when that private manager is unavailable;
it must never use the user's session bus as a fallback. `test:ui -- terminal-actions`
covers the process list, exact log paths (including shell metacharacters), and Stop all.
