# Provider goals

Checked 2026-10-25 against the installed SDKs and upstream documentation. This is an API investigation plus fixture coverage, not a live model certification.

| Provider | Sele support | Native integration |
| --- | --- | --- |
| Codex | Existing goal controls | `thread/goal/get`, `set`, `clear`, and goal notifications |
| Claude | Set, replace, clear, and display active goals | `/goal`, `/goal clear`, `active_goal`, and native transcript attachments |
| OpenCode | Goal controls remain disabled | No native goal lifecycle found in the inspected SDK/API |
| Copilot | Set, replace, stop, and display active goals | Native goal command, canonical objective API, and objective change events |

Set goal is also available in a new chat for Codex, Claude, and Copilot. Saving starts a
session using the selected model, permissions, and workspace (including No Project or a
new worktree). Codex establishes the native goal before the first turn; Claude and
Copilot start through their native goal commands. Startup errors keep the goal dialog
open for retry, and any existing composer draft follows the new chat.

## Claude

Sele uses Claude's own evaluator and continuation loop. Setting a condition starts work; editing or clearing a running goal interrupts the turn before dispatching the command. Permission mode and model settings are preserved. One-turn attachments and skill prefixes are omitted so the slash command reaches the CLI intact.

The adapter checks `supportedCommands()` and waits for native acknowledgement. Unsupported commands, hook-policy rejection, disconnects, and timeouts surface as save errors. Conditions are limited to 4,000 characters; Claude's clear aliases cannot be used as literal conditions.

`active_goal` events drive the existing goal indicator, including goals set directly through chat. The installed Agent SDK **0.3.263** forwards this event despite omitting it from the `Query` iterator's `SDKMessage` type. Its explicit `SDKActiveGoalMessage` type is used at the event boundary. The token baseline in that event is not reported as consumed tokens.

Opening history recovers the latest main-session `goal_status` attachment from the records already read for the latest transcript page. This adds no full-history scan. Older-page navigation does not overwrite live goal state. A native clear, achieved verdict, or impossible verdict removes the active indicator. If the latest page contains no goal attachment, the next resumed query's native events supply current state.

Claude owns continuation and final-result boundaries; Sele does not generate extra continuation prompts. [Claude goal documentation](https://code.claude.com/docs/en/goal).

## Copilot

Sele uses **@github/copilot-sdk 1.0.26**, with bundled runtime **1.0.103**. The previously installed SDK 1.0.13 runtime rejects native goal creation with a session-not-found error. The upgrade also changes the SDK's factory permission request to a workflow permission request; Sele displays the new request using the same permission handling.

Goal controls are enabled after discovering the built-in `goal`/`autopilot` command and successfully reading `session.rpc.autopilotObjective.getState()`. Canonical state is restored on session opening and refreshed after `session.autopilot_objective_changed` notifications and turn completion. Sequence and session-identity checks discard stale responses. Older external runtimes without these APIs retain ordinary chat functionality with goal controls hidden.

Setting or editing invokes the native command, verifies the requested objective became active, and submits its returned prompt and display text with `agentMode: 'autopilot'`. Current model and tool permission handling remain in place; old message attachments and skill prefixes are not reused. Active work is interrupted before replacement. Local queued messages are held during the mutation, and Stop cancels a pending update before it can start another turn.

Command prompt reservations are finalized through the SDK's internal `internalRpc.commands.finalizeInvocationEffect` getter, isolated in `CopilotGoals.ts` and covered against the bundled runtime. It is intentionally absent from the SDK's public declarations. On failed admission, Sele releases the reservation and invokes native `off`: cancelling a reservation alone leaves the objective active in the checked runtime. Canonical state is re-read before publishing the result.

**Cancel uses Copilot's native `/goal off` behavior:** autopilot stops, the objective becomes paused, and Sele removes the active goal indicator. Copilot retains the paused objective for recovery; Sele does not delete or rewrite its objective file. Selecting Set goal can refocus that objective or replace it. Completed goals map to the shared completed state. AI-credit accounting is not presented as token usage or a token budget. The description field rejects native toggle words and credit-limit switches so they cannot silently alter command semantics.

Validation includes a temporary-profile native runtime test for command creation, replacement, reservation cleanup, and stopping, plus actual prompt admission to a held loopback HTTP fixture, abort, and cold session recovery. No hosted model inference or user account/profile is used. [Copilot command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [SDK RPC definitions](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/rpc.ts).

## OpenCode investigation

Installed **@opencode-ai/sdk 1.18.29** and the published session API expose prompts, commands, status, todos, and events; no canonical goal record, goal mutations, or goal-change event was found. This is a scoped finding, not a claim about every plugin or future runtime.

The SDK can dispatch custom commands through `session.command`, but a command named `goal` would not establish its persistence or continuation semantics. Supporting a plugin would require an explicit plugin-specific contract; native goal controls stay disabled. [OpenCode SDK/session API](https://opencode.ai/docs/sdk/).

## Validation

`npm run test:claude-history` includes goal command validation, native acknowledgements, active-turn replacement/clear dispatch, policy rejection, unsupported CLIs, concurrent saves, timeouts, and bounded history recovery. `npm run test:copilot` includes goal dispatch, discovery, lifecycle events, concurrency, Stop races, send failures, and native runtime fixtures. `npm run test:chat-goal` checks the shared indicator's edit, save, clear, and error behavior in an isolated Electron fixture.
