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

For Chrome, open the extension folder from Settings, load it unpacked in
`chrome://extensions`, pair using Sele's temporary address, and select **Share current tab**.
Treat the pairing address as a credential. Only shared/created tabs are exposed, each leased
to one conversation. Unsharing or disconnecting revokes access; regenerating the address
revokes the old credential. Chrome 125+ is required for flattened iframe sessions.

## Checks

Run `npm run test:browser-unit`, `test:desktop`, and `test:browser-use`; the latter opens a fixture window and
requires [GUI isolation](README.md). Optional installed-runtime checks use
`SELE_BROWSER_RUNTIME`, `SELE_CLAUDE_RUNTIME`, and `SELE_COPILOT_RUNTIME` (path or `bundled`).
`SELE_OPENCODE_RUNTIME=/absolute/path npm run test:opencode` checks plugin integration.
`scripts/tests/test-native-computer.py` tests private-display X11 input/capture. Real Chrome
extension pairing, Wayland portals, and native biometric flows need separate host validation.

`npm run test:e2e -- --phase host-tools` drives browser and shell tool calls through all
installed provider CLIs against a scripted local model and temporary profiles. Run it with
GUI isolation. The shared catalog test also compares every provider's advertised tool set
and checks that screenshot images survive SDK, dynamic-tool, HTTP MCP, and plugin transports.
