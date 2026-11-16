# Sele reporting service proposal

Status: **deferred at the owner's request on November 16, 2026**. Omit AI reporting
from the current release work: no reporting UI, provider feedback integration,
collection backend or server routing changes. No server configuration, containers,
routes, databases or deployed applications were changed.
The investigation and conditional design below are retained for future reference.
Encrypted LAN transport has since been implemented separately; see
[the mobile transport documentation](mobile.md).
Whether Sele needs developer-directed AI-content reporting remains unresolved;
this scope decision does not establish a Google Play policy exemption.

## What the two release changes mean

**Encrypted LAN transport** protects the direct connection between a phone and
desktop Sele. The current server uses HTTP and unencrypted WebSockets for pairing,
messages, files and workspace actions. The intended replacement is HTTPS/WSS with
a verified computer identity. The phone must verify the computer during pairing,
remember that identity across address changes, and reject unexpected identity
changes and plaintext downgrade attempts. This requires changes in desktop Sele
and Android, including its native network handling. It does not require sending
normal workspace traffic through this reporting server.

**In-app AI reporting** gives a user a way to flag an offensive AI response and
send that selected content to the developer without leaving Sele. Google's
[AI-generated-content policy](https://support.google.com/googleplay/android-developer/answer/13985936)
explicitly includes apps whose central feature is AI chatbot interaction. Applying
that requirement to Sele was an initial assessment, not a confirmed Play decision.
Google's [scope guidance](https://support.google.com/googleplay/android-developer/answer/14094294)
also excludes certain productivity apps and apps that only host existing generated
content. It does not explicitly resolve remote desktop companion clients. Sele
can initiate new prompts, so the viewing-only exclusion is not an obvious match;
its coding-workspace/companion role deserves a policy applicability check. A user
bringing their own subscription does not establish either inclusion or exemption.

## Provider reporting investigation

Reporting to the model provider and satisfying a Play requirement for Sele are
separate questions. Provider feedback may let us avoid operating a separate
collection service, but we have not verified that Google accepts it as sufficient
if Sele is in scope. Do not implement or certify compliance on that assumption.

| Provider | Verified route | Integration status |
| --- | --- | --- |
| OpenAI Codex | App-server `feedback/upload`; OpenAI's content-report form also explicitly lists Codex | A real programmatic integration candidate. Confirmed in local Codex 0.169.0 generated schemas and official app-server docs. Sele has not exposed it yet. |
| Anthropic Claude Code | Native `/feedback` (`/bug` follows the same reporting path); Anthropic also publishes a safety-reporting contact | Native flow exists. A supported direct Agent SDK submission method has not been verified. The installed SDK's `SendFeedbackInput` describes a draft tool, not proof of direct submission. |
| GitHub Copilot | Native CLI `/feedback` | GitHub explicitly lists the feedback dialog as CLI-only and unavailable through the SDK. Do not treat `/feedback` sent as an ordinary SDK chat message as a completed report. |
| OpenCode | Official troubleshooting docs provide a GitHub technical-issue route | A universal private AI-content reporting API was not identified in this investigation. Content reporting would depend on the configured underlying provider; technical bug reports are a separate flow. |

Codex's upload parameters include classification, reason, thread ID, logs and
extra log attachments. A generic feedback upload is not necessarily a dedicated
offensive-content report. Inspect actual payload, supported classifications and
provider acknowledgements before integration. Do not promise that only a selected
message is transmitted unless that behavior has been verified.

Claude Code documents five-year retention for transcripts explicitly shared via
its feedback path. Any integrated flow must disclose the actual payload and
retention, preserve provider/organization opt-outs, and require explicit consent.
No provider feedback or content report was submitted during this investigation.

Primary sources checked November 16, 2026:

- [Codex app-server feedback/upload](https://learn.chatgpt.com/docs/app-server)
- [OpenAI content reporting, including Codex](https://openai.com/form/report-content/)
- [Claude Code feedback and retention](https://code.claude.com/docs/en/data-usage)
- [Anthropic safety reporting](https://support.claude.com/en/articles/10684638-report-block-and-remove-content-from-claude)
- [Copilot CLI feedback](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices)
- [Copilot SDK limitations](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/compatibility)
- [OpenCode technical issue reporting](https://opencode.ai/docs/troubleshooting/)

### Draft question for Google Play policy support

> Sele for Android is a remote companion for an open-source desktop coding
> workspace. Users pair with their own computer over a local network. They bring
> their own provider accounts/subscriptions; desktop-installed Codex, Claude Code,
> Copilot or OpenCode runs the provider sessions. The Android app renders streamed
> sessions and workspace tools, and allows users to send prompts through their
> computer. Sele's developer supplies no hosted inference service and does not
> receive normal conversation content. Does this fall within the AI-generated-
> content policy, or does its productivity/remote-client role place it outside
> that scope under the documented limited-scope exceptions? If
> in-app reporting is required, is a user-confirmed in-app submission directly to
> the relevant provider's supported feedback/reporting endpoint sufficient, or
> must reports also reach Sele's developer?

This is a draft only; no support message has been sent. The investigation supports
deferring the collection service, not declaring Sele exempt or ready for submission.

## Deferred implementation

No reporting backend or provider-report integration is included in this release.
If this is resumed, first resolve policy applicability and provider integration,
then prepare a separate privacy and deployment review for the selected approach.
