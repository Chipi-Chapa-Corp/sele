# Chat archives

Export from a chat row's menu to a uniquely named `.sele` file. Import previews the title,
provider, and turn count, then creates a fresh native session in the selected environment
and provider. Imported chats appear under the virtual Imported project.

`.sele` v1 is gzip-compressed JSON defined by `src/shared/chatArchive.ts`. It includes the
complete normalized transcript, tools, diffs, attachments, subagents, and chat metadata.
Local attachments and Markdown media are bundled; remote media stays as URLs. Missing
local files fail export. Archives are limited to 512 MB uncompressed and never overwrite
existing files. Project files and credentials are excluded.

Import seeds full user/assistant text exchanges without summarization, marking inherited
prompts as dialog from another agent with stripped tool calls. Original tools/subagents
remain read-only display history. Approvals, widgets, queues, and active subagents are not
resumed. Editing/forking inherited history is disabled; later work uses the new native
session and its permissions.

## Implementation

`ChatArchive.ts` and its worker handle validation, compression, assets, and remapping away
from the app thread. Preview keeps the payload in the worker. SQLite `imported_conversation`
retains the original prefix and synthetic native-message baseline to prevent duplicate
history. Opening/streaming combine bounded native pages and archive windows; tool bodies
load on expansion. Full reads are reserved for export.

Host workspaces live in user data under `imports/<operation-id>`; remote/container and
Flatpak host targets use `~/.local/share/sele/imports/<operation-id>`. Persist the destination
identity for reopening and controls. Remote writes wait for a shell readiness marker before
sending stdin, and native import paths verify persistence before reporting success.

Cancellation closes the dialog and prevents navigation. Preparation stops, in-flight writes
settle before cleanup, and partial native sessions stay persistently hidden. Temporary files
and archived payloads are removed. Errors retain the preview for retry.

Run `npm run test:ui -- chat-archive`; its GUI portion needs [isolation](README.md). The suite uses
temporary SQLite/provider fixtures and starts no paid model turns.
