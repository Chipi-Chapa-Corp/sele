# Performance fixes

## Database execution and update scheduling — October 30, 2026

SQLite execution now runs in a dedicated worker, behind Kysely's existing SQLite
compiler and single-connection transaction mutex. Native statements, disk reads,
commits, checkpoints and schema migration no longer execute on Electron's main
thread during application operations. The worker caches at most 128 statements;
streaming uses bounded cursor batches and releases cursors on cancellation.
Binary rows, insert IDs, affected-row counts, transactions, savepoints and native
error codes retain their original semantics. Startup failures preserve the native
error message, reject pending requests and permit reopening after repair.

Preferences use an independent worker and adjacent
`sele.sqlite.preferences.sqlite` file. This prevents a document-close save barrier
from waiting behind a chat transaction whose completion needs the main event loop.
The worker owns write revisions, so a delayed asynchronous batch cannot overwrite
a newer close barrier. Legacy preferences copy atomically on first startup; the
original table remains untouched. Corrupt storage fails without resetting it.
Backups of application state should include both database files and their SQLite
sidecars while the app is running. WAL and FULL durability remain enabled.

Bookmark and terminal-activity subscriptions now address the changed chat key.
Aggregate sidebar consumers still receive aggregate changes. Idle terminal task
sources and snapshots are released instead of accumulating empty entries. Tests
cover 10,000 subscribers, reentrant subscription cleanup, and actual React row
renders: changing one bookmark or terminal status renders only its own row.

Completion updates, durable acknowledgements and rollback now run as interruptible
React transitions. Selection and its prepared view remain in the same update. The
previous urgent regroup forced an entire project's new sidebar rows into one task.
Animation and viewport-observer prototypes were discarded because they did not
produce a useful improvement; the existing layout and presence animations remain.

The updated production fixture with 1,000 chats measured no renderer long tasks.
Individual completions had maximum frame gaps around 16.8 ms; moving a 50-chat
project into Done peaked at 50 ms. The preceding urgent-update run recorded a
75 ms long task for the bulk operation. A separate 400-chat fixture with rich,
actively streaming conversations had no renderer long tasks or mixed-chat frames,
and a maximum frame gap of 33.4 ms. These are synthetic software-rendered checks,
not a claim of uninterrupted 60 FPS in every live session.
The development/StrictMode typing fixture also passed with five mixed-provider
streams, 400 chats and a 300-model catalog: no long tasks, retained focus, and
27.4–40.0 ms p95 input-to-frame delay, including a 16,144-character draft.

`npm run test:sqlite-worker` executes a real three-million-step SQLite query while
main-thread timers and preference writes continue. It also checks shared startup,
binary rows, concurrent writes, rollback, quoted savepoints, interrupted streaming,
legacy preference migration, close-barrier ordering, independent commits, reopen,
and corrupt-file preservation/recovery. Built-app fixtures passed committed writes
surviving SIGKILL, restart, close/quit barriers, terminal shutdown and corruption
refusal. Native integration fixtures passed accounting, persistent pages/views,
accounts, No Project, archives, reset queues, usage and project deletion.

The typechecked production build, affected state/pipeline tests and motion/media
regressions pass. Repository lint has no errors and retains 228 existing warnings.
The repository-wide error-logging audit still fails on 105 handlers; running the
same audit against HEAD reproduces the same 105 findings, with no new worker
handlers flagged. Raw logs and measurements are under `test-results/final-exam`.

Restart the application to load the new main-process worker architecture.

## UI continuity and persistence — October 29, 2026

The reported pauses and flashes exposed several independent lifecycle problems:

- Provider confirmation changed both the optimistic message key and its parent
  turn key. A renderer-only identity now follows that handoff and subsequent
  snapshots using weak references. Native IDs remain authoritative for edits,
  pagination and actions. Matching is ordered and checks the preceding user
  message, prompt and attachments to avoid claiming historical or unrelated rows.
