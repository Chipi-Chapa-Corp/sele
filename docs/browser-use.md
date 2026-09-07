# In-app browser automation

Sele exposes its existing BrowserPanel to the installed OpenAI Browser Use runtime through the runtime's native browser transport. This preserves the runtime's CUA tools and accessibility actions; Sele does not install or copy a replacement MCP tool server.

Enable the in-app browser in Sele settings and enable the Browser Use / unified computer use tools in the Codex environment. Restart Sele after installing this change because the transport and preload run outside renderer hot reload. The runtime discovers Sele as `iab`; tabs follow the configured global, project, or chat browser workspace. Handoff displays the selected tab. Background tabs retain their viewport so screenshots work while the browser panel is hidden.

The main process publishes a private native-endian, length-prefixed JSON-RPC socket under `/tmp/codex-browser-use` (a named pipe on Windows). Only local Codex sessions registered by Sele are accepted. Tab operations are checked against the session's browser workspace and the browser webview partition. Browser-global CDP commands and access to the Electron shell are rejected. Disposing the Codex client removes its registered sessions.

Ordinary Browser Use permission elicitations appear in the existing Allow/Deny UI. Authentication challenges, nonempty input forms, and requests requiring strict automated review are not converted into ordinary approvals. The runtime continues to own its browser security policy.

## Verification

Run `npm run test:browser-use` for isolated Electron integration coverage using the actual BrowserPanel and preload. It checks discovery, CDP events, navigation, clicks, typing, screenshots, tab closing, and session/tab boundaries. `npm run test:codex-history` includes permission routing checks.

To also run the installed runtime against the fixture:

```sh
SELE_BROWSER_RUNTIME=/absolute/path/to/browser/scripts/browser-service.mjs npm run test:browser-use
```

Validated with Browser Use `26.901.31953`: runtime discovery, accessibility snapshots/actions, visible and hidden screenshots, tab handoff, navigation, back/forward/reload, and closing. The isolated localhost fixture disables runtime security only inside its mock test host; it does not change application configuration or test the runtime's approval service.

## Current limits

This is the native browser integration, not complete ChatGPT desktop feature parity. Remote SSH/container socket forwarding, runtime-managed downloads, specialized browser authentication UI, and automated safety review services are not implemented. Non-flattened iframe target attachment is unsupported. Windows and macOS transports have not been exercised by the Linux integration test. A compatible installed runtime and tool configuration are required; this bridge alone does not add tools to a Codex session.
