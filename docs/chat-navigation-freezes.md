# Chat navigation freezes — 2026-10-17

## Current implementation — 2026-10-26

The sections below record successive findings, including experiments that were
later replaced. The current renderer keeps selection and its cached transcript
in one state queue and changes them together in a transition. This supersedes
the separate selection/transcript transition experiment described below. A
development/StrictMode fixture with two actively streaming rich histories checks
retained turn DOM, final stream revisions, rapid switching, and the absence of
mixed-chat frames.

Account usage is scoped to the selected account/chat during render, avoiding
three synchronous clearing updates on every switch. Stale replies cannot publish
into a new scope. Unchanged sidebar, model preference, usage popover, and cached
image state no longer schedule redundant updates when a retained view reconnects.
Equivalent items in fresh IPC snapshots reuse their existing identities through
a bounded comparison; edited items and new revision metadata still propagate.
Tool-output language detection inspects a bounded prefix instead of parsing an
entire output merely to choose highlighting.

Live profiling also identified native process launch on Electron's main thread.
Although `execFile` delivers results asynchronously, its native `spawn` call is
synchronous. In one six-switch capture, Git launches accounted for approximately
220 ms and account launches for 183 ms in aggregate. Some large frame gaps had
no corresponding renderer LongTask, so renderer-only scheduling changes do not
explain or resolve the whole problem.

Git and Codex account buffered commands now launch in a dedicated Node worker.
Command resolution, target routing, environment, input, timeouts, output limits,
and caller error handling are preserved. Shutdown disposes the worker after
provider shutdown and terminates its outstanding commands. Tests cover execution
semantics, failure recovery, timeouts, buffer limits, cleanup, and a deliberately
blocked worker launch while the calling event loop continues to run. Account
command integration tests, type checking, and the production build pass.

The worker change requires a full application restart; renderer hot reload
cannot activate it. After the user restarted, inspection of the loaded main
bundle confirmed the worker call sites and factory. A fresh main CPU recording
no longer attributed the Git/account launches to native `spawn` on that thread.

The first live replay after restart still had renderer LongTasks. Further
inspection found an idle Markdown video thumbnail causing the entire mounted
conversation to be discarded by the live-media exclusion. These managed,
nonplaying thumbnails are now retainable; playback, embedded apps, audio, canvas,
and other live content keep their cleanup behavior. A private GUI regression
checks retained message DOM/state for thumbnails and exclusions for playback.
The scroll scheduler also no longer reads `scrollTop` while item mount effects
are running, and transcript layout no longer reruns for metadata-only replies.

The development/StrictMode streaming fixture exposed a rapid-selection race:
clicking the currently painted chat could be discarded as a no-op while a
different selection was pending. Every root-chat click now publishes its
selection, including a return to the still-visible chat. The fixture passes with
the final rapid selection, retained DOM, final stream revisions, no mixed-chat
frames, and zero message renders/Markdown requests for unchanged cached targets.
Its counters distinguish legitimate outgoing stream renders while navigation
yields from renders of the destination's cached history.

The final live six-switch capture, with private GUI tests stopped and CPU/trace
profiling disabled, recorded selection frames at 36–58 ms and no renderer
LongTasks. Its largest animation-frame gap was 58 ms. This is a different chat
pair from earlier captures and is not a controlled numerical before/after
comparison. The main-process fix is confirmed active; the remaining renderer
changes hot-loaded. The user confirmed switching is now "much smoother," with
slight residual stutter, and explicitly chose to defer further tuning. These
observations do not establish perfectly smooth switching in every workload.

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

## Marking chats done: source reload and icon invalidation — 2026-10-18

The full-app fixture now clicks the actual completion buttons. The earlier empty
navigation cases did not exercise completion. Two additional paths were reproduced:

1. `handleMarkChatDone` and `handleMarkCwdChatsDone` open the new-chat composer
   with a container argument. `showNewChatView` normalized it into a fresh object
   and replaced `newSessionContainer`, even when its source was unchanged. Effects
   depending on that object rechecked availability and fetched the chat list again
   (twice per selected completion in this fixture). Fresh IPC snapshots then
   invalidated every sidebar row. Ordinary new-chat navigation did not supply this
   container argument, which is why the previous regression missed it.
2. Completing the last active chat in a project removes its directory from
   `projectCwdsKey`. Rebuilding `projectIconsByCwd` recreated every icon element,
   invalidating unrelated rows even without a history reload.

`showNewChatView` now retains the current container object when the normalized,
available destination is semantically equal. Genuine source changes still set the
new container. The icon map reuses each unchanged element by its image URL/glyph;
its cache contains only current directories and is published in a layout effect
so discarded concurrent renders cannot replace committed cache entries.

The unchanged final fixture was also run against a temporary archive of revision
`c4660e1e`. It failed the new no-history-reload assertion. Both runs used private
software rendering, 400 empty chats, and background summary updates every 100 ms:

| Completion, 300 ms observation | Before: row executions | After: row executions |
| --- | ---: | ---: |
| Selected chat, last active chat in a project | 1,198 | 3 |
| Selected chat, Done section expanded | 803 | 5 |
| Selected project, 20 chats moved into expanded Done | 1,222 | 43 |

