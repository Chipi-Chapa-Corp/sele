# Chat scaling investigation

Initial investigation: 2026-09-19, before implementation. See the 2026-09-20 implementation and regression results below.
The measurements below use synthetic local data, not provider requests. An affected
chat and an interaction trace were not available, so these are confirmed scaling
defects and candidate explanations, not a claim to have reproduced a specific user's
scrolling stall.

## Findings

### Row pagination

`workingStepLazy.ts:groupWorkingStepItems` already groups a complete step before
counting and slicing it. The bounded Codex and Claude live projections also count
groups. Thus raw tool counting is not universal in this checkout.

There is an unsafe boundary: `groupWorkingStepItems` skips grouping when a step
already has segments, a nonzero start index, or a total greater than its materialized
length. It assumes those coordinates already represent grouped rows. Meanwhile,
`ChatDetailItem.tsx:WorkingStep` groups each loaded segment again after slicing,
and its load labels use item coordinates rather than the resulting block count.

The benchmark reproduces the mismatch by passing a partially materialized raw step:
50 returned items, total 120, but one grouped display row. The complete-step control
correctly reports one row for 120 consecutive tools. The exact reported “50 becomes
3” case still needs its actual payload; this synthetic input establishes the failure
mode, not that a current provider necessarily produces that input.

Other distinctions matter: tool sequences have their own child pagination; generated
images may appear outside the working section; the retained history window can evict
older loaded rows when a new page arrives. “50 loaded” is not necessarily 50 net new
rows or 50 text lines.

**Recommended design:** use one canonical, versioned row index before pagination.
Give every visible message, compact tool, and collapsed tool sequence a stable row
identity. Maintain sequence child indexes and counts separately. Incrementally update
the open sequence as records arrive; keep only bounded row and child payload windows.
Use these same row coordinates for initial snapshots, live updates, page requests,
merges, retention, and labels. Do not regroup arbitrary raw pages in the renderer.

This avoids full-history reads per click. Exact counts of previously unindexed,
filtered history still require an initial scan or a persisted index: a tail alone
cannot reveal those counts. Build metadata during existing ingestion, persist it if
needed, and use cursor/has-more labels until it is known. Do not fetch repeatedly
until 50 visible rows appear; that can scan an arbitrarily large hidden sequence.

### Pagination often happens after expensive conversion

`providerService.ts:getProviderChatWindow` falls back to `adapter.getChat` and only
then slices turns. Claude, Copilot, and OpenCode do not implement `getChatWindow`.
Their ordinary reads therefore construct full details before this boundary.

Claude's `createChatDetail(state)` defaults to full `renderClaudeChatItems`; only
the `windowed=true` update path uses its incremental projection. Copilot's
`createChatDetail` renders all `state.events`; OpenCode's `createChatDetailFromState`
renders all `state.messages`, including during update emission. Windowing the final
IPC payload does not eliminate that earlier work.

`registerProviderIpc.ts:getChatDetailContainingWorkingStep` also calls ordinary
`getChat` before locating a requested working section. Even loading one item or
one tool page can therefore pay for unrelated history conversion. Older sections
can require a second lookup after the latest read.

**Fix direction:** direct provider row/working-item page APIs backed by the canonical
index. Add true bounded reads to the adapters, and make updates and sidebar summaries
reuse projections instead of full transcript conversion.

### A bounded number of turns is not a bounded amount of work

Codex normally reads bounded turn pages, but a single turn can contain arbitrarily
many raw records. `loadChatCursorWindowInContext` calls `createChatDetail` without
`workingItemTailLimit`; this disables its incremental projection and converts all
records in selected active turns before `prepareChatDetailForRenderer` trims them.
Finished turns have an identity cache, so repeated unchanged finished reads can be
cheaper; this does not protect a changing active turn or newly hydrated objects.

Codex live updates do use a bounded projection. However:

- `recordChanges.ts:updateIndexedTranscriptRecord` copies the entire native record
  array on replacement and append; append also copies the complete ID map.
