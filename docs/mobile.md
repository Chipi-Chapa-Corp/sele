# Android and local network access

The Android app packages the shared React renderer with Capacitor. Provider CLIs, projects,
Git operations, terminals, and conversation storage run in desktop Sele. The phone connects
on the local network; it does not run a second provider backend.

Enable **Settings → Local network → Allow local network access** on the computer. Choose the
computer in the Android app and approve the request in desktop Sele. Approved devices reconnect
without entering a code or copying a link. The computer must remain awake with Sele running.

## Connection and pairing

`registerLocalAccess.ts` starts the opt-in HTTP/WebSocket server and advertises `_sele._tcp`
using DNS-SD. Its public TXT record contains a stable computer ID, display name, and protocol
version. Credentials are never advertised. The Android `LocalNetworkPlugin` uses NsdManager
to discover computers; a manual address fallback supports networks that block multicast.

The phone generates an independent device credential. `LocalAccessPairing` exposes a bounded,
expiring request to the desktop approval dialog and persists only the credential hash. Device
removal revokes existing connections and future access. Resetting browser links is independent
of device approvals. The phone keeps approved connections and per-host preferences/drafts in
private native storage, with acknowledged writes before a flush succeeds. Stable host IDs allow
saved connections to follow a computer whose LAN address changes.
Native storage replies return on Android's UI queue, after Capacitor updates its page reply
channel, so a quick first call after WebView reload cannot disappear into the previous page.

`clientIpc.ts` registers validated operations shared by Electron and authenticated LAN clients.
`rendererBridge.ts` creates the same renderer APIs for either transport. Host-only approval,
server configuration, desktop window operations, and native host dialogs stay on desktop IPC.
The phone supplies its own attachment, host-path-picker, clipboard, external-link, and download
implementations.

Each client has independent viewed-chat subscriptions and acknowledgements. Metadata changes
are broadcast even while providers are idle, and queued provider updates receive the newest
metadata before delivery. The server serializes output and applies request backpressure so a
large history response does not disconnect a slow phone. Reconnection reloads authoritative
state and never replays a mutation whose outcome may be uncertain.

Sleep/wake state is owned by the host, loaded before the workspace renders, and broadcast to
desktop and mobile clients. Existing desktop sleeps and legacy bookmarks remain visible on the
phone. Per-chat mutations merge on the host; an old expiry cannot erase a newer timer. All persistent settings, presets, drafts, sidebar tab configuration, group state and chat
preferences use the host's durable preference store, with live broadcasts in both directions.
Only current navigation (viewed chat/tab and open browser tabs) remains device-specific. Phone
storage retains pairing and local navigation; it never seeds the host with phone defaults.
Project changes, order, runtime configuration, notes and icons also notify connected clients.

HTTP and WebSocket traffic is unencrypted. Use a trusted LAN and do not expose this listener
to the internet. This implementation has no hosted relay.

## Adaptive renderer

`useCompactLayout.ts` selects the phone layout below 50rem, or below 65rem on a coarse pointer.
`workspace/styles/mobile.css` scopes the corresponding layout changes. Wide desktop screens
keep the original workspace layout. Mobile opens on the conversation. A compact header opens
its main slide-out sidebar, starts a new chat, and switches to workspace tools. The top bar
uses the same shell surface as the area around the chat pane and a panel-layout icon for workspace. Android status/navigation inset backgrounds follow that surface and theme; opening the drawer animates the same dimming scrim over them. The sidebar
keeps live chat/sleep filters at the top, then account selection and four icon actions at the
bottom: New Chat, projectless chat, search and Settings. Limits and the reset queue belong to the conversation’s Chat tools menu.
There is no bottom navigation strip or duplicate section heading. The same shared controls and theme tokens style both desktop and mobile.
A right swipe opens the sidebar; a left swipe, backdrop tap, Escape, or native Back closes it.
A right swipe also opens the drawer from workspace tools. Back leaves workspace tools for the conversation; switching tool tabs does not create navigation history.
Vertical and nested horizontal scrolling, text selection, editors, terminals and browser input
retain their native gestures.
The modal drawer blocks background input and contains keyboard focus. Native Back dismisses
the topmost picker/dialog first, returns from preset sections and PR details, leaves workspace
tools, and opens the root chat list before minimizing the app. The conversation or draft
remains available when the drawer closes. Native dialog cancellation follows the same save/cancel guards as its visible close action.
The composer stays above Android's keyboard, and native Back dismisses the topmost menu/dialog
before closing the drawer or returning to the conversation.
Conversation and workspace panels use the available width in portrait and landscape; the
sidebar remains a drawer in both orientations. The transcript uses a
standard percentage height on phones, including older WebViews without CSS `round()` support.