Selected completion/history requests fell from two to zero. Maximum frame gaps
across these selected-chat/project cases fell from 50–83 ms to 17–33 ms, with no
renderer long tasks after the fix. An unselected completion preserved the selected
conversation and already avoided source reloads. Counts include background updates;
moving 20 chats into expanded Done legitimately mounts those 20 rows.

The regression checks exact affected row identities, bounded render counts,
zero history reloads, completed chats leaving their active group, selection
behavior, spinner DOM retention, and renderer errors. It covers both collapsed
and expanded Done. Frame timings are reported rather than used as machine-specific
pass/fail thresholds. These controlled results do not identify every possible
stall in a live provider session.

Validation: the expanded full-app navigation/completion regression, all 110
renderer-state tests, four Done-state tests, isolated Done database checks,
sidebar exit/motion checks, and the full typechecked production build passed.

## Sidebar intrinsic sizing during every switch — 2026-10-25

The previous React render-count checks missed browser layout work. On the current
branch, even navigation between empty chats produced approximately 33 ms frame
gaps with 400 sidebar chats, despite only the affected rows rerendering. Rich
streaming-chat switches also spent time in synchronous bottom-scroll corrections.
CPU and browser traces showed layout forced by `alignChatContentToBottom` and
Motion's document-scroll measurements. These reads paid for pending layout work
outside the conversation as well.

The sidebar body occupies a definite `minmax(0, 1fr)` grid track, but its contents
still participated in intrinsic sizing. Conversation, composer, and sidebar-footer
changes could therefore traverse hundreds of unrelated sidebar rows. Adding
`contain: strict` to `.chat-sidebar__body` gives that scrollport a size, layout,
style, and paint boundary. The grid still allocates its dimensions; its children
still determine its scroll range. Row details and menus already portal outside it.

The full-app regression now compares actual browser `LayoutDuration` for five
warmed existing-chat/new-composer switches, with background updates paused during
the comparison. It first disables containment as a control, then restores the
production stylesheet. With 1,000 sidebar chats, layout CPU fell from **185.1 ms
to 8.7 ms** across those switches. Ordinary switches and a burst of twelve clicks
25 ms apart subsequently had approximately **17 ms** maximum frame gaps while
background updates continued. A 400-chat run measured **84.9 ms to 8.8 ms** for
the same comparison.

Removing only the containment declaration makes the new regression fail: the
control and production paths used **92.7 ms and 94.0 ms** of layout CPU. The
assertion uses a relative reduction rather than a machine-specific frame deadline.
The fixture also verifies sidebar height and last-row reachability after resizing,
portaled menus/tooltips, final rapid-switch selection, and spinner DOM retention.
Its existing completion and message-retention checks remain enabled. Active-chat
polling now uses the viewport's turn collection instead of repeatedly scanning
the entire rich transcript with a descendant selector, reducing measurement
overhead.

Validation passed for the 1,000-chat navigation/completion fixture, the 400-chat
rich streaming fixture, chat-opening checks, motion checks, targeted lint, and the
full typechecked production build. The rich streaming run generally reported
17–33 ms frame gaps, with one approximately 50 ms gap/53 ms long task; its rapid
switch burst peaked at 33 ms. Separate rich-message work can still exceed a frame
budget. The chat-opening fixture's stale direct Pin-button selector was updated
to exercise the current menu action before rerunning its handler checks.

These measurements use synthetic data, temporary profiles, and the private
software-rendered display. They establish the shared sidebar layout cost and its
removal; they do not attribute every possible live-provider pause or identify the
first historical commit that made the symptom noticeable.

## User-session freeze still unresolved — 2026-10-25

The user tested the sidebar containment change and reported no improvement.
The preceding measurements establish a fixture optimization, not the cause or
resolution of the reported regression. The running instance is `electron-vite dev`;
the original benchmark bundled production React and predominantly message-only
history. A private development/StrictMode reproduction using working-section
snapshots produced additional pauses, including transitions to New Chat. It still
does not establish the cause in the live session. No second speculative application
change was applied. The user cannot restart the current session now.

A passive diagnostic is ready for a later restart:

```sh
npm run dev -- --remoteDebuggingPort 9333 --inspect 9334
# Once Sele is open, in another terminal:
node scripts/diagnostics/profile-chat-navigation.cjs
```

After it prints that recording has begun, switch chats normally for 20 seconds.
The tool saves `renderer.cpuprofile`, `main.cpuprofile`, `browser.trace.json`, and
`navigation.json` under a timestamped, gitignored `test-results/navigation-*`
directory. `--seconds`, `--output`, `--renderer-port`, and `--main-port` are optional.
Browser user-timing marks connect the user's actual clicks to CPU/layout events;
the observations also record frame gaps and renderer long tasks. The tool does
not launch or restart Sele, pause JavaScript, click, navigate, invoke provider APIs,
or inspect message contents. Its temporary listeners and observers are removed
after capture, including failure paths.

