# Renderer restarts reported on 2026-10-25

The supplied `sele-diagnostics-2026-10-25T23-40-17-320Z.log` contains two renderer
crashes, both on macOS arm64 with Electron 38.5.0:

| UTC timestamp | Sele version | Renderer exit |
| --- | --- | --- |
| 2026-10-25 04:35:15.454 | 3.10.1 | `reason: 'crashed', exitCode: 5` |
| 2026-10-25 23:39:54.477 | 3.11.0 | `reason: 'crashed', exitCode: 5` |

`application.ts` automatically reloads the renderer after the first crash in a
stability window. This explains the appearance of a spontaneous app restart.
The first crash was followed by a version change about a minute later; the second
had no new main-process startup before export. Update checks immediately preceding
the second crash reported no available update.

Memory exhaustion is a plausible cause, not an established diagnosis. An
[Electron reproduction](https://github.com/electron/electron/issues/40426)
documents JavaScript OOM producing the same `crashed` / exit-code-5 pair on
macOS. This log has no memory samples or native crash dump to confirm it. Missing
Codex thread errors occur in bursts after both crashes as the interface reloads;
those bursts do not establish the preceding cause.

## Reproduced retention bug and fix

`chatConversationModel.ts` stored a strong reference to the preceding items array
in a WeakMap value keyed by the new array. Despite the WeakMap, keeping the newest
array alive kept the entire ancestry alive whenever change hints accumulated
without model construction. Each ancestor could retain an obsolete streaming
message, tool output, and any cached conversation model for that array.

The predecessor is now a WeakRef. Incremental builds still use a predecessor
while it is available; if it has been collected, model construction falls back
to the current items. Previously rendered models remain immutable.

A regression runs 2,000 unrendered streaming revisions in a separate Node process
with explicit garbage collection while retaining the newest snapshot:

| Result after collection | Before | After |
| --- | --- | --- |
| Obsolete snapshots still alive | 2,000 | 0 |
| Latest conversation reconstructs correctly | Yes | Yes |

This establishes and fixes a retention path, not attribution of the reported
crashes to that path. The diagnostic logger now records process memory every
minute and attaches its latest timestamped sample to renderer crash records.
The memory fields come from `app.getAppMetrics()` (sizes in KB); they measure
process memory, not JavaScript heap usage. Only one sample stays in RAM; historical
samples use the existing bounded log. No message text or page content is added.

Validation commands: `npm run test:chat-state`, `npm run test:logging`, and
`npm run typecheck`. These checks do not open application windows.

The renderer-state suite passed 229 tests and logging passed five tests. Broader
checks also encountered unrelated failures in the working tree: the shutdown
fixture in `ProviderUpdatePerformance.test.mjs` references an undefined
`limitResetQueue`, and the error-logging audit flags existing handlers. The new
memory-diagnostics handler passes that audit's logging requirement.
