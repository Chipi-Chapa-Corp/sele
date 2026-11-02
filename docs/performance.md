# Performance

## Storage and updates

SQLite runs in a dedicated worker behind Kysely's single-connection transaction mutex.
Preferences use an independent worker and adjacent `sele.sqlite.preferences.sqlite` file
so close/save barriers cannot deadlock behind chat transactions. Write revisions prevent
delayed saves from replacing newer barriers. Legacy preferences migrate atomically;
corrupt storage fails without resetting it. Backups must include both databases and their
SQLite sidecars. WAL and FULL durability remain enabled.

Provider updates coalesce before publication. Codex batches immutable record edits, copying
each changed turn once per batch; reads flush pending work. Published snapshots must remain
immutable. Transcript projections reuse unchanged history; see [conversations](conversations.md).
Metadata/review caches invalidate on writes. Token accounting incrementally updates committed
ledger totals; streamed text does not wait for pricing I/O or rescan the whole ledger.

Chat sleep and terminal-activity subscriptions target the changed chat. Completion and rollback
use interruptible React transitions; selection and its prepared view commit together. Keep
background summaries from triggering full sidebar or transcript work.

## Rendering

Known chats open from durable views. Optional retained React Activity trees reuse up to three
root conversations within a 30,000-element limit; hidden effects pause. Invalidation/eviction
releases them. Cached previews remain read-only until provider ownership refreshes.

Large turns mount items between paints. Markdown at 4,096 characters uses a shared worker,
and large HTML structures mount progressively. Preserve committed prefixes, DOM identity,
selection, and media while updates catch up. Sanitize HTML on the renderer; worker failure
falls back to escaped plain text. Cancel stale work on chat switches.

Syntax-tree and diff caches bound both entries and estimated cost; oversized values render
without being retained. Snapshot ancestry uses weak references so keeping the newest stream
revision cannot retain all earlier revisions. Bounds and cache thresholds live in source.

## Checks and profiling

- `npm run test:performance-pipeline`, `test:chat-scaling`, and `test:chat-state` cover
  incremental work, paging, immutable snapshots, and rendering state.
- `npm run test:sqlite-worker` checks worker concurrency, durability, migrations, and recovery.
- `npm run benchmark:performance` and `benchmark:render-caches` measure synthetic hot paths.
- GUI fixtures: `test:active-chat-switching`, `test:streaming-composer`, `test:retained-chats`,
  `test:progressive-markdown`, and `test:message-continuity` via `npm run`.

Run GUI fixtures on the [isolated display](README.md). Put output in `test-results/` or
`benchmark-results/`. Use `scripts/benchmarks/` for reproducible measurements; fixture timings
do not guarantee live-provider latency. Cold hydration, oversized turns, and explicit full
exports still require work. Diagnostic logs include periodic process-memory samples and the
latest sample on renderer crashes; an exit code alone does not establish their cause.
