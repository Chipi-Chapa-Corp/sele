# In-app browser automation

Enable the in-app browser in Sele settings. Restart Sele after installing this change: the Electron service and preload run outside renderer hot reload. Tabs follow the configured global, project, or chat workspace. Background tabs retain their viewport so screenshots work while the Browser pane is hidden.

**Claude:** local interactive Claude queries automatically receive the `Claude_Browser` MCP server through the Agent SDK. No Chrome extension, external MCP configuration, or separate browser process is needed. Tools cover tabs, navigation/history, accessibility trees and element search, form input, mouse/keyboard input, screenshots/crops, page JavaScript, viewport size, console messages, and network requests. Normal Claude permission handling remains in effect; the integration does not set tool allowlists or bypass permission mode. Browser tools are not injected into read-only queries, one-shot generations, account/control queries, or SSH/container queries. Closing, interrupting, or replacing the owning query disposes its browser capability and releases its debugger connections.

**Codex:** enable Browser Use / unified computer use tools in the Codex environment. The installed OpenAI runtime discovers Sele as `iab` through its native browser transport. Sele does not install or copy a replacement OpenAI MCP server. A compatible installed runtime and tool configuration remain necessary.

## Layers

- `BrowserPanel` and `useBrowserAutomation` own renderer tab state and workspace selection. Chat keys include the provider ID. The renderer checks the browser setting before acknowledging each automation request, including when the panel is already mounted.
- `main/browser/BrowserAutomation.ts` owns Electron IPC, scoped tab access, webview/partition validation, CDP policy, and debugger leases. A revocable client represents a workspace capability. All providers share the same debugger ownership checks. This layer knows nothing about MCP or either provider's wire protocol.
- `main/browser/BrowserWorkspace.ts`, `BrowserAccessibility.ts`, and `BrowserInput.ts` implement reusable page operations over that client. They own element references, input sequences, screenshots, navigation, bounded console/network buffers, and action serialization. References expire on navigation and detach and are not reused between queries.
- `providers/codex/CodexBrowserBridge.ts` maps OpenAI's framed JSON-RPC transport onto the shared client. `CodexBrowserSessions.ts` handles Codex session registration/revocation. Browser mechanics do not belong in this adapter.
- `providers/claude/ClaudeBrowserTools.ts` defines the Claude tool schemas and maps arguments/results onto shared operations. The Agent SDK carries MCP messages over its existing control channel. `ClaudeProviderAdapter` owns registration and query lifetime. This adapter does not access Electron or implement page behavior.

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

Run `npm run test:browser-use` for isolated Electron integration coverage using the actual BrowserPanel and preload. It exercises Codex transport messages and Claude tools through the real MCP client/server protocol. Coverage includes navigation/history, typing/clicking, accessibility references, form filling, console/network reads, viewport changes, visible/hidden screenshots, tab management, disabled settings, shared debugger ownership, provider/workspace boundaries, and disposal. On Linux with a display, the offscreen fixture uses XWayland. It focuses fields through CDP mouse input before typing: DOM focus alone does not reliably focus Electron's embedded input widget. This does not change Sele's normal window configuration.

To also test installed runtimes:

```sh
SELE_BROWSER_RUNTIME=/absolute/path/to/browser/scripts/browser-service.mjs \
SELE_CLAUDE_RUNTIME=/absolute/path/to/claude \
npm run test:browser-use
```

The optional Claude check starts the actual Claude Code process and verifies it discovers `Claude_Browser` through the Agent SDK. It sends no prompt and performs no model inference. The MCP fixture separately invokes the implemented tools against real pages. `npm run test:codex-history` includes OpenAI permission routing checks.

OpenAI runtime validation uses Browser Use **26.901.31953**. Its isolated localhost fixture disables runtime security only inside the mock test host; it does not change application configuration or exercise the runtime's approval service.

## Current limits

Remote SSH/container forwarding, runtime-managed downloads, file upload, specialized authentication UI, and Desktop automated site-policy services are not implemented. Claude's viewport presets currently change size, not user agent or touch behavior. Console/network history starts when a session first attaches and retains at most 200 entries; network response bodies are limited by CDP's bounded buffer. Complex cross-process iframe interaction and non-flattened iframe attachment are not supported. Windows and macOS have not been exercised by the Linux integration test.
