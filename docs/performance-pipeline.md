# Update and large-turn performance

This change addresses three remaining costs: accounting on every streamed update,
copying native records per event, and mounting an expensive individual turn.

## Update delivery and accounting

- Chat metadata and review reads use bounded, connection-scoped caches. Writes,
  review reassignment/deletion, bulk operations, and database reopening invalidate
  the appropriate reads. Failed or invalidated pending reads cannot repopulate them.
- Main-process view subscriptions cover multiple windows, unsubscribe, destruction,
  and shutdown. Background summaries skip token accounting. Selecting a chat during
  enrichment upgrades the outgoing detail before delivery.
- Active streaming uses the latest committed aggregate without awaiting ledger
  draining or pricing I/O. A missing aggregate hydrates asynchronously. Opening,
  explicit accounting requests, and completion updates retain durable reads.
- Loaded root/turn totals update from committed ledger row replacements and removals.
  Subagent membership, provisional replacement, unknown model estimates, and pricing
  changes retain their accounting semantics. Cold reads detect overlapping commits.
  Lineage changes and historical repricing rebuild affected source caches safely.
- Accounting caches retain at most 64 roots. Fallback quote reads are cached separately.
  Unpriced records use a partial index, cursor batches, and event-loop yields. A
  catalog/native-price revision retries previously unresolved estimates without
  rescanning them on every text update.

The native SQLite fixture verifies 50 warm accounting reads and 50 metadata/review
reads with no SQL, incremental root/subagent totals without history scans, immutable
published totals, provisional replacement, source fallback invalidation, cold-reopen
equivalence, and live reads while pricing remains unresolved.

## Native Codex record batching

Item starts/completions and text/output deltas queue immutable transformations.
Reading or iterating a thread, replacing it, or publishing an update flushes the
batch; deletion and shutdown discard queued work. Bursts are capped at 1,024 edits.
Native revisions advance immediately, so in-flight RPC reconciliation sees events
before a read materializes their snapshot. User echoes retain their existing prompt
and steering reconciliation path.

The record helper copies each changed turn array once per batch, and copies its ID
index once if the batch appends. Previously published snapshots and branches remain
immutable, with the earliest changed position retained for transcript projections.

Synthetic local median results for appending 100 records:

| Existing records | Snapshot per event | One batched snapshot |
| ---: | ---: | ---: |
| 1,000 | 22.2 ms | 0.09 ms |
| 10,000 | 204.2 ms | 1.07 ms |
| 100,000 | 1,115.0 ms | 11.11 ms |

These compare the two publication strategies in the current helper, not complete
provider sessions. Run `npm run benchmark:performance` to reproduce.

## Large turns and Markdown

Turns with more than 12 items or 24,000 message characters schedule their individual
items between paints. User prompts, pending messages, and the latest item remain
immediate. Existing turn keys, order, page coordinates, and mounted-item updates are
preserved.

Messages reaching 4,096 characters move parsing and syntax highlighting into one
shared worker. The worker coalesces superseded requests and is released after idle.
Small messages keep their synchronous cached path. Completed HTML is planned into
leaves of at most 8,192 characters or 100 elements where structural splitting is
possible. Oversized tables, lists, code blocks, and details retain their nested
structure while their children mount separately. Each leaf and structural shell is
sanitized on the renderer before insertion. The entity decoder is resolved to its
table implementation because its default browser implementation requires a DOM.

Mounted prefix nodes survive streaming updates; rendering keeps a shared footnote
and reference-link scope. Media, file links, tables, diagrams, and visualizations keep
their existing interactive behavior. Cancellation prevents an old chat's worker
result or deferred mounts from returning after a switch. Deferred subagent content
observes size changes to preserve its viewport without requesting another page.
Worker failure logs an error and displays the message as escaped plain text.

The isolated software-rendered fixture measured a 52,184-character single message
with 7,711 DOM nodes mounting in 118 stages, approximately a 17 ms maximum frame gap,
and no renderer long tasks. It also checks streamed selection and DOM identity,
completion, file links, a 600-row table, cross-block references/footnotes, exact
165,000-character code text, and cancellation. It runs against either the source
worker or the actual Vite-built production worker. These are controlled fixture
results, not live-session FPS guarantees. A single publication still copies its
native array/index, and cold history reads still require initial work.

## Reproduction

Pure Node checks:

```sh
npm run test:performance-pipeline
npm run test:chat-scaling
npm run test:codex-history
npm run test:chat-state
npm run build
```

Run Electron fixtures on the isolated-gui skill's private display and with their
disposable profiles. Do not run the real app or use the inherited desktop:

```sh
node scripts/tests/test-performance-accounting.cjs
node scripts/tests/test-progressive-markdown.cjs --built-worker
node scripts/benchmarks/benchmark-chat-rendering.cjs
node scripts/tests/test-message-selection.cjs
node scripts/tests/test-chat-scroll.cjs
```

Generated measurements and logs belong in `test-results/` or `benchmark-results/`.

The broader token-usage fixture reaches an obsolete OpenCode UI-tab assertion after
its native accounting checks. That same failure was reproduced from an untouched
`HEAD` archive. The subagent historical-page regression also reproduces in a control
with the new item scheduling and subagent resize observer removed; separate work in
the shared checkout changes retained conversation navigation. These failures must
not be reported as passing validation of this change.

Final verification: production build/typechecks; 15 pipeline, 224 Codex, and 192
renderer-state tests; native accounting integration; production-worker large-message
rendering; the existing chat-rendering benchmark; selection, scrolling, and opening
stability fixtures all passed. Electron fixtures used the private isolated-gui display.

The full checkout is not green: the scaling suite now has two Copilot harness failures
(`getCopilotCustomProviderSessionOptions` is absent from the extracted test context),
and global lint reports an unused import in the separate `scripts/e2e/harness.cjs`.
The workspace-navigation fixture also selects a retained hidden chat when expecting
the empty view; the older chat-opening fixture fails while clicking sidebar controls,
before reaching its Markdown assertions. Those files belong to separate changes in
this shared checkout and were left intact. The focused source checks for this update
have no lint errors. Raw logs are under `test-results/performance-*`.
