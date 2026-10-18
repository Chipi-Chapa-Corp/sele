# Codex interaction protocol

## Implemented flows

- MCP `form`, `openai/form`, and legacy `openaiForm`: standard fields, enums, titled enums, multiple selections, defaults, required fields, password presentation for write-only fields, and authoritative JSON Schema validation in the main process. More complex schemas use a JSON answer editor with the requested schema available for inspection. Remote schema references are not fetched. The renderer retains its existing Content Security Policy and does not run the schema compiler.
- MCP `url`: explicit opening through Sele's external-link handler, followed by the user's Continue, Decline, or Cancel response. Opening a URL does not automatically claim the interaction succeeded.
- Permission requests: existing approval state and sidebar actions, a full list of requested file/network access in the conversation, turn/session grants, and denial with an empty granted profile. The server remains responsible for enforcement. Unknown permission-profile fields are rejected rather than silently granted without being displayed.
- Device verification: availability checks, user-triggered native signing through `userVerification/verify`, proof forwarding, cancellation of the original native request, and cleanup on stop/disconnect. Supported, already enrolled devices can sign; unsupported runtimes or devices show an explicit unavailable state. Enrollment and provider-side credential registration are not implemented: the public local enrollment RPC alone does not register the credential with the backend. Specialized empty browser-authentication and strict-review requests still show unavailable states. Standard authentication URLs and nonempty schemas use the URL/form paths.
- Dynamic host tools: explicit registration, standalone/namespaced declarations, argument validation, advertisement on thread start/resume, inheritance on fork, dispatch, structured missing-tool errors, and a cancellation signal when the client is disposed.
- `currentTime/read`: host Unix time in whole seconds.

Requests retain the originating app-server/container for response routing. Existing resolution, stop, turn completion, and disconnect handling also remove elicitation prompts. Failed response delivery leaves the prompt available for retry.

## Registering a host tool

Host code can register an implementation on a `CodexAppServerClient` before starting or resuming a thread:

```ts
const unregister = client.dynamicTools.register(
  {
    type: 'function',
    name: 'echo',
    description: 'Return supplied text',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    }
  },
  async (args, context) => ({
    success: true,
    contentItems: [{ type: 'inputText', text: String(args.text) }]
  }),
  'demo'
)
```

This registers `demo.echo` as a host implementation. Local clients register `sele.computer` and the `chrome` namespace by default. Remote/container clients do not register these host capabilities. Read-only conversations cannot execute dynamic host tools. A model-supplied name cannot load or evaluate code. Restored private tools without a local implementation return a clear failure. Tool implementations must respect their cancellation signal and any access controls required by the operation they perform.

## Desktop tool coverage and boundaries

The public app-server protocol defines dynamic tool declarations and invocation, not a fixed inventory of ChatGPT Desktop's private host tools. Supporting `item/tool/call` alone does not implement the desktop's other capabilities.

| Public Desktop capability | Sele boundary |
| --- | --- |
| Built-in Browser / Browser Use | Existing Sele `iab` bridge; this patch adds general interaction forms around tools. |
| Computer Use / `@Computer` | Sele now supplies Linux native screenshot/input tools, through its own host tool rather than a private ChatGPT Desktop tool implementation. |
| Chrome extension / `@Chrome` | The bundled Sele Chrome extension attaches explicitly shared tabs in the user's existing profile. A second Browser Use bridge advertises `chrome`; dynamic tools also expose it directly. |
| Plugin tools | Tool names and operations come from each installed/authenticated service. MCP invocation is provider-owned; general forms and URL flows now have client UI. |
| Host-defined dynamic tools | The new registry supplies the transport mechanism. Exact tool behavior requires a registered implementation. |

