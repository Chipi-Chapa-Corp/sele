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
Discovery reads a separate small summary column, not saved conversation bodies. Older rows
are projected inside the SQLite worker. Fetch a saved viewport on navigation intent (hover, focus or selection);
background delivery carries metadata, while the selected chat receives transcript deltas.
Publish streamed background summaries in interruptible React transitions so input can
take priority; acknowledgement and snapshot bookkeeping keep their existing ordering.

## Rendering

Known chats open from durable views. Optional retained React Activity trees reuse up to sixteen
root conversations, also limited by the configured detail cache and a 30,000-element budget; hidden effects pause. Invalidation/eviction
releases them. Cached previews remain read-only until provider ownership refreshes.

Large turns mount items between paints. Markdown at 4,096 characters uses a shared worker,
and large HTML structures mount progressively. Preserve committed prefixes, DOM identity,
selection, and media while updates catch up. Sanitize HTML on the renderer; worker failure
falls back to escaped plain text. Cancel stale work on chat switches.
Prioritize new history initially, then serve jobs waiting over 250 ms in arrival order so
continuous streamed chunks cannot starve older turns. Keep one committed mount per paint.
Reconcile worker replies with the previous Markdown plan so unchanged blocks keep their
object identities. Reuse shell elements when only their children change, and publish plans
in transitions; parsing off-thread must not be followed by an urgent full-message render.
Consecutive flow-HTML parts share a DOM-owned React boundary. Each sanitized part retains
its existing size budget, incremental patching, and paint scheduling, but revealing a
retained conversation must not reconnect a separate component/effect tree for every part.
Tables and embedded applications retain their structured React rendering where needed.
Cancel unfinished DOM mounts while hidden and resume into the same committed prefix.

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
Active detail packets follow the same sidebar metadata rules as background summaries:
publish title/status/account/approval changes immediately and publish the final preview on
completion. Active read acknowledgements advance at most once per second; selection,
departure, and terminal snapshots record the exact latest viewing time.

The left sidebar uses one virtualized window for project headers, chat rows, and pagination.
Keep stable provider/chat keys and share the existing sidebar scroll parent. Window individual
rows rather than whole projects: a single project can contain hundreds of chats. Preserve
pagination, project controls, drag ordering, and keyboard traversal across window boundaries.
Sidebar rows use opacity/transform animations without Motion position projection; projection
can synchronously measure the document containing large retained transcripts when filters change.
React transitions do not make commit-time DOM work or browser layout interruptible.
Pass IDs together with a matching fallback lookup through the virtualizer's data items.
A surrounding context can advance before its previous ID window retires, leaving an old ID
without an entry. Rows read current metadata from context and fall back to their own snapshot
for retiring IDs. Keep the lookup in a map: repeating whole group objects in the data array
makes React's development diagnostics traverse the same catalog for every row. Keep the
virtualizer mounted across filter changes and use plain elements for recycled rows.
Preserve its data array when IDs and order are unchanged, and memoize the virtualizer itself:
its layout effect republishes props to a synchronous external store on each render.
The first sidebar viewport and new filter results mount rows between paints; ordinary
scrolling mounts normally after that batch. Reuse visible chat prefixes and scope selection
props to the affected row. Pass the chat count and a map of group snapshots to sidebar
components, instead of unused full chat arrays. Memoize the header independently of the list.

Retained conversation eviction order is independent of DOM order. Activating a cached chat
must not reinsert its transcript at the end of the container. Prepare pixel-rounding styles
before observing a viewport; follow the bottom after browser layout, inside ResizeObserver,
rather than forcing layout during React's reveal commit. Disconnect during a correction that
changes observed geometry and reconnect on the next frame to avoid observer feedback loops.
Keep scroll-following and user intent synchronous in refs; publish the jump-to-latest button's
React state in a transition so scroll events do not flush the workspace synchronously.

Closed dialogs do not render on transcript updates and load their modules on demand.
The terminal panel mounts after it is first opened and stays mounted thereafter; do not
start its 500 ms session polling on every startup. Pull requests and browser panels also
load on demand. Vite warms the renderer entry graph while application initialization runs.
Composer props contain only the selected identities and controls they display, not full
conversation/subagent snapshots. Development Refresh tracks custom hook signatures in both
plain TypeScript and hook-only TSX modules; incompatible signatures remount their consumers.
Initial root reconciliation and discovered chat catalogs also run in transitions. Closed pull-request controls preserve
their state and callback identities during unrelated workspace updates, so they do not
invalidate the workspace header and content on every streamed packet. Memoize the lazy
message boundary with the same semantic comparator as its loaded content.
Unopened PR controls do not reconcile scope caches or reset an already empty selection.
Provider-delivered transcripts, including first snapshots and resynchronization promises,
publish in transitions. Keep protocol acknowledgements tied to the committed transcript;
summary acknowledgements do not wait for the recovery read or React rendering.