- `CodexSubagents.ts:getCodexTurnSubagents` scans every native item in the selected
  turns whenever details are constructed, even with no subagents.
- Projection provenance loss, earlier-record changes, or relevant metadata changes
  can force reconstruction. This is correct fallback behavior, but not constant cost.

**Fix direction:** separate indexed native storage from bounded immutable display
snapshots, using chunks or another structure that avoids whole-array/map copies.
Maintain subagent summaries incrementally. Use bounded projections for ordinary
page reads too, with direct access to historical row payloads.

### Goal labels can read and parse the entire Codex transcript

`CodexProviderAdapter.ts:loadGoalPrompts` requests the full transcript file and
base64-decodes it. `CodexGoalPrompts.ts:readCodexGoalPrompts` splits and JSON-parses
every line. Normal chat reads await this enrichment. Update emission triggers it
asynchronously; parsing still executes synchronously on the main process.

This path is conditional: candidates have no user message and no cached prompt or
completed negative result. A missing prompt in an active eligible turn can retry
after one second. It is not a claim that every update rereads every transcript.

**Fix direction:** incremental file offsets or an indexed goal-envelope store;
avoid blocking first display on optional labels. Moving parsing to a worker can
reduce main-thread stalls but does not eliminate repeated whole-file work.

## Local measurements

Run `node --experimental-strip-types scripts/benchmarks/benchmark-chat-scaling.mjs`.
Times are warmed medians in milliseconds, measured on this machine. Counts refer
to native records; the Claude fixture alternates short user/assistant messages,
while Codex uses one long active tool turn. These are component CPU benchmarks,
not frame timings or complete app latency.

| Operation | 1,000 records | 10,000 records | 100,000 records |
| --- | ---: | ---: | ---: |
| Codex full active-turn conversion then renderer preparation | 4.563 | 16.481 | 165.461 |
| Claude full history conversion then renderer preparation | 1.250 | 4.605 | 52.284 |
| Indexed record append, including array/map copying | 0.099 | 0.736 | 9.008 |
| Indexed record replacement | 0.005 | 0.029 | 0.256 |
| Subagent scan with no subagents | 0.017 | 0.047 | 0.430 |
| Goal transcript parsing, excluding I/O and base64 decoding | 0.786 | 6.987 | 63.137 |

The goal fixtures are approximately 0.3, 3.2, and 31.8 MB. The subagent scan and
record replacement are individually small here; full conversion and repeated
goal parsing are stronger candidates for obvious stalls. Main-process blocking
can delay page replies and update delivery; it does not alone prove a compositor
or renderer scrolling problem.

## Validation and next implementation order

All 24 existing tests in the Codex/Claude transcript projection, transcript record
changes, and chat detail window suites passed. Their bounded-record-visit assertions
cover projection internals, not the full update pipeline, array copying, enrichment,
or ordinary page reads. Passing them does not establish constant-cost chat behavior.

1. Make ordinary and nested page reads bounded before conversion.
2. Unify row coordinates and add integration coverage from provider snapshot through
   page merge to displayed row count, including sequence boundaries and retention.
3. Remove repeated full goal-transcript reads and native array/map copies.
4. Profile an affected chat during opening, paging, streaming, and idle scrolling
   separately. Measure main-process tasks, renderer long tasks, IPC payloads, mounted
   rows, and allocations at a fixed visible window across history sizes.

The source establishes why similarly sized visible pages can have very different
costs in Sele. Attribution of the reported chat's exact lag and row-count mismatch
remains open until its provider/payload or an interaction trace is available.


## Implementation and unchanged regression results — 2026-09-20

Baseline revision: `3a12d5bd91fd626664a48d7ff6abd28f46f688de`.

The first six regression tests were run before production edits: all failed. Four
additional tests execute the actual adapter methods (with session transport and
unrelated metadata isolated), and one exercises repeated tool-page preparation.
All eleven were also executed against a clean archive of the baseline revision:
**0 passed, 11 failed**. The same test files run against the implementation pass.
Their SHA-256 hashes were checked after implementation; assertions, fixtures, and
thresholds were not changed to get a passing result.

