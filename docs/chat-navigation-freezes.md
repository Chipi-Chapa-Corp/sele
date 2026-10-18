# Chat navigation freezes — 2026-10-17

## Confirmed shared blocker

Chat navigation synchronously waits for Electron's main process, including when
opening an empty new chat. A busy main process therefore freezes the renderer's
JavaScript event loop: input, React commits, and animation callbacks wait with it.

The call chain is:

1. `workspace/components/ConversationPlan.tsx` keys `ChatPlan` by
   `selectedChatKey ?? 'no-chat'`. Switching chats or leaving a selected chat for
   the new-chat view remounts it. The workspace makes this component visible for
   ordinary root chats and the empty view, including when plans are hidden in
   settings (the plan prop is simply null).
2. `components/ChatPlan.tsx` initializes state with `readSeenPlanSignatures`.
   This reads preferences during rendering, before the `if (!plan) return null`
   check. An effect also saves the unchanged seen signatures on every mount.
3. `preferences.ts` calls the preload bridge. `src/preload/index.ts` uses
   `ipcRenderer.sendSync` for every preference get, set, and removal.
4. `src/main/registerPreferences.ts` services these requests using the main
   process's SQLite connection. Even a tiny preference read must wait for the
   main event loop to become available.

Marking the selected chat done additionally awaits `providerApi.markChatDone`
before changing views (`workspace/useChatListController.tsx`). That asynchronous
wait can delay the action's visible result; the subsequent plan remount adds the
synchronous renderer freeze described above. This distinction matters: pending
asynchronous IPC alone does not stop the renderer's event loop.

## A second synchronous path survives the existing navigation optimization

`messageBoxPreferences.tsx` coalesces per-chat composer preferences with
`createAfterPaintWriter`. This avoids doing that serialization/write during the
layout commit, but its eventual `preferences.setItem` still uses `sendSync`.
Consequently a navigation can paint once and then freeze on the scheduled save.
Moving a synchronous request after paint does not remove the dependency.

## Reproduction and measurements

The original run of `scripts/benchmarks/benchmark-chat-navigation.cjs` bundled the actual
`ConversationPlan`, renderer preference wrapper, preload, and main preference
handlers. It uses a temporary profile/database and never starts the application
or providers. The alternate control changes only preference access to memory.

The fixture deliberately occupies the main event loop for 400 ms, then navigates
in the renderer while that task is still running. It does not artificially slow
SQLite. The task is injected to isolate this dependency; these are **not** timings
from a user's actual provider session.

Measured on the skill's private Xvfb display with software rendering:

| Transition | Production preference IPC: commit | Memory control: commit |
| --- | ---: | ---: |
| Another selected chat | 401.5 ms | 0.1 ms |
| Selected chat to empty view (new chat / selected chat done) | 400.9 ms | 0.2 ms |

Each production transition issued one synchronous `get` and one synchronous
`set`, despite having **no plan and no messages**. A renderer timer due after
20 ms ran after about 401 ms. The control timer ran after about 20 ms. The
deferred composer save also delayed a 150 ms timer until about 401 ms.
The benchmark additionally checks that keeping the same chat key makes no
preference requests, and that no renderer errors occur.

Run from the repository with the isolated GUI helper:

```sh
/usr/bin/python3 /var/home/kitkat/.codex/skills/isolated-gui/scripts/desktop.py --session sele-navigation start --size 1280x900
/usr/bin/python3 /var/home/kitkat/.codex/skills/isolated-gui/scripts/desktop.py --session sele-navigation run --cwd /var/home/kitkat/Projects/Desktop/sele --timeout 45 -- /var/home/kitkat/.volta/bin/node scripts/benchmarks/benchmark-chat-navigation.cjs
/usr/bin/python3 /var/home/kitkat/.codex/skills/isolated-gui/scripts/desktop.py --session sele-navigation stop
```

## Why running threads amplify the problem

