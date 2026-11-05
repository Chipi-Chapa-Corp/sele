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
Publish streamed background summaries in interruptible React transitions so input can
take priority; acknowledgement and snapshot bookkeeping keep their existing ordering.

## Rendering

Known chats open from durable views. Optional retained React Activity trees reuse up to three
root conversations within a 30,000-element limit; hidden effects pause. Invalidation/eviction
releases them. Cached previews remain read-only until provider ownership refreshes.

Large turns mount items between paints. Markdown at 4,096 characters uses a shared worker,
and large HTML structures mount progressively. Preserve committed prefixes, DOM identity,
selection, and media while updates catch up. Sanitize HTML on the renderer; worker failure
falls back to escaped plain text. Cancel stale work on chat switches.
Prioritize new history initially, then serve jobs waiting over 250 ms in arrival order so
continuous streamed chunks cannot starve older turns. Keep one committed mount per paint.

Recents link extraction shares the Markdown worker. Send only the bounded recent messages,
discard superseded requests, and preserve the references array when links have not changed.
Parsing streamed Markdown must not run inside the workspace render path.

Draft edits stay in the composer. Model settings, workspace tools, and usage controls have
separate memoized boundaries and must not render on ordinary keystrokes. Keep their settings
and event handlers stable, while ensuring handlers always see current state.

Idle and unchanged sidebar searches reuse their results. Opening an empty search must not
filter or regroup the chat catalog. Grouping preserves unchanged project objects and arrays;
memo comparisons skip per-chat indicator checks when the indicator maps are unchanged.
Working-project membership stays stable while streamed text and timestamps change.

Responsive layout uses one shared media query and browser listener for all consumers.
Read the current breakpoint through React subscriptions and release the listener when the
last consumer unmounts; do not attach one browser listener per row.

Loading marks cache their geometry and use browser animation timelines; do not generate SVG
paths in per-icon animation-frame loops. Pause hidden marks and respond to reduced-motion
changes. Prefer transform/opacity for other animation work. An already focused composer
must not rescan the document or refocus its window when focus events arrive.

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
- `npm run test:renderer-performance` checks worker chat isolation, bounded streaming jobs,
  500 responsive consumers sharing one browser listener, and 60 animated marks without
  per-frame SVG writes. `test:composer-input` checks zero
  settings/tools/usage renders while typing with 2,000 models, plus focus, caret and selection.
- `test:workspace-navigation` also asserts zero regroupings when toggling empty search;
  use `SELE_BENCHMARK_CHAT_COUNT=1000` for the larger catalog. Departing inert animation
  rows are excluded when measuring current selection.

Run GUI fixtures on the [isolated display](README.md). Put output in `test-results/` or
`benchmark-results/`. Use `scripts/benchmarks/` for reproducible measurements; fixture timings
do not guarantee live-provider latency. Cold hydration, oversized turns, and explicit full
exports still require work. Diagnostic logs include periodic process-memory samples and the
latest sample on renderer crashes; an exit code alone does not establish their cause.
