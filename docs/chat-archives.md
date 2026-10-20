# Chat archives

Chat rows have a menu with Pin/Unpin and Export. Export chooses a directory and creates a
uniquely named `.sele` file. Import sits between New chat and Search, previews the title,
turn count and source provider icon/name, and offers an environment selector before the provider. Provider availability is checked in
the selected Host, container or configured SSH environment. Selecting a provider updates the choice; the Import button starts import.
Imports open under the virtual Imported project, independent of sidebar grouping. Marking an imported chat done moves it to Done; reopening returns it to Imported. Import workspaces do not contribute entries to the project picker.

`.sele` version 1 is a gzip-compressed JSON `SeleChatArchive` (see `src/shared/chatArchive.ts`).
It contains the complete normalized transcript read directly from the provider, before
renderer pagination or payload limits: user/assistant messages, reasoning/progress, tools,
raw tool inputs/outputs, diffs, attachments, subagent transcripts and chat metadata.
Local attachment bytes and local Markdown image/video bytes are bundled; remote media URLs
remain URLs. Export fails if a referenced local attachment cannot be read. Exports never
overwrite an existing file. Reading/writing is limited to 512 MB of uncompressed archive data.

Import always creates a fresh native session in the selected environment. It seeds that session with the full
user/assistant text exchanges (no summarization). Each inherited user prompt starts with:

> Note: Previous dialog was managed by another agent, some tool calls were stripped.

Original tool history remains available for display in Sele, rather than being replayed as
foreign native tool events. Live approvals, interactive MCP apps, queued prompts and active
subagents from the archive are not resumed. Imported history is read-only; native message
editing and forking are disabled for imported conversations. Sending, streaming, approvals,
steering, stopping and later tools use only the selected provider's new native session.
There is no cross-provider switching or linked-session routing in the composer.

Host imports get a workspace under Sele's user-data `imports/<operation-id>` directory.
Container, SSH and Flatpak host runtimes create it under the target's
`~/.local/share/sele/imports/<operation-id>`. Model discovery, native session creation,
attachments and cancellation cleanup use that same target. Its identity is saved with the
chat and import record so reopening and later controls stay in that environment.
Attachments are restored there with generated filenames, and Markdown media links are
remapped. Source project paths in tool records remain historical metadata; project files
and credentials are not part of the archive.

The SQLite `imported_conversation` table retains the archived prefix and a baseline of native
synthetic message IDs, so Sele displays the original history once and appends new native
turns normally. Opening and streaming use bounded native cursor pages, combined with bounded
archive windows. Old tools initially load as headers; their full contents are read on expansion.
Cursor navigation keeps current status/approval metadata, and stream chunks reuse their history
boundary so a long response cannot invalidate the user's scroll position. Full transcript reads
are reserved for export. A worker handles archive decompression, validation, copying, attachment/Markdown remapping and persisted JSON parsing/serialization so these operations do not run on the app thread. Previewing retains the archive in the worker and sends only metadata to the renderer. Cancellation terminates preparation immediately and waits for an in-flight destination write before workspace cleanup. A separate small summary column keeps sidebar listings from parsing full
tool transcripts. Imported records are keyed by destination provider/session, with no source
chat mutation. Source subagents are read-only, with their own paginated archived history.

Cancel closes the dialog immediately and prevents that import from opening. Provider work
already in flight is allowed to settle without sending a prompt. Partial native sessions
remain persistently hidden; temporary attachment/workspace files and archived payloads from
cancelled attempts are discarded. Provider/import errors retain the preview for retry.

Validation:

- `npm run build`
- `npm run test:chat-archive` (GUI part must run through the isolated-gui helper on Linux)

The suite uses temporary SQLite/provider fixtures and a private Electron profile. It covers
full archive round trips, assets, native history codecs, all four destination routing paths,
restart, previews, file-dialog contracts, errors/retry, cancellation and sidebar/UI behavior.
It does not start paid model turns.

Container/SSH writes wait for a unique readiness marker from the destination shell before
sending stdin. Container startup can consume early stdin (a real distrobox probe lost the
first 32 KiB without this handshake). Claude and Copilot verify persistence before an import
succeeds; OpenCode verifies imported IDs through its native API. A failed idle Claude send is
rejected back to the composer without silently queuing that same prompt for a future retry.
