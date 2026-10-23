# Persistent queued and steering messages

Messages sent with **queue** or **steer** survive quitting, updating or crashing Sele
before the provider takes them.

## What is stored

`pending_messages` in Sele's SQLite database holds, per provider and chat, the
ordered list of messages the provider has not taken yet:

- queued messages, including steering held while a pending edit is open;
- steering already handed to the provider but not yet confirmed (`submitted`):
  - Claude: pushed into Claude Code's input, until the turn reports an idle result;
  - Codex: accepted by `turn/steer`, until Codex echoes it;
  - Copilot: sent with `immediate` mode, until the SDK folds it into the turn.

OpenCode stores steering on its server as soon as it is sent, so only its local queue
needs storing.

Each adapter saves the chat's complete list after every change. Unchanged lists are not
rewritten. When an adapter shuts down, it saves the final lists and then stops saving, so
tearing down live sessions cannot erase them. Attachments are stored as paths; pasted
images already live in the app's data directory.

## Restoring

The list is restored once per process, when the chat is first loaded:

- Claude: when the session state is first read;
- Codex: when the thread is first cached;
- Copilot: when the session is resumed;
- OpenCode: when the session state is first loaded.

Before that point, nothing is written for the chat, so publishing a chat before loading
its stored list cannot erase it.

The previous turn did not survive the restart, so restored messages wait in a **paused**
queue, exactly as after Stop. Steering keeps its label and waits ahead of queued
messages. Nothing is sent until the user acts. Sending a new message resumes the queue
in order, and the per-message send, steer, edit and delete actions work as usual.

Submitted steering is dropped instead of restored when the provider's own history shows
it arrived:

- Claude: a user record with the steer's id, or a `queued_command` attachment with that
  `source_uuid`, on the latest history page;
- Codex: a user message whose client id is the steer's `clientUserMessageId`;
- Copilot: a user message with the same text, recorded after the steer was created.

Covered by `npm run test:pending-messages` and the e2e `persistence` phase
(`npm run test:e2e -- --phase persistence`, on a private display).
