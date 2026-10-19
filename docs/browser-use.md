# In-app browser automation

Enable the in-app browser in Sele settings. Restart Sele after installing this change: the Electron service and preload run outside renderer hot reload. Tabs follow the configured global, project, or chat workspace. Background tabs retain their viewport so screenshots work while the Browser pane is hidden.

Agent tab changes and browser input preserve the focused host control and its text selection. Browser input temporarily targets the guest, then restores both DOM and native keyboard focus before the command completes, including on failure. Input commands sharing a window are serialized so concurrent tools cannot type into the prompt or another tab.

**Claude:** local interactive Claude queries automatically receive the `Claude_Browser` MCP server through the Agent SDK. No Chrome extension, external MCP configuration, or separate browser process is needed. Tools cover tabs, navigation/history, accessibility trees and element search, form input, mouse/keyboard input, screenshots/crops, page JavaScript, viewport size, console messages, and network requests. Additional shared tools support file inputs, downloads, JavaScript dialogs, full-page screenshots saved to disk, PDF export, and bounded GIF recordings. Normal Claude permission handling remains in effect; the integration does not set tool allowlists or bypass permission mode. Browser tools are not injected into read-only queries, one-shot generations, account/control queries, or SSH/container queries. Closing, interrupting, or replacing the owning query disposes its browser capability and releases its debugger connections.

**Codex:** enable Browser Use / unified computer use tools in the Codex environment. The installed OpenAI runtime discovers Sele as `iab` through its native browser transport. Sele does not install or copy a replacement OpenAI MCP server. A compatible installed runtime and tool configuration remain necessary.

**Copilot:** local interactive SDK sessions automatically receive `Sele_Browser` over authenticated localhost HTTP MCP. This controls Sele's tabs; Copilot's separately configured or bundled Playwright server controls its own browser. Native Copilot MCP permission requests remain in the existing approval flow. One-shot, read-only, and container sessions do not receive the host browser. Idle, interruption, failure, and disposal revoke the active page capability; a later turn starts with fresh element references.

**OpenCode:** local interactive sessions receive `sele_browser_*` tools through an ephemeral runtime plugin. The installed OpenCode runtime does not include caller-session metadata in MCP calls, and its MCP registrations are directory-wide. The plugin uses its trusted `ToolContext.sessionID` and directory to route calls to the matching authenticated MCP capability. Ordinary OpenCode permissions apply before a call. Sibling sessions cannot select another session's tabs by supplying a session ID as a tool argument. One-shot, read-only, and container sessions have no browser binding. No user or project configuration files are changed; the plugin and endpoints are removed when the server is disposed.

Shared file tools are `upload_files`, `downloads`, `handle_dialog`, `save_screenshot`, `print_pdf`, and `record_gif`. Uploads target a file input by accessibility reference or a unique CSS selector and require absolute paths to regular local files. For shared-tool downloads, allow the exact URL, trigger it on the page, then list or wait for completion. Codex uses the runtime's native file chooser and download events. Downloads save under the system Downloads directory's `Sele` subdirectory with unique filenames. Screenshot, PDF, and GIF output paths must be absolute, their parent directories must exist, and existing files are never overwritten.

## Layers

- `BrowserPanel` and `useBrowserAutomation` own renderer tab state and workspace selection. Chat keys include the provider ID. The renderer checks the browser setting before acknowledging each automation request, including when the panel is already mounted.
- `main/browser/BrowserAutomation.ts` owns Electron IPC, scoped tab access, webview/partition validation, CDP policy, and debugger leases. A revocable client represents a workspace capability. All providers share the same debugger ownership checks. This layer knows nothing about MCP or either provider's wire protocol.
- `main/browser/BrowserWorkspace.ts`, `BrowserAccessibility.ts`, and `BrowserInput.ts` implement reusable page operations over that client. They own element references, input sequences, screenshots, navigation, bounded console/network buffers, and action serialization. References expire on navigation and detach and are not reused between queries.
- `BrowserDownloads.ts` tracks authorized downloads and progress. `BrowserArtifacts.ts` writes screenshots, PDFs, and bounded GIF recordings without overwriting existing files. `BrowserTools.ts` defines provider-neutral tool schemas; `BrowserMcpServer.ts` exposes them through authenticated localhost HTTP MCP for supported provider runtimes.
- `providers/codex/CodexBrowserBridge.ts` maps OpenAI's framed JSON-RPC transport onto the shared client. `CodexBrowserSessions.ts` handles Codex session registration/revocation. Browser mechanics do not belong in this adapter.
- `providers/claude/ClaudeBrowserTools.ts` wraps the shared tool schemas in Agent SDK tools. The SDK carries MCP messages over its existing control channel. `ClaudeProviderAdapter` owns registration and query lifetime. This adapter does not access Electron or implement page behavior.
- `CopilotProviderAdapter` registers a session-local HTTP MCP configuration. `OpenCodeBrowserBridge.ts` generates the temporary plugin and routes trusted runtime context to session-local endpoints; `OpenCodeServerClient` owns plugin/server cleanup, and `OpenCodeProviderAdapter` owns active-turn bindings.

New provider adapters should reuse a scoped client and the page-operation layer. New browser behavior should be implemented there before being exposed as a tool. Global and project workspaces intentionally allow providers to see the same tabs; simultaneous debugger control still requires an exclusive lease. Chat workspaces isolate providers even if their session IDs match.

## Claude native interface investigation

