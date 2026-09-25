# Performance fixes — September 2026

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