Responsive layout uses one shared media query and browser listener for all consumers.
Read the current breakpoint through React subscriptions and release the listener when the
last consumer unmounts; do not attach one browser listener per row.

Loading marks cache their geometry and use browser animation timelines; do not generate SVG
paths in per-icon animation-frame loops. Pause hidden marks and respond to reduced-motion
changes. Prefer transform/opacity for other animation work. An already focused composer
must not rescan the document or refocus its window when focus events arrive.
Plain buttons share pointer/touch behavior with dropdown buttons, but do not mount menu
state, layout effects, IDs, or responsive subscriptions. Keep those in the menu component.
Index focus-owning overlays once per mounted composer and update that index from mutations;
chat navigation must not repeat a document-wide overlay query across retained histories.
Status spinners and the working-tab bot use static SVG masks on HTML hosts. Animate only
the hosts' transform and the bot dots' opacity. Animated SVG image timelines still repaint
on the renderer thread even when the host DOM never changes. Check steady paint events,
rendered pixels, reduced motion, and continued motion while renderer JavaScript is blocked.
Both icon dependencies are reduced to the imports used by
this app: the static barrel otherwise exposes all icons to Vite, while unused animated
forwardRef/displayName pairs survive bundling. The measured dev modules are 88,144 bytes for
180 static exports and 49,313 bytes for 17 animated exports. Namespace consumers retain the
full API; the static subset also falls back when an installed third-party package declares
the icon dependency. New named imports invalidate the optimized module safely during HMR.

Read-only diffs import no Monaco code. Keep the editable diff, editor helpers, shared review
controls, and original-content reconstruction separate. Review defaults use a stable empty
array: allocating it during render makes the marker effect schedule itself indefinitely in
review-enabled viewers. Skip marker observers for empty reviews, reuse unchanged positions,
and ignore scroll events outside the diff host. A sidebar scroll must not measure every diff.

Syntax-tree and diff caches bound both entries and estimated cost; oversized values render
without being retained. Snapshot ancestry uses weak references so keeping the newest stream
revision cannot retain all earlier revisions. Bounds and cache thresholds live in source.

## Checks and profiling

- `npm test` covers incremental work, paging, immutable snapshots, and rendering state.
  Use file filters such as `npm test -- chatScaling readCache markdownPlan` for focused runs.
- `npm run test:integration -- database` checks worker concurrency, durability, migrations, and recovery.
- `npm run benchmark:performance` and `benchmark:render-caches` measure synthetic hot paths.
- GUI fixtures: `npm run test:ui -- retained-chats progressive-markdown message-continuity`.
  Active switching and typing benchmarks use `npm run benchmark:active-chat-switching`
  and `npm run benchmark:streaming-composer`.
- `npm run test:ui -- renderer-performance` checks worker chat isolation, bounded streaming jobs,
  500 responsive consumers sharing one browser listener, and 60 animated marks without
  per-frame SVG writes. `npm run test:ui -- composer-input` checks zero
  settings/tools/usage renders while typing with 2,000 models, plus focus, caret and selection.
- `benchmark:workspace-navigation` also asserts zero regroupings when toggling empty search;
  use `SELE_BENCHMARK_CHAT_COUNT=1000` for the larger catalog. Departing inert animation
  rows are excluded when measuring current selection.
- `benchmark:workspace-interactions` keeps rich conversations streaming while switching chats,
  rapidly cycling All/Active/Sleeping/Working, and completing selected/unselected chats.
  Its 2,400-chat fixture checks bounded mounted rows, document-projection reads, overlay
  scans, drag reorder, pagination, and Tab/Shift+Tab across virtual window boundaries.
  Set `SELE_BENCHMARK_PROFILE` to save CPU/trace data and phase measurements.
  Detailed browser tracing requires `SELE_BENCHMARK_TRACE=1`; it adds substantial overhead
  to development measurements.
