# Linked chats

Any sidebar chat can be dragged into the composer. The drop target reads "Drop chat to attach"
and the chat becomes a context chip. While the chip loads, Send (including Enter) is disabled; the
chip's cross cancels loading. A failed chip shows its error and also blocks Send until dismissed.
A chat cannot link itself, a chat is linked at most once per message, and up to five chats can be
linked. Chips live in the composer only (they are not saved with drafts) and are restored if a
send fails.

Loading calls `provider:prepare-linked-chat-context`. The main process forks the complete source
chat into a hidden chat (`purpose = 'linkedChat'`, never listed, like commit chats) and
summarizes the fork; the source chat is unchanged:

| Provider | Summary source |
|---|---|
| Claude | `/compact` in the fork. The `isCompactSummary` transcript entry, with resume instructions removed, plus the recent messages Claude kept verbatim (`compactMetadata.preservedMessages`). |
| OpenCode | `session.summarize` in the fork. Text of the `summary` assistant record. |
| Copilot | `history.compact()` in the fork. Its `summaryContent`. |
| Codex | Compaction output is encrypted (`compaction.encrypted_content`), so the fork is sent the configurable prompt (Settings → Chat → Linked Chats; default `Write a markdown summary of this thread for context of another agent`). Its final answer. |

Cancellation aborts the operation and stops the fork's turn. Sending prepends:

```
# Linked chats
<linked-chat-context name="..." provider="codex" chat-id="...">
summary
</linked-chat-context>
# User request:
request
```

`provider` and `chat-id` let Sele open the source. The message view removes this section and shows
each linked chat as a chip; clicking it (in the message or the composer) opens the original chat.

Validation: `npm run test:linked-chats` (the GUI part runs through the isolated-gui helper on
Linux). Provider work is stubbed; no model turn is started.