Chat and project row actions appear after a hold, cancel when the finger moves, and dismiss with Back or
a tap elsewhere. Fine-pointer hover details stay on desktop; touch never mounts those cards.
New-chat setup uses a compact project/provider summary that opens labeled project, provider,
location, and runtime selectors. The model selector owns its full row; long labels wrap, preset
configuration uses vertical sections, and saved presets keep readable labels and touch actions.
Goal, notes, actions, limits and on-reset controls live in Chat tools. Searchable pickers retain
their state and reposition when Android opens or closes its keyboard. Phone controls have no visual focus outlines; icon-only buttons remain square, and chat-tool carets and reset rows align with the other controls.

Git keeps its branch/view controls compact and offers Commit, AI Commit and Sync on a single
row. Pull-request search uses a full row with a clear action. Manual Commit opens
the existing manual/AI controls in a themed sheet instead of reducing the changes viewport.
The sheet uses an ordinary dialog and explicit backdrop so its portaled mode menus stay usable.
Native tests measure the content area and verify both manual and direct AI commits against an
isolated host repository.

With an editor focused, touch activation preserves the editing selection through Android caret resets and completes on pointer-up for shared controls, native form submits and menu options before Android can blur the editor or resize the WebView. Mention choices use click selection for touch and mouse, and retained Android editors keep their native keyboard. Shared buttons complete other touch activation on pointer-up and suppress the following compatibility
mouse events, including when keyboard resizing or opening a menu moves the target. Suppressing
mouse-down also protects newly focused inputs from a delayed blur. Dragging cancels
activation; mouse and keyboard activation retain their normal paths.

The compact file editor uses CodeMirror's Android IME editing, language highlighting, history,
line numbers and inline diffs in the existing file pane. It shares the desktop syntax palette,
font settings, save and review model. Wrapping starts enabled; the shared header controls it.
The header wraps its controls without horizontal scrolling; desktop-only actions are omitted
on remote clients. Desktop editing retains Monaco. Terminal controls
send through the same PTY path and add touch shortcuts. A phone-created terminal closes on
connection loss; provider-owned tasks remain on the computer.

The Android Browser panel shares the desktop tab strip and navigation controls. Pages load directly in a separate native WebView with a mobile viewport, ordinary touch scrolling, selection, pinch zoom and keyboard input. It has no Sele JavaScript bridge. HTTP/HTTPS navigation and the system file chooser stay native; page history, cookies and open tabs remain on the device. Inactive native views are bounded in memory and restored from their local URL if evicted.

The mobile workspace uses a bounded grid column so Git labels and browser tabs cannot widen the pane. Git actions wrap by their content width, keeping pull/push labels whole. Browser tabs scroll inside their rail and bring the selected tab into view; these overrides take precedence over lazy-loaded browser styles. The new-chat symbol uses the same SVG paths, stroke timing and input rotation on mobile, avoiding an offscreen canvas surface that Android can discard while the pane is hidden. Wide desktop keeps its canvas worker.

Desktop HTTP/HTTPS tab URLs appear automatically in the matching phone workspace. Explicit phone URL opens and page links also reach the computer when that workspace's Browser is active; otherwise they queue until it opens. The current tab, keyboard input, cookies and scroll stay local. URL acknowledgments prevent echo reloads. Desktop loopback URLs use the paired computer's reachable LAN hostname on the phone, preserving port, path, query and fragment; phone URLs keep their hostname. Sharing polls only small URL metadata, never screenshots. Older hosts have a metadata compatibility read. The non-Android web companion retains its remote preview implementation.

Compact layouts suppress programmatic input focus except search; tapping an editor still opens the native keyboard. Back hides an active keyboard before changing sections and dismisses the highest popup before workspace navigation. Configuration Back closes its popup. A first chat hold reveals its actions, and only a subsequent gesture on that revealed row can drag. Preset actions share their selection row, and the active selection uses the existing menu surface instead of a tick.

Android system bar colors and icons have a single native owner. Drawer transitions no longer invoke Capacitor's style setter, which resets the background; Activity resume restores the selected palette before a frame is drawn. Native video checks cover drawer animation frames. Mobile footer actions fill four equal columns, icons scale with the larger controls, and recent rows contain their action buttons without clipping.