- `benchmark:workspace-vite` uses the real Vite server and module graph with disposable APIs,
  recording cold/warm loading, fully formatted cached chats, and sidebar filtering while
  rich chats stream. `SELE_BENCHMARK_STRESS=1` adds twelve rapid cached-chat selections
  with a painted-view identity check and forty rapid filter changes, and
  `SELE_BENCHMARK_ZOOM=1.25` exercises fractional zoom. Profiles attribute long tasks to
  sampled call stacks using the browser's monotonic clock. The fixture checks the animated
  icon bundle's size and retained component exports.
  `SELE_BENCHMARK_STARTUP_SETTLE_MS=10000` observes ten seconds after the first sidebar
  rows appear, separately for cold and warm loads. `SELE_BENCHMARK_STARTUP_BURST=1`
  pages the catalog in 100-chat responses and delays projects, notes, icons, fonts,
  models, and accounts to exercise startup work arriving after the first paint.
  It also checks that pending resource publication does not duplicate requests and
  that streamed chat reordering preserves project option objects.
- `npm run test:ui -- compositor-icons` checks bounded steady paint, visible transform/opacity animation
  without host DOM writes, continued motion through an 800 ms renderer stall,
  accessibility, reduced motion, and inactive state. `npm run test:ui -- diff-idle` and `npm run test:integration -- diff-viewer` checks that read-only diffs
  exclude Monaco and that idle reviews and unrelated sidebar scrolls do no marker work.
- `npm run test:integration -- icon-imports` checks named aliases, type imports, new exports during HMR,
  namespace/dynamic imports, third-party consumers, and removed source files.

Run GUI fixtures on the [isolated display](README.md). Put output in `test-results/` or
`benchmark-results/`. Use `scripts/benchmarks/` for reproducible measurements; fixture timings
do not guarantee live-provider latency. Software rendering also skips important native
compositor work. Set `SELE_BENCHMARK_COMPOSITOR=1` to require compositing and record the
reported GPU mode; the run fails if it is unavailable. Use passive live-instance captures
when diagnosing native paint/layerization costs, separately from React/JavaScript sampling.
Diagnostic logs include periodic process-memory samples and the latest sample on renderer
crashes; an exit code alone does not establish their cause.

For a live startup capture, start dev with `--remoteDebuggingPort 9333 --inspect 9334`,
then run `node scripts/diagnostics/profile-chat-navigation.cjs --wait-for-reload --seconds 20`.
Reload the window manually within 90 seconds. The probe is installed before application
code on the new document; CPU profiles and the browser trace include module evaluation
and the subsequent settling period. Timeout and successful completion both remove the
probe and stop recording. The command never reloads or clicks the user's application.
Restart the dev server after changing Vite configuration or plugins: a window reload
does not apply those changes to an already-running server.

## Stacks investigated in development

