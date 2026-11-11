# Browser and desktop automation

Enable the embedded browser in Settings. Tabs follow the global, project, or chat workspace;
chat keys include the provider. Hidden tabs retain their viewport for screenshots. Browser
input is serialized per window and restores host focus/selection, including after failure.

| Provider | Embedded browser integration |
| --- | --- |
| Codex | Direct `sele_browser`, `chrome`, and `sele.computer` tools. Optional native `iab` transport also supports compatible Browser Use plugins. |
| Claude | `Claude_Browser` MCP tools through the Agent SDK. |
| Copilot | `Sele_Browser` over authenticated localhost HTTP MCP. |
| OpenCode | Ephemeral `sele_browser_*` plugin routes trusted runtime session context to scoped MCP endpoints. |

All four providers expose the same embedded-browser, attached-Chrome, and shared-desktop
operations in writable interactive chats on the host and local Distrobox/Toolbox sources.
`supportsLocalHostTools` centralizes this source policy. One-shot and read-only sessions do
not receive these capabilities. Separate SSH, Docker, and Podman network namespaces need
transport forwarding and do not receive unreachable host endpoints. Provider permissions
still apply. Stop, disposal, or replacement revokes the owning capability; expired element
references cannot be reused. Global/project workspaces share tabs, with exclusive debugger
leases; chat workspaces isolate sessions.

Codex's direct tools do not require `js_repl` or browser plugins. Other providers share
`ProviderBrowserTools`: ordinary names control the embedded Browser pane, `chrome_*`
names control attached Chrome, and `native_computer` controls the shared desktop. Chrome
and desktop connections must still be explicitly connected in Settings. Disconnected tools
return connection instructions instead of falling back to another browser or desktop.
Claude always loads the embedded browser's tab listing, navigation, page reading, and
interaction tools; the remaining actions can be discovered with `ToolSearch`. Its MCP
instructions distinguish the cross-platform embedded browser from Chrome and desktop connections.

### Official provider Chrome integrations

**Settings → Browser & desktop → Your Chrome** preserves each provider's existing Chrome
configuration by default, on macOS, Windows, and Linux. The optional switches add the official
extension integration for Sele on the next turn; leaving them off follows the provider's own
configuration. These switches persist independently. Copilot and OpenCode keep using Sele's
shared-tab connection.
Existing connections that work without an extension remain available; Sele does not add an
extension prerequisite. **Official Chrome extensions (optional)** contains independent opt-in
switches for Claude and Codex, both off by default. Enabled switches are shown expanded.
Adding an official integration keeps the embedded browser, configured MCP servers, and a
paired Sele connection available. Sele does not install extensions or modify native hosts.
The explicit official-extension switches apply only to host-local writable chats. Writable
SSH, Docker, Podman, Distrobox, and Toolbox sessions retain their own existing provider browser
configuration; Sele does not inject the local machine's official connection into them.
Background/control and read-only queries do not enable it.