Inspected the installed Claude Code **2.1.252**, Agent SDK **0.3.228**, and the official Claude Desktop Linux package **1.46388.2** (downloaded and checksum-verified for inspection, not installed). Desktop exposes browser and preview tool families; Code recognizes the `mcp__Claude_Browser__` and `mcp__Claude_Preview__` namespaces. The Desktop Browser surface includes `tabs_context`, `tabs_create`, `tabs_select`, `tabs_close`, `navigate`, `read_page`, `find`, `computer`, `form_input`, and related page tools.

No standalone reusable Desktop browser runtime or supported external transport for attaching another app's webviews was identified. Sele implements the observed browser tool vocabulary over the supported Agent SDK MCP transport, with its own shared browser operations. It does not load Desktop's binary, imitate a Chrome extension, or claim exact compatibility with every private Desktop schema. Only supported operations are advertised. Native Desktop site-policy classifiers, per-site access tickets, credential workflows, and preview-server management are not replicated.

References: [Desktop browser features](https://code.claude.com/docs/en/desktop#browse-external-sites), [official Linux distribution](https://code.claude.com/docs/en/desktop-linux), [Agent SDK custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools).

## Transport and access boundaries

The Codex bridge publishes a private native-endian, length-prefixed JSON-RPC socket under `/tmp/codex-browser-use` (a named pipe on Windows). Only Codex sessions registered by Sele are accepted. Session removal revokes existing clients and debugger leases. Claude uses in-process SDK MCP registration and opens no additional socket.

Both adapters use the same tab/workspace and browser-partition checks. Browser-global CDP commands and access to the Electron shell are rejected. Disabling the browser rejects further operations, including from already attached sessions.

Ordinary OpenAI Browser Use permission elicitations appear in the existing Allow/Deny UI. Authentication challenges, nonempty input forms, and requests requiring strict automated review are not converted into ordinary approvals. The OpenAI runtime continues to own its browser security policy. Claude's tools use the existing Claude permission flow; they do not inherit OpenAI's runtime policy or Claude Desktop's private policy services.

## Verification

Run `npm run test:browser-use` inside the isolated-gui helper's private display and D-Bus session on Linux. The integration fixture uses the actual BrowserPanel and preload, a temporary profile, and a temporary downloads directory. It exercises Codex transport messages, Claude tools through the real MCP client/server protocol, and authenticated HTTP MCP with Copilot/OpenCode workspace scopes. Coverage includes navigation/history, typing/clicking, accessibility references, form filling, console/network reads, viewport changes, visible/hidden screenshots, tab management, disabled settings, shared debugger ownership, provider/workspace boundaries, and disposal. The Linux fixture opens a window on private X11 to verify keyboard focus, prompt selection, subsequent user typing, hidden-page input, concurrent input, and failure cleanup. It focuses fields through CDP mouse input before typing: DOM focus alone does not reliably focus Electron's embedded input widget. This does not change Sele's normal window configuration.

To also test installed runtimes:

```sh
SELE_BROWSER_RUNTIME=/absolute/path/to/browser/scripts/browser-service.mjs \
SELE_CLAUDE_RUNTIME=/absolute/path/to/claude \
SELE_COPILOT_RUNTIME=bundled \
npm run test:browser-use
```

The optional Claude check starts the actual Claude Code process and verifies it discovers `Claude_Browser` through the Agent SDK. It sends no prompt and performs no model inference. The MCP fixture separately invokes the implemented tools against real pages. `npm run test:codex-history` includes OpenAI permission routing checks.

The optional Copilot check uses the SDK's bundled CLI (`bundled`) or an explicit compatible executable path. It discovers the MCP tools and executes tab listing, navigation, and screenshots through the native tool pipeline, including permission callbacks, without sending a model prompt. `npm run test:browser-unit` covers transport authentication, suspension, downloads, session revocation, GIF encoding, and Claude query cleanup. Provider-specific suites are `npm run test:copilot` and `npm run test:opencode`.

Set `SELE_OPENCODE_RUNTIME=/absolute/path/to/opencode` when running `npm run test:opencode` to include the installed-runtime plugin check. That check uses isolated runtime configuration and a local mock model endpoint to exercise plugin discovery, ordinary permission prompts, session routing, and tool results without external model inference.

OpenAI runtime validation uses Browser Use **26.901.31953**. Its isolated localhost fixture disables runtime security only inside the mock test host; it does not change application configuration or exercise the runtime's approval service.

## Current limits

Remote browser forwarding, specialized secure authentication UI, Desktop automated site-policy services, and Claude-managed preview servers are not implemented. Sele's embedded browser has its own profile; it does not attach to an existing personal Chrome session. Claude's Chrome-specific credential classifiers, file-read policy checks, and remote upload byte forwarding are not replicated by the shared MCP tools.

Flattened cross-origin iframe reads and clicks are exercised through the installed Codex runtime. Non-flattened attachment and that runtime's file uploads inside out-of-process frames remain unsupported. Shared accessibility-reference tools do not provide a complete cross-frame locator API. Popup opener/OAuth workflows have not been validated. JavaScript alert/confirm dialogs can be handled; Electron's `prompt()` is unavailable.

Viewport presets change size, not user agent or touch behavior. Console/network history starts when a session first attaches and retains at most 200 entries; network response bodies are limited by CDP's bounded buffer. Full-page screenshots are capped at 32 megapixels after scaling. Artifact files are capped at 50 MB. GIF recordings use a fixed RGB332 palette, require a fixed viewport, and capture at most 20 frames over five seconds at up to 640×480. Network mocking, storage-state tooling, performance traces, heap inspection, and Lighthouse audits are not exposed as shared tools. Windows and macOS have not been exercised by the Linux integration test.