| Trigger | Blocking work or failure | Correction |
| --- | --- | --- |
| Recycled sidebar row during a filter change | `renderEntry → entry.props` read an ID from an older virtualizer window against the current lookup | Carry the immutable lookup snapshot with each virtualizer item |
| Revealing a large retained transcript | React layout commit → selection effect → `alignChatContentToBottom → scrollHeight` forced transcript layout; moving the selected retained tree also reinserted its DOM | Preserve DOM order, prepare styles before observation, and follow scrolling in ResizeObserver after browser layout |
| Review-enabled diff with omitted comments | `updateMarkers → requestAnimationFrame → getBoundingClientRect → setReviewMarkers → render` repeated because the default empty comments array changed identity | Stable defaults, no observers for empty reviews, and reuse unchanged markers |
| Scrolling another panel while reviews are mounted | Captured document scroll → every diff's `updateMarkers` → geometry reads | Only react to scrolling within the diff host |
| Loading a read-only tool diff | `UnifiedDiff` statically imported the editable Monaco implementation | Separate viewer, editor, review controls, and pure content reconstruction |
| Loading the animated icon dependency | Hundreds of `forwardRef` initializers and `displayName` assignments survived bundling | Reduce this dependency to statically imported icons, preserving their public component properties |
| Repeated sidebar updates in dev | `logComponentRender → addObjectDiffToProperties` walked repeated chat catalogs, including unused array props | Pass counts and map snapshots; retain ordinary React diagnostics |
| Programmatic transcript scrolling | Scroll listener → `setChatAtConversationBottom` could flush workspace reconciliation synchronously | Keep intent in refs and transition the button state |
| Unrelated streamed packets while PR controls are closed | Fresh PR state objects invalidated memoized workspace panels | Preserve state, draft, and event callback identities; verify with an unrelated-render regression |
| Revealing formatted Markdown in a retained chat | React `reappearLayoutEffects` / `reconnectPassiveEffects` replayed the component lifecycle around each bounded flow-HTML part | Share a DOM-owned boundary across consecutive flow parts, keeping the same bounded patches and paint queue |
| Metadata-only sidebar updates | Virtuoso prop publication → external store → `forceStoreRerender` scheduled synchronous work even with unchanged row IDs | Preserve structural data identity and memoize Virtuoso; keep current row metadata separate |
| A summary causes selected-chat resynchronization | Recovery promise → `applyChatDetail → setChatDetail` used a blocking default lane | Publish recovered and initial provider snapshots in transitions |
| Startup API responses arrive after the first sidebar rows | Environment/project catalogs, project resources, font enumeration and update checks → blocking workspace reconciliation; samples included `useWorkspaceProjectCatalog`, `stabilizeProps`, sidebar rendering and GC | Transition background publication, skip empty resets, and retain pending resource markers until publication commits |
| Streaming reorders chats between projects | Project recency cache serialized map insertion order, rebuilding project option elements even when every recency value was unchanged | Sort the serialized entries by project path |
| Sending a message | Keydown → synchronous transcript render → follow-latest layout effect → `scrollHeight` measured the newly mounted transcript | Transition the follow-latest state and align in ResizeObserver after browser layout, before paint |
| Opening usage | Click → layout effect → Floating UI `autoUpdate → getOverflowAncestors → isOverflowElement` forced document layout | Start observation after browser layout; keep measured placement out of React state |
| Steady status animations | Animated SVG mask timelines repeatedly repainted images and their document; zero DOM writes did not imply zero paint | Static masks with transform/opacity animations; verify cached layers and animation while JS is blocked |
| Codex tool presentation | `createChatDetail → renderWorkingItems → getNestedToolCalls → getToolCallNameAt` allocated/matched a suffix at every script character | Match only actual `tools.` / `functions.` prefixes, preserving quote/comment scanning |
| Codex terminal polling in a long session | Adapter retained completed command/output entries and scanned the global command map for each chat | Index live commands by chat, release completed buffers, and keep only bounded completion IDs to handle replay |
| Closed terminal UI in a long session | Registry expiration ran only inside `list()`, retaining completed sessions when nobody polled the hidden UI | Expire independently with one coalesced, unreferenced timer; retain attached sessions and bounded saved output |

The review-loop regression fixture reproduced 30 idle commits and 30 layout reads in
500 ms before the fix; afterward it records zero of both. It also verifies that unrelated
scrolling does no marker work while resizing the reviewed diff still updates its markers.
Opening checks compare painted text positions at 100% and 125% zoom for both providers,
including a single turn with 42 tool activities. These are behavioral checks; use the real
Vite fixture and native traces separately for timing and compositor diagnosis.

An isolated software-rendered Vite run on 2026-11-05 used 2,400 chats, fully formatted
400-section histories, background streams, twelve rapid chat selections, and forty filter
changes. Without CPU sampling, warm startup and all measured navigation/filter phases had
no tasks over 50 ms. Rapid selections painted zero mixed-chat frames, with a 16.8 ms maximum
frame gap in that phase. Warm readiness was 1.823 s; an empty optimizer cache took 7.586 s
and still included initial module-evaluation tasks of 69, 54, and 53 ms. These observations
describe that run, not a native-GPU timing guarantee.

A follow-up with delayed APIs, 2,400 chats, 38 projects and 300 models reproduced
63–72 ms tasks in the ten seconds after initial readiness. After background publication
was made interruptible, the sampled cold/warm settling phases had no tasks over 50 ms.
The final unprofiled run also had none in settling or navigation/filter phases, including
twelve rapid selections and forty filter changes. Settling frame gaps reached 33.3/50 ms;
ordinary cached switches reached 66.6 ms. Cold readiness was 8.160 s and warm readiness
2.186 s. These remaining frame gaps and initial cold module-evaluation tasks require
separate native/live investigation; zero long tasks does not establish perfect smoothness.

A passive live capture subsequently found 79 ms keydown and 65 ms usage-popover tasks,
and roughly 379 paint events per second. Two isolated status icons reproduced 387 paints
in 2.2 seconds with animated masks; static masks reduced this to zero. After applying
the renderer changes through HMR, a separate live capture measured about 8 paints per
second and native renderer samples fell from about 59% to 29%. Those captures contain
different interactions and are not a controlled latency comparison. A further compositor
trace confirmed GPU compositing and still reported 87 dropped frames of 825 expected in
one animation sequence, with a 78.9 ms presentation gap while no renderer long task was
recorded. Native frame presentation remains a separate issue; do not claim that these
fixes establish completely smooth behavior. A synthetic 136 KB nested-command scan
improved from 264 ms to 103 ms across 50 iterations; this does not measure UI latency.


