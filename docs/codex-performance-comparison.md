# Codex: committed main versus uncommitted fixes

This comparison was run against `main` at
`be1b5a15ed24a6e9d89e4276a4e9f6b8a4bbf6fd` and the working tree containing the fixes.
Generated raw samples are kept outside version control. The command below writes
byte counts, source fingerprints and environment information alongside the timings.

Reproduce it without switching branches or changing the working tree:

```sh
npm run benchmark:codex-revisions -- --baseline be1b5a15ed24a6e9d89e4276a4e9f6b8a4bbf6fd --samples 3 --assert-improvement --output /tmp/codex-comparison.json
```

The runner exports the committed source into a temporary directory and copies the current
source into another. It runs the revisions sequentially in separate Node processes, then
removes both temporary directories. No provider process, network request, or user chat is used.

## Results

Milliseconds, on an AMD Ryzen 5 7600X with Node 22.23.1. Repeated paths use three samples after
warmup; cold paths have one sample. A one-millisecond timer measures event-loop lateness during
each operation. Zero means no lateness detected at that resolution, not literally zero work.

| Scenario | Main elapsed | Uncommitted elapsed | Main timer stall | Uncommitted timer stall |
| --- | ---: | ---: | ---: | ---: |
| Order 10,000 already-ordered commands | 665.343 | 0.772 | 664.436 | <1 |
| Reorder 10,000 commands | 148.126 | 13.021 | 147.185 | 12.061 |
| Order 30,000 already-ordered commands | 13,683.069 | 0.655 | 13,682.113 | <1 |
| Reorder 30,000 commands | 2,393.004 | 44.193 | 2,392.040 | 43.229 |
| Cold metadata scan, 33.7 MB rollout | 62.629 | 48.730 | 61.663 | 3.263 |
| Metadata on a fresh API snapshot, unchanged rollout | 48.632 | 0.184 | 47.664 | 0.217 |
| Metadata after appending a roughly 1 KiB record | 44.285 | 0.434 | 43.321 | 0.395 |
| First subagent load, 2,000 child turns | 106.876 | 2.808 | 105.920 | 1.818 |
| Repeated subagent poll, same history | 103.497 | 0.711 | 102.541 | <1 |

These are medians except the cold rows. The large reordering stress case still exceeds a
16.7 ms frame budget. Cold metadata loading still performs a full scan, but yields between
chunks. Neither should be described as zero latency.

## Initial ordinary chat open

A separate run follows the actual `getChat` → `loadChatCursorWindowInContext` → detail
construction/preparation path. Every sample starts with empty thread and metadata-index caches.
Five samples per case; regenerate raw results with the command below.

The fixes are now committed as `f9afca0f`; this comparison remains pinned to the pre-fix
`be1b5a15` baseline, rather than whichever commit the `main` branch currently points to.

| Initial chat-open measurement | Main | Uncommitted |
| --- | ---: | ---: |
| First detail, no metadata enrichment needed | 0.279 ms | 0.293 ms |
| First detail, cold 33.7 MB metadata rollout | 56.095 ms | 0.449 ms |
| Entire cold metadata operation, including enrichment | 56.141 ms | 40.414 ms |
| Event-loop stall during the cold metadata operation | 55.183 ms | 1.769 ms |

Both revisions fetch one ten-turn native page. Main waits for optional transcript metadata
before returning it. The uncommitted version returns the page first and publishes enriched
content afterward. The benchmark asserts that ordering of completion, and the normal test
suite now contains a deterministic held-promise regression test in `CodexInitialLoad.test.mjs`.

```sh
npm run benchmark:codex-revisions -- --baseline be1b5a15 --initial-only --samples 5 --assert-improvement --output /tmp/codex-initial-load.json
```

These are times until serialized chat **data** is ready, not until pixels appear. Electron and
Codex process startup, authentication, real provider RPC latency, title/goal lookups, writer
ownership checks, and renderer paint are not measured. The rollout file is in the OS cache.
Whole-application startup has not been profiled by this benchmark.

## What the test proves

- **Ordering:** executes each revision's actual exported algorithm on identical turn objects
  and timestamps. Output ID hashes must match across revisions.
- **Metadata:** executes the actual adapter metadata method with each revision's real goal
  and command-anchor classes. It checks the recovered goal and corrected command order on
  every fresh snapshot. Main reads 33,716,742 bytes per unchanged snapshot; the fixed version
  reads 512 bytes. The appended-record case reads 1,871 bytes with the fix.
- **Subagents:** executes the actual adapter subagent/detail methods, catalog/hydration helpers,
  renderers, and payload preparation. Mock RPC responses are prepared before timing;
  client-side JSON decoding and output serialization remain timed. Main hydrates 2,001 full
  turns per poll and produces a 33.8 MB snapshot. The fixed version hydrates ten turns and
  produces a 171 KB snapshot. The first load also reads three turns for boundary/instruction
  discovery. The expected final answer is checked in both revisions.
- **Performance gate:** `--assert-improvement` requires at least a threefold elapsed-time gain
  for four representative warm paths, in addition to ordering equality and bounded read
  assertions. This run passed. Timing gates are opt-in because shared CI load can be noisy;
  normal regression tests assert deterministic work/payload bounds.

## Scope

This is a controlled benchmark of code used in the main process, **not a live Electron
input-to-paint trace**. The transport is mocked, metadata uses the local-filesystem path,
and unrelated title/cache bookkeeping is stubbed. Subagent output serialization is a JSON
proxy for IPC payload handling, not Electron's exact structured-clone implementation. Network
latency, provider/server CPU and older-server fallback transports are outside this measurement.

The cold subagent row measures a new adapter cache after the mock responses and runtime code
have been warmed; it does not measure process startup or cold disk caches. Metadata and
subagent bottlenecks are tested separately, so their times should not be added as a claimed
end-to-end interaction latency.
