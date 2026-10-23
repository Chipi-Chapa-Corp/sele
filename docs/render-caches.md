# Renderer preparation caches

Chat details, Markdown HTML, code-block HTML, inert DOM templates, and local media
already had caches. Returning to a chat still remounted tool output and diffs,
repeating syntax highlighting and diff preparation. The renderer now also retains:

- Syntax trees shared by tool output and Markdown, keyed by language and source.
- Parsed diff files and highlighted tokens, keyed by language, change kind, and
  diff text. Fresh IPC objects can reuse them. Review state and Monaco models stay
  local to their mounted views.

Both caches use least-recently-used eviction and bound entry count plus retained
text and estimated object cost. Syntax trees allow 100 entries with a 2,000,000-unit
budget; diffs allow 24 entries with a 4,000,000-unit budget. Each syntax node costs
128 budget units plus its text, so short sources with large token trees cannot
bypass retention limits. These budgets are estimates, not exact heap byte limits.
Oversized results still render but are not retained. Failed highlights can retry.

Run `npm run benchmark:render-caches` for synthetic CPU measurements. One local
run on 2026-10-22 reported these warmed medians:

| Preparation | Uncached | Cached |
| --- | ---: | ---: |
| 50 lines of tool output | 0.572 ms | 0.003 ms |
| 200 lines of tool output | 1.373 ms | 0.011 ms |
| 20-line diff | 1.526 ms | 0.003 ms |
| 100-line diff | 5.802 ms | 0.005 ms |

The benchmark compares identical outputs against the original uncached algorithms.
It does not measure React mounting, DOM layout, provider I/O, or total chat-switch
latency. Cold content still requires preparation, and evicted content recomputes.

`renderCaches.test.mjs` covers repeated calls, fresh diff objects, edits, language
and change-kind separation, retention limits, eviction, and recovery from failed
highlighting. The two reuse regressions failed before caching was added. Validation
also included the renderer-state suite, Node and web typechecks, and the existing
chat-rendering and editor-comment GUI fixtures on a private software-rendered
display with fixture data.

## Retained turn views

Reopening a chat previously reused its recent-chat data but remounted the entire
message tree. `RetainedChatViews` now preserves up to three root conversation
trees using [React Activity](https://react.dev/reference/react/Activity). Hidden
effects are paused; reopening updates handlers and props while reusing existing
turn nodes and local state. The loading shell has its own key so a pending cached
detail transition cannot erase warm turns or evict its destination.

Retention follows the existing recent-chat cache keys, including running chats.
Hidden effects pause while provider data continues to update independently; revealing
a view reconciles the latest selected props and resumes its effects. Cache eviction
and disabling that cache discard corresponding hidden views. Subagent views, embedded
apps, videos, and views with open dialogs retain their normal lifecycle. Hidden DOM
is limited to 30,000 elements, in addition to the three-conversation limit. Transient
loading shells are counted separately.

Background stream summaries mark cached details as previews. Reopening a running
chat keeps that full cached window as a read-only preview while the provider refresh
runs. Replacing it with the one-turn durable opening view would remove the other
mounted turns and rebuild them when the refresh returned. Previews cannot grant
stale sending, editing, approval, or user-input permissions.

Before hiding a view, the cache measures its turn heights. On commit it enables
`content-visibility: auto` with those intrinsic sizes, allowing offscreen turns to
skip layout when reopened. DOM reuse alone made the browser lay out the whole
history again and delayed the first message; retaining measured sizes removed
that cost in the fixture.

The full-app fixture with 400 sidebar chats, 10 rich turns per conversation, and
background summary updates was run with and without retention. Warm switches:

| Observation | Remount control | Retained turns |
| --- | ---: | ---: |
| All 10 turns available | 247–265 ms | 21–43 ms |
| First message available | 27–45 ms | 21–43 ms |
| Exact turn DOM nodes reused | 0 | 10 |
| Maximum frame gap | 33 ms | 17 ms |

These are local software-rendered fixture results, not live-provider latency
guarantees. Cold opening still mounts progressively and background provider reads
still refresh cached chats. Neither run painted mixed-chat content or blank
unlabelled loading frames.

Run `npm run test:retained-chats` through isolated-gui for DOM/state reuse, current
handlers, paused effects, viewport refs, loading transitions, LRU eviction,
invalidation, scrolling, retention bounds, concurrent streams, and completion.
`npm run test:active-chat-switching`, also through isolated-gui, exercises the full
workspace with 400 sidebar chats, two running rich conversations, selected detail
updates and background summaries every 100 ms. It checks all ten turn nodes are
reused on each warm switch, the selected stream catches up, and no mixed-chat or
blank frames appear. Frame gaps and long tasks are reported as fixture measurements.
For the finished-chat full-app comparison, run
`scripts/benchmarks/benchmark-workspace-navigation.cjs` with
`SELE_BENCHMARK_RICH_HISTORY=1` and `SELE_BENCHMARK_CHAT_COUNT=400`; add
`SELE_BENCHMARK_UNRETAINED=1` for the remount control. Both use fixture APIs and
temporary profiles.

Final validation included the retained-view lifecycle test, the full-app rich-chat
comparison, the opening pixel-stability fixture, the renderer-state suite, renderer
typechecking, and linting of the changed components and fixtures. The additional
subagent GUI suite still fails its nested-parent viewport assertion; the control
run using the original `ConversationMessages` and `ConversationMessagesContent`
components fails the same assertion. That existing failure is not counted as a
passing check for this change.

Active-chat validation (2026-10-23): the retained-view concurrent-stream fixture,
the full-workspace active-switch fixture, scrolling, message selection, renderer
typechecking, and the cache-recovery tests pass. Follow-up fixture repair
(2026-10-24) supplies the real `getOpenCodeUsageLimitMessage` helper and a
pending-message persistence stub to the extracted OpenCode test adapters.
All 16 sidebar-status tests and all 220 chat-state tests now pass. Application
behavior and status assertions are unchanged by this test setup repair.