- Crossing 4,096 message characters replaced the synchronous Markdown tree with
  a different component and a plain-text fallback. Small and worker-rendered
  messages now share the same bounded block tree. The committed formatted prefix
  stays mounted while the worker catches up; unchanged nodes and selection survive.
  Small messages remain synchronous and large leaves still mount between paints.
- Hiding a retained Activity released media leases and discarded its image-node
  index. Reconnection now reacquires leases while preserving decoded DOM. If an
  idle lease expired, old pixels remain until replacement media is available.
  Attached images also retain their selected preview during delayed file reads
  and provider confirmation that omits the preview URL.
- Marking a chat or project done waited for disk before updating the UI, and a
  late response could navigate away from a subsequently selected chat. Single
  and bulk completion now share an immediate UI update, durable acknowledgement,
  scoped rollback and mutation ordering. Draft release waits for successful saving.
- SQLite used rollback journaling on Electron's main thread for read markers,
  preferences, accounting and durable views. Initialization now enables WAL with
  `synchronous=FULL`, shares one migration promise across startup callers, and
  closes failed initialization cleanly. Duplicate/older read markers and unchanged
  preferences perform no writes. Metadata-only workspace renders also reuse the
  effective transcript window.

A disposable native benchmark on this project's filesystem (SQLite 3.53.2, 300
individual writes, FULL durability in both modes) measured:

| Journal | Median write | p95 write | Worst write | Total |
| --- | ---: | ---: | ---: | ---: |
| DELETE | 4.04 ms | 47.26 ms | 95.11 ms | 3,236 ms |
| WAL | 1.13 ms | 1.48 ms | 2.89 ms | 359 ms |

