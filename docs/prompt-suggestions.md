# AI prompt suggestions

Native Claude and Codex predictions appear in an empty, idle composer. **Tab** copies a
suggestion into the draft; **Enter** sends it. Both keycaps are clickable. **Escape** dismisses
it, and typing replaces it. Tab acceptance never sends. The setting is **Settings → Chat →
Prompt Box → Show AI prompt suggestions**, enabled by default with project overrides.
Suggestions are excluded from saved conversation views.

Claude uses the SDK's `promptSuggestions` option and `prompt_suggestion` events, keeping the
stream open briefly after completion. Codex uses `thread/prediction/request` and
`thread/prediction/updated`, correlated with the completed turn.

`CodexPromptSuggestions.ts` falls back to Desktop-compatible prediction only for an explicit
method-unavailable response (CLI 0.166.0 returns `-32601`). Authentication, quota, and transport
errors never trigger another generation. Reconnection probes native support again.

The fallback in `CodexDesktopPredictions.ts` uses account-authenticated
`/wham/predictions/config` and `/wham/statsig/bootstrap` for server prompts, eligibility,
sampling, and moderation. It excludes Plan mode/custom providers, then uses an ephemeral
prediction fork or `thread/sample` with `composer_predictions` metadata. It never adds a
prompt to the source transcript. Account/model restrictions apply; unavailable configuration
produces no suggestion. Desktop's beta billing treatment is not guaranteed for Sele.

New messages, account changes, reset, and shutdown cancel predictions and clean up temporary
threads. Credentials stay in the main process; temporary events do not enter visible history
or usage. To remove the fallback once native support is available, delete the Desktop delegate,
configuration module, and compatibility tests at the `CodexPromptSuggestions.ts` boundary.

Run `npm test -- CodexPromptSuggestions CodexDesktopPredictions ClaudeSendTransition` for provider events, persistence, and composer behavior.
Its GUI fixtures require the [isolated display](README.md).