### Chat opening latency, 2026-11-05

The message DOM cache previously evicted a conversation after only three mounted roots,
even while its full data remained in the configured recent-chat cache. Retain eligible roots
within both the data-cache limit and the existing DOM budget. Discard an oversized outgoing
root before LRU eviction so it cannot flush the smaller warm views.

Navigation starts the local opening read and message-module preload on pointer/focus intent
or immediately at selection, sharing pending reads with the selection effect. Speculative
reads are limited to two. Account invalidation also invalidates pending admissions. The
long-lived renderer opening registry holds bounded text/tool summaries rather than keeping
all visited tool output alive outside the full-history LRU. Initial module loading displays
bounded message text while the rich renderer loads. Ordinary messages do not import the
MCP app bridge or initialize its protocol schemas.

SQLite stores a small `opening` alongside the full durable payload. Large legacy rows are
projected inside the database worker on demand and acquire the small opening lazily;
discovery does not parse or backfill every transcript at startup. A 6.6 MB saved turn produced
an approximately 8.7 KB opening in the native fixture. Full payloads remain intact. The
`opening: true` cached-read option selects the bounded path; the default full saved read also
supports expansion if the provider fails. Read-only previews never grant stale permissions.

Read-marker effects for an outgoing chat must not overwrite a pending navigation's refs.
Late disk/provider replies are rejected against the requested chat key before projecting
history, including the interval before the old effect's cleanup runs. The message presenter
also passes its snapshot through a Map boundary to avoid recursively formatting transcript
arrays in React's development changed-props diagnostics. Reference results are cached by
immutable history snapshot so warm navigation does not enqueue another worker parse.

The final isolated Vite/Electron fixture used 2,400 summaries, four ten-turn rich histories,
background streams, and repeated selections. It reused all ten turns on every warm return,
painted zero mixed-chat frames, and measured 53–80 ms from click to readable text. Startup,
cold-open, warm-switch and sidebar-filter phases recorded no JavaScript tasks over 50 ms.
A deliberately delayed (500 ms) message module still displayed initial text at 91.5 ms;
a prepared local view displayed text at about 59 ms while its provider reply waited 750 ms.
The offline case recovered all ten saved turns after provider failure.

These are software-rendered fixture measurements, not a live native-frame guarantee or a
claim of first-frame chat opening. Backend code and the schema upgrade require a fresh
main process; renderer HMR alone cannot activate them. The remaining live native scheduling
gaps described above still need separate measurement after that restart.

### Large image paste, 2026-11-05

The composer ignored the image File in the paste event and reread the native clipboard.
`handlePaste → getClipboardImage → clipboard.readImage → NativeImage.toPNG` synchronously
encoded a full PNG on Electron's main thread, then returned its full base64 string to the
renderer and persisted it with the draft. In an isolated Electron fixture, a 6000×4000
PNG (18,421,572 encoded bytes) blocked the main heartbeat for 5,128.8 ms and generated
176, 205 and 59 ms renderer long tasks. The preview and preference value each contained
24,533,346 characters.

The paste handler now captures the event File immediately. A worker decodes it and builds
a preview with a maximum edge of 192 pixels. The original bytes are saved asynchronously
through 512 KiB IPC chunks, yielding between chunks. A single full-buffer IPC attempt
still produced a 68 ms task in `readPastedImage → contextBridge → ipcRenderer.invoke`;
chunking removes that copy from one uninterrupted renderer task. Uploads validate chunk
order and sender ownership, and clean up partial files on cancellation, expiry or window
destruction. Drafts store the small preview and original path; opening the attachment loads
the full-resolution image on demand. Sending continues to use the original file.

The same 24 MP fixture after the fix measured an 8.75 ms maximum main heartbeat gap,
no renderer tasks over 50 ms, and a 16.8 ms maximum animation-frame gap. The preview and
preference value each contained 18,819 characters. The test verifies that saved bytes
exactly match the source and that the full-resolution lightbox opens at 6000×4000.
It also changes the private clipboard after capturing the paste File and verifies zero
native clipboard rereads. Draft restoration, attachment editing, typing and real Vite
development worker transforms are covered by companion checks.

Run `npm run test:ui -- image-paste` through the isolated-gui helper on a private display.
These measurements use a synthetic image and software-rendered disposable Electron
profile; they do not claim native GPU performance in the user's running instance.
The IPC/preload changes require a normal dev restart. An older running preload remains
compatible but still uses its native clipboard encoding until that restart.