`scripts/tests/test-navigation-profiler.cjs` passed on the isolated display. It
captures an intentional 80 ms fixture stall, verifies both CPU profiles and the
browser trace, checks that capture itself performs no navigation, and exercises
cleanup after interruption. No profiling endpoint is enabled in the user's
currently running instance; a live-session trace is still needed for attribution.

## Live capture and shared invalidations — 2026-10-26

The user enabled both debugging endpoints. A 60-second live recording captured
96 chat/New Chat clicks across nine destinations, including repeated warm
switches. Renderer click tasks reached approximately 200 ms; the median
click-to-next-animation-frame delay was 44 ms and the 95th percentile was 108 ms.
This recording included browser tracing and React development instrumentation;
its timings must not be compared directly with production fixture frame rates.

The trace exposed repeated work that the original fixtures did not represent:

- Fresh IPC container objects for the same host/environment invalidated
  `changesContainer` dependencies. Availability, Git, and file-tree effects ran
  again. Canonical container identity now follows the environment key.
- Root/subagent turn inputs stabilized values but not event-handler closures.
  Selected-chat metadata refreshes changed callbacks and invalidated otherwise
  unchanged message rows. They now use the existing stable-handler mechanism,
  preserving current actions while retaining unchanged render inputs.
- Chat-specific recents/container props invalidated the changes panel even when
  its project tree was unchanged. Separate memoized tree components preserve
  that subtree while still updating when nodes or render handlers change.

The strengthened full-app fixture returns distinct host objects, matching IPC.
Removing only environment stabilization reproduces two availability requests
per same-environment switch; the implementation makes zero. Removing only
handler stabilization causes a selected metadata refresh to rerender all 20
unchanged message rows; the implementation renders zero. The file-tree fixture
also verifies skipped rebuilds, changed data, and replacement handlers.

The user reported improvement, with some remaining stutter around active chats.
A later CPU-only recording captured ten switches between four chats; delays
ranged from 26 to 103 ms. It is a different workload and recording configuration,
so this is not a numerical before/after claim. Residual work included synchronous
refresh commits immediately after the cached view became readable.

Authoritative reads and selected streamed details now publish in a React
transition when the same chat already has readable items. Initial content and
empty/unknown openings remain urgent. Stream acknowledgements are published in
the same transition as their associated transcript. Selection itself still
commits with its cached messages, preserving chat identity during rapid switches.
Active-stream regressions verify final revisions, retained turn DOM, absence of
mixed-chat frames, and rapid-switch selection.

The profiler supports `--no-trace` for lower-overhead CPU/frame observations and
`--wait-for-click` to arm capture for the next real chat click, avoiding missed
recording windows. Arming times out after three minutes and does not navigate.
The user still reported noticeable freezes after the refresh-scheduling change.

The approved six-switch replay reproduced warm returns to one active chat at
54–66 ms, versus about 20 ms for the paired inactive chat. This provides a
repeatable workload, rather than relying on a manually timed recording window.
The replay restores the starting selection and stops on unrelated selection or
modal changes. It now reports both the next animation frame and the first frame
with the requested selection: allowing an old-view frame to run sooner is not
equivalent to completing navigation sooner.

Further inspection found fresh model-label maps and action flags invalidating
historical rows. Message memoization now compares the displayed model label;
edit/reset/retry inputs are restricted to applicable rows, including normalizing
absent retry messages. A dedicated GUI regression verifies zero renders for
identical catalog replies and correct updates for changed labels and permissions.

A renderer refresh was required to test the new comparator: Fast Refresh loaded
the new module but retained the old comparator on existing memo fibers. Its
installed implementation was checked after the user-approved refresh. Residual
stalls remained, so this was not considered a resolution.

A whole-navigation transition experiment was rejected. It yielded during render,
but the larger active-stream fixture exposed lost retained turn DOM. Selection
remains urgent. The trace also attributed forced scroll/layout measurements to
the sidebar segmented control's shared-layout indicator. A single CSS indicator
now slides across its equal-width grid cells without Motion's global projection
measurements; reduced motion remains immediate.

The full active-stream fixture passes with these changes. The user reports
improvement with slight stutter remaining. No restart is needed for the latest
indicator change. These observations do not establish that the original freeze
is resolved.

Counter animations were another source of reveal-time component/effect work.
Elapsed-time and token counters now use one effect per value and browser-timeline
digit animations instead of per-digit Motion/presence trees. They keep unchanged
places still, animate changed digits in and out, cancel on hidden Activity, and
honor reduced motion. The dedicated GUI regression covers these behaviors as
well as message row invalidation. An open modal initially stopped the live
replay without selecting any chats. After it closed, the final replay completed
and restored the starting selection.

Composer model/account catalog publications also use a transition so their
metadata refresh renders can yield independently of the urgent chat selection.
The full active-stream fixture and 56 focused state/catalog tests pass. With
isolated GUI tests stopped and CPU profiling disabled, the final six-switch
replay measured warm active returns at 21–26 ms and paired inactive returns at
25–40 ms; the first active return was 62 ms. Larger frame gaps still exist. This
is a different chat pair/configuration from the initial capture, not a controlled
numerical before/after result. Remaining render/commit and Activity reconnect
costs still require investigation before claiming the freeze is eliminated.
