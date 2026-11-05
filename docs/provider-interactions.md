# Provider interactions

## Questions and forms

Codex, Claude, and Copilot route supported MCP forms/URLs into shared controls; OpenCode
uses native question events and replies. Validate form answers with JSON Schema in the main
process; invalid answers remain pending. Open URLs through the external-link handler and
require explicit Continue. Preserve the originating runtime for replies and clear requests
on stop/disconnect. Failed delivery remains retryable.

Codex also handles permission profiles, supported enrolled-device verification, and
`currentTime/read`. Unknown permission fields are rejected. Device enrollment, specialized
empty browser-auth requests, and strict automated review are unavailable. Authentication
uses Codex-managed device login/refresh; **Sign in again** recovers expired credentials.
`requestAttestation` stays false without a supported issuer.

Register Codex host implementations with `CodexAppServerClient.dynamicTools.register`
before starting/resuming threads. Declarations carry JSON schemas; implementations receive
a cancellation context. Forks inherit declarations. Missing implementations fail explicitly;
read-only and remote/container conversations cannot acquire local host capabilities. Codex's
scoped Browser pane tools are also available in local Distrobox/Toolbox conversations.
See `CodexDynamicTools.ts` and the [browser/desktop integration](browser-use.md).

## MCP Apps

`src/main/mcpApps/` hosts captured tool UI resources through the official MCP AppBridge.
Codex and Copilot bridge to the originating runtime/server; Claude and OpenCode lack the
required host resource-read/tool-call bridge. Runtime feature gates still apply.

Views run in nested script-only sandboxed iframes on `sele-mcp-app:` without preload,
Node, parent DOM, or storage access. Validate declared CSP; cap HTML at 2 MB. Capabilities
bind renderer, conversation, runtime, and server. Validate tool arguments, reject model-only
tools, and require confirmation for widget tool calls/external links. Read-only/external
Codex chats cannot invoke widget tools. Closing or disconnecting revokes capabilities.
Historical transcripts cannot reconstruct expired widget sessions.

## Goals

| Provider | Integration |
| --- | --- |
| Codex | Native `thread/goal/get`, `set`, `clear`, and notifications. |
| Claude | Native `/goal`, `/goal clear`, `active_goal`, and history attachments. |
| Copilot | Native goal command, canonical autopilot objective API, and change events. |
| OpenCode | Controls disabled without a native goal lifecycle. |

Goals can start new chats with the chosen model, access policy, and workspace. Native
runtimes own continuation; Sele does not synthesize continuation prompts. Replace/clear
interrupts active work and waits for native acknowledgement. Preserve permissions and reject
stale responses. Errors keep the dialog available for retry.

Claude discovers command support and recovers goal state from the latest history page.
Copilot checks command/objective APIs; unsupported runtimes keep ordinary chat. Its private
command-reservation API is isolated in `CopilotGoals.ts`. Cancel invokes native `/goal off`,
leaving a paused recoverable objective; AI credits are not token usage.

## Provider errors

All four providers classify account rate, quota, and billing allowance failures as
`failureReason: 'rateLimit'`, displayed as **Usage limit reached** with the provider's
original error details and available reset/continuation controls. Classification uses
native error codes and HTTP status before falling back to error messages. Ordinary
assistant text and tool output are not classification inputs. Request context, output,
and execution-budget limits remain ordinary failures.

`src/shared/providerErrors.ts` owns limit detection for transcript rendering, OpenCode's
live retry loop, and the automatic network retry guard. Usage limits and authentication
failures never enter Sele's network retry flow. Claude native assistant errors end their
turn as failures and preserve pending messages; only authentication errors lock the account.

Settings → Chat → **Failure Retries** includes **Continue on usage reset** (on by default,
with project overrides). When enabled for a submitted turn, its first confirmed usage-limit
failure adds the configured Continue prompt to the durable **On Limit Reset** queue. The
provider must report a future reset time. Duplicate terminal events do not add more prompts;
a Stop or new send during reset lookup cancels the pending insertion. Continuations retain
the turn's model, permissions, container and account, without resending attachments or review
requests. Outbox delivery rearms this policy for subsequent turns. Failed turns no longer
show a **Continue in …** button; queued prompts remain visible and removable in the queue.

Run `npm run test:provider-errors` for cross-provider classification and retry regressions.

## Checks

`npm run test:provider-interactions` covers validation and widget ownership/CSP.
`test:codex-interactions`, `test:claude-history`, and `test:copilot` cover native paths;
`test:chat-goal` and `test:mcp-apps:ui` include GUI fixtures. Run GUI portions on the
[isolated display](README.md) with temporary profiles.
