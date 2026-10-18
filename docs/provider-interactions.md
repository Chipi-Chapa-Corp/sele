# Provider interactions and MCP Apps

## User input support

| Provider | Implemented path | Runtime boundary |
| --- | --- | --- |
| Codex | MCP forms, URLs, and supported enrolled-device verification; existing agent questions. | App-server requests and originating-client replies. |
| Claude | `onElicitation` now feeds the same form/link controls; `AskUserQuestion` remains supported. | Main-process validation; query abort/stop cancels the prompt. Ordinary questions are not treated as forms. |
| Copilot | `onElicitationRequest` is registered on interactive creation and resume; existing `onUserInputRequest` remains intact. | Form/URL replies are validated before removing the prompt. Native completion events, stop and disconnect clean up pending input. One-shot sessions do not advertise UI support. |
| OpenCode | Existing native `question.asked` / `question.v2.asked` and question reply/reject API. | The installed 1.18.29 SDK exposes no generic MCP elicitation event, callback, or response endpoint. Its native questions cannot be used as a substitute transport for arbitrary MCP forms. |

Form answers are validated in the main process using JSON Schema. Invalid answers leave the request pending. External interaction URLs accept HTTP(S), open only through Sele's external-link flow, and require an explicit Continue response. API credentials remain owned by their provider runtime.

## MCP Apps implementation

Sele now has a shared SEP-1865 host built with the official `@modelcontextprotocol/ext-apps` AppBridge. Completed tools with a captured UI resource offer **Open interactive app** in the transcript. The host initializes the view with its tool input/result and supports server tool calls, app-resource reads, external links, theme changes, resizing and teardown.

Two nested script-only sandboxed iframes run on `sele-mcp-app:`. Neither gets Sele's preload APIs, Node access, parent DOM access or storage. The outer frame relays only messages from its actual child and parent. Each app document has a validated, server-declared CSP; embedded frames and browser camera/microphone/geolocation/clipboard permissions are disabled. HTML is capped at 2 MB. The application renderer's script policy is unchanged.

Capabilities are bound in the main process to the renderer, originating conversation/runtime and MCP server. Views cannot select a different server. Model-only tools are excluded and rejected; tool arguments are validated. Widget tool calls and external links require an explicit confirmation in Sele. A read-only or externally owned Codex conversation cannot invoke widget tools. Closing the app, navigating/closing the renderer, or replacing/disconnecting the originating runtime revokes the capability; transport failures also fail closed.

| Provider | App bridge |
| --- | --- |
| Codex | Uses captured `mcpAppUi`/legacy resource associations, `mcpServer/resource/read` with the originating call ID, server-scoped tool discovery, and `mcpServer/tool/call`. Advertises the UI extension. Runtime feature policy (`enable_mcp_apps`) still applies. |
| Copilot | Opts interactive sessions into `enableMcpApps`, checks `capabilities.ui.mcpApps`, consumes captured `uiResource`, and uses `session.rpc.mcp.apps`. Pins `originServerName` to the source. The runtime MCP Apps feature gate must also permit it. |
| Claude | Its installed public Agent SDK exposes elicitation and server management, but no host-callable resource/tool bridge for existing CLI-managed MCP servers. The shared host is ready; this provider bridge remains unavailable. |
| OpenCode | Its installed public SDK exposes MCP management and resource discovery, but no equivalent host resource-read/tool-call bridge. This provider bridge remains unavailable. |

Widgets require their originating runtime and retained tool call to remain available; historical transcripts do not reconstruct expired widget sessions. Optional MCP Apps messaging/model-context injection, file export, dedicated custom origins, nested frames and privileged browser permissions are not advertised. This implements the standard MCP Apps bridge, not proprietary ChatGPT `window.openai` widget APIs.

Full widget coverage for Claude/OpenCode needs either public runtime bridge APIs or Sele-managed MCP connections that own both the tool and resource transports. Starting a second independent connection to a configured service would not reliably share the tool session or its authentication.

## Connector onboarding implementation path

Expose a single MCP connection UI with add (stdio command or remote URL), status/error, Sign in, Reconnect, Disable and Remove actions. Keep environment/project scope explicit and use native provider configuration and credential storage. Reflect needs-auth separately from a broken transport; complete sign-in before refreshing tools in running chats. This is different from LLM-provider account connections and account re-login.