The optional **Claude in Chrome** override uses [Claude's official integration](https://code.claude.com/docs/en/chrome).
That integration requires its extension and the same supported Claude account as Claude Code.
When the override is on, Sele passes `--chrome` to interactive SDK queries.
The official account-level bridge can also list Chrome browsers on other devices;
a connected MCP server alone does not prove a local browser is connected. Sele keeps the usual
permission handler. Changing the switch restarts an idle query
on its next turn. The embedded Browser pane and a paired Sele connection remain available.
Background/control queries explicitly pass `--no-chrome`.
Writable interactive queries without a local explicit override pass neither `--chrome` nor
`--no-chrome`, preserving Chrome enabled in Claude's own settings in every environment.
Read-only interactive queries still pass `--no-chrome`.

The optional **Codex** override enables known plugins managed by the
[official desktop app](https://developers.openai.com/codex/app/chrome-extension).
Keep that app running when using a connection it manages. Sele enables installed
`chrome@openai-bundled` and `unified-computer-use@openai-bundled` plugins when present.
Plugin catalog layouts vary across runtime versions; an absent `chrome` entry or an older
runtime without plugin discovery does not block creating or resuming a chat. Plugin-catalog
RPC errors preserve existing configuration; actual transport failures still surface. Existing browser,
MCP, and native-host configuration is retained. A catalog entry alone does not prove a browser
connection. Thread-local config enables known installed plugins without changing global Codex
config or the native messaging host. A paired Sele `chrome` namespace remains available even
when official plugins are enabled. Website permissions and
connection errors come from the official runtime; specialized browser authentication/review
challenges still have the limitations described in [provider interactions](provider-interactions.md).

Sele's `chrome` namespace and Claude's `chrome_*` tools are advertised only after the user
starts pairing Sele's optional extension or connects it. Unpaired tools cannot divert the
agent from its existing native Chrome connection. Pairing updates the catalog on the next turn.

Fixture checks cover flags, plugin selection, scope boundaries, settings persistence and the
settings controls. Real extension pairing and authenticated browsing, including macOS native
host behavior, require a separate test with those extensions and accounts installed.

`node --experimental-strip-types scripts/diagnostics/check-native-chrome.mjs` checks the real
Claude SDK/Chrome MCP connection and the real Codex app-server's installed Chrome plugin.
On Linux, run it through isolated-gui with `SELE_CLAUDE_PATH` and `SELE_CODEX_PATH` pointing
to container-runnable CLI executables. Set `SELE_NATIVE_CHROME_REPORT` to save its JSON report.
It never selects browsers, opens tabs or reads pages, and ignores remote Claude browsers.
Exit 2 means local prerequisites are blocked. A successful readiness check still does not
prove navigation, typing or clicking; those need an authenticated test browser. Codex's catalog
check reports its limited scope rather than treating an absent plugin name as a broken connection.

## Code boundaries

- `BrowserPanel` / `useBrowserAutomation`: tab state, workspace selection, and setting checks.
- `main/browser/BrowserAutomation.ts`: scoped clients, IPC, partition validation, CDP policy,
  and debugger leases. Browser-global commands and access to Sele's shell are rejected.
- `BrowserWorkspace.ts`, `BrowserAccessibility.ts`, `BrowserInput.ts`: reusable page operations.
- `BrowserTools.ts`, `BrowserMcpServer.ts`: shared schemas and authenticated MCP transport.
- Provider browser bridges: wire formats and session lifetime; page behavior belongs above.

Downloads require URL authorization. Uploads use regular local files. Artifact destinations
must be absolute, have existing parents, and never overwrite files. Screenshots are capped at
32 megapixels and artifacts at 50 MB; GIFs allow 20 frames over five seconds at up to 640×480.
The browser has a separate profile from personal Chrome. Remote forwarding, secure sign-in
UI, preview-server management, and a complete cross-frame locator API are unavailable.

## Explicit computer and Chrome connections

**Settings → Browser & desktop** connects local writable conversations in all four providers to these
capabilities. Connections are not restored after restart.

**Connect computer** starts a Linux host helper. X11 requires `xdotool` and ImageMagick;
Wayland requires PyGObject, RemoteDesktop/ScreenCast portals, GStreamer Gst/GstApp,
`pipewiresrc`, `videoconvert`, and `pngenc`. Grant monitor/input sharing in the Wayland portal.
Missing support fails without falling back to unrestricted X11 control. Disconnect or portal
revocation stops access.

For Sele's optional shared-tab connection, expand **Sele Chrome extension (optional)**,
open the extension folder from Settings, load it unpacked in
`chrome://extensions`, pair using Sele's temporary address, and select **Share current tab**.
Treat the pairing address as a credential. Only shared/created tabs are exposed, each leased
to one conversation. Unsharing or disconnecting revokes access; regenerating the address
revokes the old credential. Chrome 125+ is required for flattened iframe sessions.
This pairing is independent of Claude and Codex's official Chrome connections.

## Checks

Run `npm test -- browser/ BrowserLifecycle BrowserSessions BrowserTools CopilotBrowser OpenCodeBrowser desktop/`
and `npm run test:ui -- browser-use`; the latter opens a fixture window and
requires [GUI isolation](README.md). Optional installed-runtime checks use
`SELE_BROWSER_RUNTIME`, `SELE_CLAUDE_RUNTIME`, and `SELE_COPILOT_RUNTIME` (path or `bundled`).
`SELE_OPENCODE_RUNTIME=/absolute/path npm test -- providers/opencode/` checks plugin integration.
`scripts/tests/test-native-computer.py` tests private-display X11 input/capture. Real Chrome
extension pairing, Wayland portals, and native biometric flows need separate host validation.

`npm run test:e2e -- --phase host-tools` drives browser and shell tool calls through all
installed provider CLIs against a scripted local model and temporary profiles. Run it with
GUI isolation. The shared catalog test also compares every provider's advertised tool set
and checks that screenshot images survive SDK, dynamic-tool, HTTP MCP, and plugin transports.