References: [App Server](https://learn.chatgpt.com/docs/app-server), [Computer Use](https://learn.chatgpt.com/docs/computer-use), [Browser](https://learn.chatgpt.com/docs/browser), [Chrome extension](https://learn.chatgpt.com/docs/chrome-extension), [version-pinned user verification](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/README.md#user-verification-experimental).

## Account authentication and attestation

Normal ChatGPT account sign-in uses OAuth access and refresh tokens internally. Sele currently uses Codex's device-code login and Codex owns routine credential refresh. `account/chatgptAuthTokens/refresh` belongs to a different mode where the host application supplies and renews ChatGPT access tokens. It is not needed to reproduce Codex-managed account sign-in.

If a managed refresh credential is expired or revoked, signing in again is the appropriate recovery. Sele now detects account authentication failures and offers **Sign in again**, using the same recovery dialog as Claude. Device-code login renews the current account through Codex. Success clears the authentication-required state and restarts the affected client; cancel/failure preserves the existing account. This does not use API-key billing or externally supplied tokens.

Attestation is an optional upstream client trust token. Sele continues to advertise `requestAttestation: false`; there is no documented, integrated issuer for Sele to obtain a valid token from. It should only be enabled alongside a supported token issuer and a concrete upstream requirement, never with a placeholder token.

Validation: `npm run test:codex-interactions`, the existing Codex history/IPC tests, typechecking, and manual UI validation. Real third-party authentication, native biometric signing, Wayland compositor consent/capture, and private Desktop tool implementations are not certified by these mocks.

## Native computer and Chrome setup

Open **Settings → Browser & desktop**. These connections are shared by local Codex and Claude conversations with write access. Connections are not restored automatically after restarting Sele.

- **Connect computer** starts a stdio-only Linux helper. X11 uses `xdotool` and ImageMagick; Wayland uses the XDG RemoteDesktop/ScreenCast portals and GStreamer PipeWire. Python 3 with PyGObject is required; Wayland also needs Gst/GstApp introspection, `pipewiresrc`, `videoconvert`, and `pngenc`. The helper runs on the host through Sele's normal host bridge. Missing dependencies produce a visible error; Wayland never silently falls back to unrestricted X11 control.
- On Wayland, select a monitor and grant pointer/keyboard sharing in the system consent dialog. Disconnect in Sele or revoke sharing in the compositor to stop control. X11 has no system portal consent; the explicit Settings connection is the user's grant.
- **Open Chrome extension folder**, then load that folder using Chrome's **chrome://extensions → Developer mode → Load unpacked**. Generate/copy a pairing address in Sele, paste it into the extension, connect, then **Share current tab**. The address contains a temporary local bearer credential; treat it as private. Regenerating it or disconnecting Sele revokes the connection. Chrome 125+ is required for flattened iframe sessions.
- Only shared tabs and new tabs created through the paired extension are exposed. Each controlled tab is leased to one conversation. Unsharing, debugger cancellation, closing the tab, or disconnecting revokes access. Downloads require short-lived, single-use URL grants. The extension restricts CDP to page operations and tracked iframe targets.

Codex receives `sele.computer` and `chrome.*` dynamic tools. Claude receives `native_computer` and `chrome_*` tools in Sele's existing `Claude_Browser` SDK MCP server; the existing `computer` tool continues to control the embedded browser. Both expose screenshots, pointer/keyboard input, and browser tooling without changing provider inference/authentication.


Validation includes real private-display X11 screenshots and GTK typing (`scripts/tests/test-native-computer.py` through isolated-gui), portal coordinate/button unit checks, authenticated WebSocket pairing, tab leases/revocation, extension CDP boundaries, provider tool registration, and account recovery. No installed Chrome executable is available in this test environment, so a real extension-loaded browser session remains unverified. Wayland portal/GStreamer and native biometric flows need supported hosts/hardware for end-to-end validation. Native control is currently Linux-only.

## Claude Desktop tool audit

The useful overlap is Chrome automation and computer control. Sele now shares these capabilities with Claude through the integration above; it does not impersonate Anthropic's extension or claim identical private tool names.

Anthropic documents Chrome tools for tabs, navigation, page reading, input, console/network inspection, uploads, screenshots, and GIF recording. Sele's browser tools implement these operations; convenience wrappers such as `browser_batch`, extension shortcuts, and Anthropic's tab-group UI are not reproduced. The public documentation tells users to inspect `/mcp → claude-in-chrome → View tools` for the installed runtime's full tool list, rather than publishing a stable Desktop tool inventory. See [Claude Chrome integration](https://code.claude.com/docs/en/chrome).

Desktop extensions are local MCP servers with tool lists supplied by the individual extension; they are not one fixed set of Claude Desktop tools to hardcode. Sele's provider runtime can load configured MCP servers, but `.mcpb` Desktop-extension installation and its configuration UI are separate missing integration work. See [desktop and web connectors](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).

A shared MCP Apps host now renders interactive widgets for compatible Codex/Copilot runtimes. Claude/OpenCode runtime bridges remain unavailable; see [provider interaction coverage](provider-interactions.md). See [interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude). Private service authentication/credential-broker integrations likewise require their own supported integration.