Provider event handling, transcript projection, metadata enrichment, and SQLite
queries share the main JavaScript thread with preference requests. For example,
Codex `emitChatUpdated` constructs a detail before notifying listeners, and Claude
`publishUpdate` does the same. `providerService.ts:applyMetadataToDetail` also
loads chat token usage for updates. Filtering an unselected chat down to a sidebar
summary happens later in `registerProviderIpc.ts:queueChatUpdateForWindow`; it
does not avoid that upstream work.

This identifies why background work can stall otherwise local navigation. It
does not identify which provider task occupies the main thread during each live
pause. The existing diagnostic log has no per-task CPU or event-loop timing to
make that attribution. A read-only check of the local token-price fallback query
took roughly 8–22 ms for Codex, with substantially smaller times for other
providers; this alone does not establish a multi-hundred-millisecond stall.

## Fix direction

Load a renderer preference snapshot asynchronously during initialization; serve
navigation reads from memory. Persist writes asynchronously through an ordered
queue with explicit error reporting and shutdown handling, preserving the
existing preference durability guarantees deliberately. Do not silently change
the synchronous storage contract to mean an uncommitted write succeeded.

Avoid mounting a storage-reading plan component for null plans, and avoid
rewriting unchanged seen signatures on mount. This removes the immediate
unnecessary calls, but the shared preference transport also needs attention
because composer saves and other components still use it.

Profile main-process provider tasks separately to find the longest blocking
tasks after decoupling navigation.

## Implemented fix and validation

The preload now loads a preference snapshot at startup. Gets, sets, and removals
operate on that local snapshot; edits save asynchronously in ordered batches.
Unchanged values do not write. Failures are reported to the renderer instead of
being silently treated as successful saves. `flushPreferences()` waits for durable
completion, including any deferred composer serialization.

Only actual document close/reload uses a synchronous save barrier. It flushes
deferred writers and commits both in-flight and unsent changes. Per-source batch
revisions prevent older asynchronous requests from overwriting this final save.
SQLite batches are transactional. Database disposal now runs after windows have
closed so renderer unload saves can complete, with quit continuation scheduled
on the next main-process task.

Null plans no longer mount `ChatPlan`, and mounting a real plan no longer rewrites
unchanged seen signatures. Resizing updates the CSS tracks once per animation
frame without updating workspace React state. Release, cancellation, or lost
pointer capture commits the final widths and saves once.

The updated benchmark (`npm run test:chat-navigation`, on the private display)
asserts responsiveness with the same injected 400 ms main-thread task:

| Operation | After fix |
| --- | ---: |
| Switch selected chat | 0.2 ms commit; 20.2 ms timer |
| Open empty chat view | 0.1 ms commit; 20.1 ms timer |
| Mount a real plan | 2.1 ms commit |
| Deferred composer save: 150 ms timer | 150.3 ms |
| Left sidebar: five resize frames | 79.6 ms, zero workspace renders or saves during dragging |
| Right sidebar: five resize frames | 77.0 ms, zero workspace renders or saves during dragging |

Both handles saved once and rerendered once on release. These are fixture
measurements under software rendering, not live-session FPS guarantees.

The preference-client tests cover immediate cache visibility, batch coalescing,
ordered flush completion, close-barrier composition, duplicate-close protection,
and rejected/failed persistence. The navigation fixture also checks rejection of
stale batch revisions in the actual main handler. The built production/dev
preference tests verify migration, explicitly flushed writes surviving SIGKILL,
restart after Chromium storage deletion, deferred saves on app quit and window
close, atomic rollback, corruption refusal, and terminal shutdown.

## Remaining renderer stall — 2026-10-18

The preference fix did not cover mounting a conversation's messages. Profiling
the real Markdown/message/sidebar components with synthetic data reproduced a
second stall: a ten-turn, approximately 62 KB rich conversation created about
9,100 DOM elements in one update. Renderer tasks lasted roughly 200–235 ms.
Sanitization, HTML parsing/insertion, highlighted tokens, and file-link markup
were prominent in the CPU profile. A React transition alone still left an
approximately 95 ms task because DOM commit work does not yield between turns.