These are one controlled disk run, not live-session FPS measurements. To reproduce
on the intended filesystem, set `SELE_BENCHMARK_DATABASE_DIRECTORY` to an existing
scratch directory and run `node scripts/benchmarks/benchmark-database-writes.cjs`.
The default temporary directory can be memory-backed and produce very different
numbers. WAL/FULL retains durable commits; see [SQLite's WAL documentation](https://www.sqlite.org/wal.html)
and [synchronous modes](https://www.sqlite.org/pragma.html#pragma_synchronous).
The following October 30 work moves these operations into workers; WAL reduces
durable-write cost within those workers.

Regression entry points:

- `npm run test:message-continuity`: actual turn/message rendering, delayed image
  reads, provider reconciliation, send landing, Activity reconnect and expired leases.
- `npm run test:progressive-markdown`: includes threshold-crossing DOM/image/selection
  continuity, huge messages, tables, exact code text, cancellation and production workers.
  `node scripts/tests/test-progressive-markdown.cjs --baseline-threshold` loads the
  original renderer from HEAD and reproduces the detached-prefix assertion failure.
- `npm run test:done-chats`: immediate completion, failure rollback, overlapping undo,
  bulk changes, startup migration sharing, WAL/FULL and no-op database writes.

Run Electron fixtures through isolated-gui with disposable profiles. A full app
restart is required for the database configuration change.

Validation included the typechecked production build, affected state/provider/
accounting/persistence suites, actual preference writes surviving SIGKILL and
restart, and private GUI checks for motion, selection, quoting, scrolling,
opening stability, media playback/cache behavior and the built Markdown worker.
The 52,184-character rendering fixture mounted 7,711 nodes in 118 stages, with
a 16.8 ms maximum frame gap and no renderer long tasks in the measured run.

The production workspace fixture with 400 chats and two rich active streams had
no renderer long tasks, a 33.4 ms maximum frame gap, and no mixed-chat frames.
Rapid navigation retained the final selection and spinner, with a 16.8 ms maximum
frame gap. At this stage the 1,000-chat empty-history fixture recorded a 58 ms task during
bulk project completion; the October 30 scheduling fix above addresses this path. Development/StrictMode profiling at that stage also recorded
occasional long tasks. These earlier measurements and the follow-up above do not
establish that every live-session pause is gone. They use software rendering and
mock provider APIs, so the disk benchmark is reported separately.

## September 2026 audit

Six issues found in the performance audit are addressed:

1. **Subagent history delivery.** Subagent views use ten-turn pages and the same working-step,
   tool-output, attachment, and message payload limits as ordinary conversations. Older/newer
   controls retain access to history and expanded tool results. Polls cannot replace a page
   selected by an overlapping navigation request. Provider renderers convert the selected turns;
   Codex also hydrates only selected native turns after discovering the child-history boundary.
2. **Codex command ordering.** A linear no-change check and indexed reordering replace repeated
   array scans. Randomized equivalence tests preserve the previous ordering and turn barriers.
3. **Codex transcript metadata.** Goal prompts and command start times share an incremental index.
   It reads 128 KiB chunks, yields between chunks, handles partial UTF-8/JSON records and file
   replacement, and caches compact metadata for sixteen sources. Latest pages can render before
   optional enrichment. Remote reads stay attached to the correct app-server filesystem.
4. **Copilot live events.** An ID and timestamp index replaces full-history reconciliation on
   each event. Unpublished event batches share a working array; publication seals that array so
   projections and previously returned snapshots remain immutable. Reloads rebuild the index.
5. **Provider history navigation.** Copilot and OpenCode share initial hydration and reuse it for
   unchanged history pages and item lookups. Metadata changes and reconnects trigger refreshes.
   OpenCode sidebar previews request only eight messages, and repeated child-history polls reuse
   hydration. Events arriving during an RPC refresh retain precedence over stale snapshot fields.
6. **Claude transcript retention.** Inactive session states use an eight-entry LRU and an estimated
   32 MiB transcript budget. Eviction releases projections and delayed metadata timers. Live
   queries, queued work, approvals, background tasks, startup and completion remain protected.
   Reopening an evicted session reloads history with its remembered container and query settings.

## Reproducible measurements

Run `npm run benchmark:performance`. The script uses synthetic records and makes no provider
requests. Representative local results (milliseconds are medians):

| Workload | Previous path | Updated path |
| --- | ---: | ---: |
| Prepare a subagent snapshot with 1,000 tools and 10,000 output characters per tool | 20,297,836 bytes | 21,007 bytes |
| Append 100 events to 100,000 Copilot history records | 1,079.6 ms | 10.3 ms, including index construction |
| Append 100 events to 10,000 Copilot history records | 84.5 ms | 0.7 ms, including index construction |

The updated command-ordering benchmark processes 30,000 commands in approximately 0.6 ms when
already ordered, or 61 ms for reversed timestamps. Timing varies by machine and load; regression
tests also assert bounded payload visits and provider request counts rather than timing alone.

A subsequent [Codex comparison against committed main](codex-performance-comparison.md)
measures elapsed time and event-loop stalls for both revisions, with raw samples and an opt-in
performance assertion. Run it with `npm run benchmark:codex-revisions -- --assert-improvement`.

## Validation and remaining costs

Regression coverage includes renderer paging, IPC payload bounds, native turn boundaries,
incremental file reads, immutable event publication, authoritative/live reconciliation, navigation
transport counts, LRU eviction, reopening, concurrent loads and disposal. The new tests are wired
into the existing provider and chat-scaling test commands.

Final integration run: 406 provider, renderer, and error-handling tests passed. Node and web
typechecks, the production build, and the UI responsiveness check passed. Repository lint has
no errors and retains 22 existing warnings. The 300-row UI fixture measured a 12.1 ms median
render and a 26.5 ms maximum typing-to-frame delay on this machine.

Cold provider hydration and a first metadata scan still require reading existing history. An old
remote Codex server without the bounded command transport falls back to a full file transfer when
the file changes, while caching unchanged reads and parsing only the appended suffix. A single
oversized idle Claude transcript is retained to avoid thrashing; active work is outside the idle
budget. The byte budget estimates transcript storage, not the entire Electron process heap.

Explicit expansion of an old nested tool page can still convert the full provider history in
Claude, Copilot and OpenCode. These on-demand responses are bounded at IPC; Codex additionally
uses a native turn lookup for that path. Normal subagent page loads and polls use turn windows.

OpenCode sessions with a generic provider title keep that title in the sidebar until opened;
sidebar previews no longer fetch every message merely to derive a title from the first prompt.
