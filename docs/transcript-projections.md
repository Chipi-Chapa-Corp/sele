# Incremental live transcript projections

Provider transcripts remain authoritative. Derived projections live in the Electron main process,
inside the provider adapters. They are not persisted. Existing renderer paging, payload budgets,
IPC delta delivery, and acknowledgments still apply.

## Claude

`ClaudeTranscriptProjection` in `ClaudeItemRenderers.ts` consumes new committed records once.
It maintains turn boundaries, block-ID counters, tool-call lookups for the current segment,
and grouped working tails (50 groups, 50 tools per group). Group counts and dominant activities
include hidden tools. Aggregate source payload counts preserve lazy-loading budget decisions
without revisiting hidden payloads. The last assistant message is held separately so a later working event can
demote it without reconstructing earlier records.

SDK partial messages are mutable. Each read applies them as a temporary overlay through
`ProjectionJournal`, materializes the retained live tail, then rolls back all overlay mutations,
including IDs and tool results. A completed record replaces that overlay through normal committed
history ingestion. Replaced committed records, edits, and authoritative source replacement reset
the projection; this deliberately favors correctness over speculative reuse.

Live publications use this projection. Older pages and unloaded tool bodies are converted from
the requested records. Eight recently used session projections
are retained per adapter; disposal clears them. Projection metadata grows with its source history,
and each retained section keeps a bounded working tail. It is a derived cache, not a second durable
transcript database.

Sidebar discovery is paged separately through `ClaudeSessionCatalog`. It enumerates file names
and modification times, then reads metadata only for the requested page, with at most eight
summary reads in flight. Both local and remote summaries use bounded 64 KiB head/tail windows
and the SDK metadata parser; remote discovery batches file stats and never transfers complete
large transcripts. Cursors retain a stable, deduplicated candidate order per environment, so
background writes and overlapping refreshes cannot shift later pages. Hidden and non-resumable
sessions are skipped while filling the page. Independent environments run concurrently in the
worker. Candidate snapshots expire after five idle minutes and are capped at 64; a first-page
refresh takes a fresh file snapshot without waiting for all session summaries.

Opening a stored Claude chat now loads its latest ten turns through `ClaudeHistoryPages`, rather
than hydrating the full transcript before selecting a window. The reader walks backwards in
64 KiB file ranges until it has complete turns. It runs the existing SDK ancestry, compaction,
and sibling-block recovery on those records; cursor boundaries preserve the selected parent
branch. Local files use positioned reads; remote files transfer ranges rather than whole JSONL
files. A large selected turn or a distant ancestry link can require additional ranges.

Cursor state retains file identity, a snapshot boundary, a tail fingerprint, and page boundaries,
without caching historical message bodies. Appends preserve existing snapshot pages; replacement
or truncation rejects stale reads. The renderer uses the same two-page cursor buffer and anchor
restoration as Codex. It rejects delayed results after the requested cursor changes. A failed read
keeps the visible page and releases its loading state for retry.

Runtime state retains the opening page and subsequent live messages. Publications keep that tail
whole so its older cursor cannot skip newly streamed turns. Idle reopening refreshes the bounded
tail, with a persistence check to avoid replacing live output with a lagging CLI transcript.
Forks, edits, and explicit complete-history exports can still hydrate the full transcript on demand;
opening, scrolling, subagent listing's parent-state admission, and item lookup do not invoke that
loader. Export reads do not replace the runtime's cursor state.

`ClaudePaginatedOpening.test.mjs` exercises the actual adapter and file transport, measures bytes
read on an uncached open, and checks cursor round trips, live messages, idle reopening, and full
export isolation. `ClaudeHistoryPages.test.mjs` compares paged results with complete SDK recovery
and exercises local and shell-backed remote range transport. The private-display scroll fixture
covers both providers' pixel anchors, delayed/failed reads, cursor replacement, and history updates.

## Codex

`CodexTranscriptProjection` in `CodexItemRenderers.ts` retains a checkpoint immediately before the
last native item in each hot turn. The checkpoint includes bounded working groups, counts,
section state, and final-message selection indexes. Updating the last item replays that item;
appending an item replays the previous last item and the new suffix. Completed turns continue to
use the existing immutable turn cache.

`recordChanges.ts` records immutable array provenance. Indexed item updates establish which prefix
is unchanged, preserve uniqueness, and reuse ID indexes. Unknown snapshots, earlier replacements,
metadata changes, and steering that changes earlier final-answer placement trigger reconstruction.
Missing weak ancestry also reconstructs safely. At most sixteen hot-turn checkpoints are retained;
adapter disposal clears them. The projection is supplied only on bounded live publications.

## Limits and validation

This removes repeated native-to-UI conversion of unchanged history on ordinary live updates. It
does not make the entire pipeline constant time: immutable source arrays are still copied, some
provider metadata paths still inspect history, explicit history reads and invalidation can rebuild,
and rendering a very large current payload still costs work. Completion may also require a full
Codex turn conversion. These changes do not establish the cause of a renderer crash or blank screen.

The provider history test commands include reference-equivalence tests and deterministic work-count
checks with 100 and 10,000 prior records. Coverage includes partial rollback, tool results, steering,
final-message demotion, compaction, pending messages, replacements, branching source snapshots,
and terminal states. Run:

```sh
npm run test:claude-history
npm run test:codex-history
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/benchmarks/benchmark-transcript-projection.mjs
```

The benchmark measures conversion separately from source copying, provider transport, IPC, and UI
rendering. Its timings are informational; regression tests assert work counts rather than elapsed
milliseconds.