Desktop automation, interactive MCP widgets, and chat archive import/export require desktop Sele.

## Build and emulator checks

Use JDK 21, Android SDK platform 36, and build-tools 35.0.0, then run:

```sh
npm ci
npm run build:android
```

The installable debug APK and checksum are written to `dist/`. This is a local debug build;
Play Store signing and distribution are separate work.

Agent-owned GUI and emulator tests must run through the `isolated-gui` helper's private display
and session bus with fixture profiles. Do not use the user's desktop or physical phone. The
Android fixtures require an explicitly selected `emulator-<port>` serial and reject physical
serials. `SELE_ANDROID_ADB_PORT` selects a separate ADB server.

The verified local AVD is **SelePhone35**, using the API 35 Google APIs x86_64 image. On this
machine SwiftShader crashes during boot; `-gpu host -feature -Vulkan` works with the private
software-rendered X display. Keep emulator state in a task-owned `ANDROID_AVD_HOME` and
`ANDROID_USER_HOME`, and use `-no-snapshot` for reproducible startup. Start the emulator through
the isolated GUI helper, not through the inherited display.

Pure transport, connection, host picker, and browser boundary checks need no display:

```sh
npm test -- localAccessServer remoteBrowser browserSync hostDirectory mobileConnection mobileBrowser chatSleep
npm test -- CopilotGoal
```

GUI checks, run within the private session:

```sh
npm run test:ui -- touch-buttons
npm run test:ui -- local-access
SELE_TEST_MOBILE_WEB=1 npm run test:ui -- local-access
SELE_ANDROID_TEST_SERIAL=emulator-5580 SELE_ANDROID_ADB_PORT=5049 \
  SELE_ANDROID_NATIVE_TOUCH=1 SELE_ANDROID_TEST_ALL_UI=1 npm run test:ui -- local-access
```

The native fixture installs and clears only the selected emulator's Sele app. It covers approval,
streaming, upload, force-stop/restart persistence, server interruption, revocation, and switching
computers. Its optional UI pass covers settings categories, workspace tabs, selectors, and Back.
The desktop fixture compares wide-screen pixels with compact CSS enabled and disabled.
Native touch checks cover hold/release/dismissal, Back through nested menus and rename,
drawer swipes versus nested scrolling, native sidebar search and limits, and Git content-area measurements in both orientations.
The touch follow-up selects skill/file/project mentions and submits a form with the native IME open, checks square and centered controls (including a saved Actions split button), and verifies Back after ten workspace tab switches. The provider sync pass samples native status-bar pixels in both themes and with the drawer open. Native taps and holds wait for stable viewport geometry before issuing one gesture; they never retry the action.

`LocalDiscoveryTest` is an Android instrumentation test that publishes a real service within the
emulator network and checks native discovery/resolution, including stable TXT identity. Build
`:app:assembleDebugAndroidTest` and install/run that app's test APK on the same private emulator.
The same instrumentation suite checks native storage responses over twelve WebView reloads.
The emulator's NAT does not relay the host's multicast discovery, so LAN connection fixtures use
the address fallback; the native NSD test independently exercises discovery.

With all four provider CLIs installed, the provider matrix runs their actual SDK/CLI transports
against a scripted local model server. Homes, accounts, workspace, and app profile are isolated:

```sh
SELE_ANDROID_TEST_SERIAL=emulator-5580 SELE_ANDROID_ADB_PORT=5049 \
  SELE_ANDROID_NATIVE_TOUCH=1 SELE_MOBILE_TEST_SYNC=1 SELE_MOBILE_TEST_UI=1 SELE_MOBILE_TEST_CONTROLS=1 \
  npm run test:mobile-providers
```

Set `SELE_E2E_OPENCODE_V2` if the managed OpenCode v2 binary is not on PATH. The matrix covers
models, session creation, native touch sends, streamed replies, desktop-to-phone messages,
rename/done state, pin sync, interruption/resume, and functional phone workflows. The UI pass
loads a chat slept on desktop before the phone connects, restarts the phone, and checks live
sleep/wake changes in both directions, including all provider lists. It also verifies
hold-opened actions, native rename and pin changes, a real host file save and Git
commit, PTY input/output/interruption, rotation, direct native browser interaction and desktop tab transfer, host folder selection, and Android's Save dialog. Artifacts go to `test-results/`.