The conversation now mounts its latest turn immediately, then schedules earlier
turns individually between paint opportunities. The queue waits for each React
commit before starting another turn, and cancels old work when switching chats.
Turn keys, order, payloads, and pagination coordinates remain unchanged. Once
mounted, turns receive live updates normally. History paging and subagent views
retain their existing immediate mount/scroll behavior. Cached chat selection now
uses a transition for the conversation, allowing the sidebar selection to paint
first. The sidebar also memoizes its animation wrappers, and fresh Markdown
fragments move directly into the document instead of being cloned on mount.

`npm run test:chat-rendering` exercises the actual `ConversationMessagesContent`
and message components, plus a CSS spinner in a 300-chat sidebar. The fixture
compares immediate mounting with the progressive path. In the final private
software-rendering run, the immediate rich case had a **233 ms frame gap**; the
progressive case displayed its latest turn after **56 ms**, with a **17 ms maximum
frame gap and no renderer long tasks**. Earlier history filled over successive
frames; all ten turns and their original order were verified, as were bottom
following, spinner DOM identity, and cancellation during rapid switches.

These are controlled fixture timings, not a trace of the reported live chat.
The bound is a turn, so an unusually expensive individual turn can still exceed
a frame budget. This change removes the reproduced aggregate ten-turn commit;
it does not claim constant-time rendering for arbitrarily large messages.

Validation: 110 renderer-state tests, selection-preservation tests, chat-opening
tests, cursor/numeric scrolling and content-resize tests, animation/drag exit
tests, and the full typechecked production build passed. The queue's tests cover
priority, commit serialization, cancellation, and idempotent completion.

## Empty-view switches: shared sidebar invalidation — 2026-10-18

The user's clarification that **any** switch stalls, including opening a new chat
with no data, required profiling the full `App` and workspace controller. The
message-mount fixture above did not cover that condition. A new full-app fixture
reproduces it with **zero messages**, 400 sidebar chats across 20 projects, and
one background running-chat summary arriving every 100 ms. All APIs and artwork
workers use fixture data; no provider or real profile is opened.

Two shared invalidation paths were confirmed:

1. `activeChatGroups` was rebuilt on every workspace render. The
   `projectIconsByCwd` memo depended on that array, so each selection, metadata
   reply, and background summary recreated the React icon objects supplied to
   every row. Those changed props defeated the row memoization, even for an
   empty destination.
2. The nested `AnimatePresence` instances used the default
   `presenceAffectsLayout=true`. In the installed Motion source, this creates a
   fresh presence context on a reused render, which broadcasts to descendant
   presence consumers despite their memoized props. After stabilizing icons,
   instrumentation still counted thousands of `MotionListItem` executions.

The active-group list is now memoized, and the icon map depends on the directory
set plus actual project/icon data. Sidebar presence contexts no longer broadcast
unrelated parent renders. The existing explicit row/group order dependencies
still drive layout changes, and genuine presence changes still drive exits.

`npm run test:workspace-navigation` exercises the actual full app, including the
new-chat composer, sidebar grouping, artwork, and controller effects. It clicks
between empty existing chats and the new-chat view while background summaries
continue. It instruments actual row and animation-wrapper executions.

| Per-switch 300 ms observation window | Before | After |
| --- | ---: | ---: |
| Sidebar row renders | About 2,000–2,800 | 5–7 |
| Distinct rows rendered | All 400 | 2–3: old selection, new selection, running chat |
| Animation-wrapper executions | About 2,100–2,900 | 125–167, mostly group wrappers |
| Empty new-chat maximum frame gaps | 117–167 ms | 17–33 ms |

The final zero-message run reported no renderer long tasks. The regression checks
that navigation succeeds, messages remain empty, the spinner DOM survives, only
the affected rows render, and animation-wrapper executions remain bounded. Counts
include background updates during each observation window. Timings are from the
private software-rendered fixture, not a trace of the live user session.

Validation: the full-app navigation regression, chat-opening/drag checks, sidebar
exit and other motion checks, all 110 renderer-state tests, and the full
typechecked production build passed.
