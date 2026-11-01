# AI prompt suggestions

Sele displays native Claude and Codex predictions for your next prompt as ghost text in an
empty, idle composer. Press **Tab** to copy a suggestion into your draft, then edit or send it.
Press **Escape** to dismiss it, or start typing your own prompt. Accepting never sends a message.

The setting is **Settings → Chat → Prompt Box → Show AI prompt suggestions**. It is enabled
by default and supports project overrides. Suggestions stay out of saved conversation views.

Claude uses the Agent SDK's `promptSuggestions` option and `prompt_suggestion` stream events.
The stream stays open briefly after the turn's result to receive the prediction. Codex uses
`thread/prediction/request` and `thread/prediction/updated`, correlated with the completed turn.
Unsupported requests, skipped predictions, and late results do not interrupt normal chat.

Providers can skip predictions, and account, model, configuration, or CLI version restrictions
still apply. See the [Claude SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript#sdkpromptsuggestionmessage)
and [Codex prediction availability](https://help.openai.com/en/articles/20001601-composer-predictions-in-codex).

Run `npm run test:prompt-suggestions` to check provider events, persistence, and composer keyboard
behavior. The UI checks use a separate fixture profile. Agent-owned GUI runs must use the
isolated-gui helper described in the workspace instructions.