- **Codex:** read/write MCP configuration, reload it, list server status, run `mcpServer/oauth/login` and consume its completion notification. Plugin package installation is a separate catalog flow; the public docs label the install/uninstall APIs as under development.
- **Claude:** use `claude mcp add/add-json/login/logout/remove` in the selected environment; use query status/reconnect/toggle methods for live sessions. Browser/callback and terminal-code flows need the same owned-process lifecycle as account login.
- **OpenCode:** bridge its typed `mcp.add`, connect/disconnect and auth start/callback APIs, persisting configuration through its config API where appropriate.
- **Copilot:** use MCP configuration add/update/remove, session start/restart/stop, OAuth login/respond and server-status events. These runtime APIs exist even though Sele's app-list methods currently return an empty list.

A shared status machine should distinguish disconnected, connecting, connected, needs authorization, failed and disabled. Retry must preserve the configuration; removing credentials must be an explicit separate action. No connector was installed or authenticated during this work.

## Planning and review comparison

Sele already displays plan/progress information (including Codex plans, Claude TodoWrite activity and Copilot plans/todos). Read-only access restricts capabilities. Neither is the provider's full plan-mode lifecycle.

| Provider | Native planning | Current Sele gap |
| --- | --- | --- |
| Codex | `collaborationMode` selects plan/default mode and its built-in instructions. | No mode selector or complete approve-plan-to-implementation flow. |
| Claude | `permissionMode: 'plan'`, plan files and EnterPlanMode/ExitPlanMode transitions. | The adapter chooses default/auto; plan tools can run but mode changes are not presented as a complete plan workflow. |
| OpenCode | Built-in primary agents `plan` and `build`, including their prompts and permission policies. | Normal prompt sends do not select the plan agent; a read-only sandbox is narrower than selecting that agent. |
| Copilot | Session `mode.set` and exit-plan-mode requests, separate from interactive/autopilot execution. | Plan/todo display and interactive/autopilot selection exist; native plan-mode entry/exit and its approval callback are not wired. |

The useful shared UI is **Plan / Implement**, current mode status, the proposed plan, and a user-controlled transition to implementation. Each adapter must translate the transition using the native API and respect the selected Access policy. Plan approval must not silently grant broader access or reset files.

Sele's existing review flow serializes the user's selected diff-line comments and prompt into an ordinary agent message. It works across providers and is suited to discussing or fixing those comments. Codex `review/start` instead starts the provider reviewer against uncommitted changes, a branch, a commit or custom instructions, then streams review findings and review-mode lifecycle items. Both workflows can coexist.

The installed Claude/OpenCode SDKs have no equivalent dedicated `review/start` endpoint: their review commands/agents/plugins run through their normal agent mechanisms. Copilot has review-related command/runtime configuration, but no matching dedicated typed review-start API in the installed SDK. A common **Review changes** action should use Codex's native reviewer where supported and explicit review instructions/agents elsewhere, without presenting those paths as identical.

Sources: [MCP Apps SDK/specification](https://github.com/modelcontextprotocol/ext-apps), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude plan mode](https://code.claude.com/docs/en/common-workflows#use-plan-mode-for-safe-code-analysis), [OpenCode agents](https://opencode.ai/docs/agents/). API details were also checked against the installed SDK declarations.

## Validation

`npm run test:provider-interactions` covers shared validation, adapter callbacks, cancellation, native resource/call routing, widget capability ownership/revocation and CSP. Existing provider suites cover transcript projection, SDK registration and lifecycle integration.

For the finite Electron integration test, agents must use isolated-gui with a test profile:

```sh
python /var/home/kitkat/.codex/skills/isolated-gui/scripts/desktop.py --session sele-mcp-apps start --size 1400x1000
python /var/home/kitkat/.codex/skills/isolated-gui/scripts/desktop.py --session sele-mcp-apps run --cwd "$PWD" --timeout 55 -- node scripts/tests/test-mcp-apps.cjs
```

The test uses the actual host, renderer and official view SDK. It checks the handshake, input/result delivery, isolated DOM/preload, blocked undeclared network access, action cancellation/approval, result update and close revocation. It uses a fake MCP backend and no inference or credentials. Real connector rendering/authentication and runtime feature rollouts remain service-dependent. File rewinding and OS notifications are deliberately out of scope.