The dedicated command is:

```sh
npm run test:chat-scaling
```

Final validation: **17/17 dedicated scaling/compatibility tests, 190/190 provider
tests, and 58/58 renderer-state tests passed**. Node and web TypeScript checks
passed. Lint completed without errors (three existing hook-dependency warnings).

It runs those eleven regression cases plus six compatibility cases covering page
coordinates, lifecycle states, queued messages, cross-turn binary assets, metadata
index invalidation, and startup/control records. The tests measure payload accesses
and exact output, not wall-clock thresholds. They cover histories up to 20,000 turns
and a 20,000-tool collapsed sequence.

| Confirmed baseline failure | Before | After |
| --- | --- | --- |
| Claude adapter: ten-turn page from 2,000 turns | 8,000 assistant payload accesses | At most 100; exact ten-turn page |
| Copilot adapter: same | 6,000 accesses | At most 100; exact ten-turn page |
| OpenCode adapter: same | 2,000 accesses | At most 100; exact ten-turn page |
| Codex: repeat construction of unchanged 2,000-tool active turn | 12,000 command accesses | 0 |
| Provider-neutral row coordinates before trimming | 2,520 raw items for 240 rows | 240 rows; stable 50-row pages |
| Reopen one collapsed sequence with 20,000 tools | 40,150 payload accesses | At most 200; same output, 50 loaded children |

The four direct renderer regressions also verify exact ten-turn output at both
200 and 20,000 turns, for tail and historical pages, with separate reference
objects so cache hits cannot hide full-history conversion.

### Changes

- Added native turn-boundary indexing and bounded conversion for Claude, Copilot,
  and OpenCode navigation. Reuse known unchanged prefixes after record reconciliation.
  The first index build reads boundary metadata, not all assistant/tool payloads.
- Wired bounded paths into provider adapters, Copilot/OpenCode updates, and relevant
  sidebar summaries. Explicit full-history consumers retain their old entry points.
- Working-section reads now locate the requested item window directly. Added fast
  native-ID lookup paths, including cached Codex turns; unusual synthetic IDs retain
  the full-conversion fallback for correctness.
- Cached unchanged Codex active-turn conversion separately from the live incremental
  projection, keeping the existing projection/reference tests independent.
- Canonicalized shared conversation rows before attaching row coordinates. Legacy
  full native-tool consumers explicitly request raw items without row coordinates;
  renderer preparation still groups these before trimming.
- Removed the renderer's second grouping pass after slicing/extracting image rows.
  Page coordinates now remain authoritative in the display.
- Preserved canonical tool-group identity and memoized immutable working-item
  payload counts, avoiding repeated traversal of hidden tool children.

### Evidence and scope

Raw logs from this investigation were local artifacts and are not retained in the
repository. Use the gitignored `test-results/` directory for new runs.
The original investigation benchmark remains available for exploratory measurements;
its old timings are baseline results, not expected current timings after caching.

These tests establish that the reproduced conversion, repeated payload traversal,
and row-coordinate defects are fixed. They do **not** establish that every source
of huge-chat lag is gone. Native SDK hydration, first-time metadata indexing,
Codex record-array/map copying, conditional whole-file goal enrichment, and
conversion of a changing enormous individual turn outside an incremental projection
are not eliminated by this patch. No affected-chat UI/FPS trace was available.

Frozen regression file hashes:

- `chatScaling.regression.test.mjs`: `95259175a46aaea669eff7fa3bc0e026c9773ebc9fe360b4876946ead746796c`
- `chatAdapterScaling.test.mjs`: `6f1b8a2fdc2cf73bb17b0a5b4edc002d8fc0f5c8c371cc0c6a51c07a6cdb3cf5`
- `workingPageScaling.test.mjs`: `3c885c92b68bc1d3a1abffe2ebae241272c6b97a5c39956c6566857ad15e604f`
