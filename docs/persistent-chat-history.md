# Persistent chat history previews

Sele stores the latest prepared message page in its existing SQLite database. This
lets a previously opened chat display saved messages after restart or after its
in-memory history has been evicted. The ordinary provider opening still runs in
parallel and replaces the preview when ready; this improves time to visible
messages without bypassing provider hydration.

The preview shows a small “Refreshing messages…” indicator. Drafting remains
available, while sending, editing, forking, continuing turns, and paging older
history wait for the fresh detail. A failed refresh leaves saved messages visible
with a Retry action. Preview revisions start at -1 so a provider's process-local
revision can replace a snapshot saved by an earlier process.

## Storage and validity

- Entries are scoped by provider, active account identity, environment/runtime,
  and chat ID. Preview reads require a freshly observed sidebar record and account
  configuration; uncertain scopes miss the cache.
- A fingerprint of native sidebar metadata (creation/update time, title, preview,
  working directory, import marker) must match. Live updates invalidate pending
  reads and writes. Account mutations and shutdown invalidate pending admissions.
- Only idle ordinary chats are admitted, after renderer payload preparation.
  Streaming chunks, queued messages, pending approvals/questions, authentication
  failures, done chats, commit chats, and older history windows are excluded.
- `chat_history_page` holds the fingerprint, format version, page coordinates,
  timestamps, and retained payload size. `chat_history_turn` holds ordered prepared
  turns with content hashes. Unchanged turn payloads are not rewritten.
- Transactions keep the page and turns consistent. Reads verify turn order, IDs,
  hashes, and coordinates; corrupt entries are discarded. Format version changes
  invalidate existing projections.
- Limits are 10 turns per page, 2,000,000 payload bytes per page, 100 pages,
  64,000,000 total payload bytes, and seven days. Writes prune expired and least
  recently accessed entries. These are payload limits, not SQLite file-size limits.
- RAM history takes precedence. Setting the recent-chat cache limit to zero also
  bypasses SQLite preview reads. Persistence is best effort and never required
  for the authoritative opening to succeed.

The provider remains the source of truth. This is a bounded display cache, not a
conversation archive or a replacement for native history storage.

## Verification

`npm run test:persistent-chat-cache` covers admission, namespaces, races, renderer
ordering/fallback, and a disposable native SQLite migration/restart fixture. The
native fixture also verifies incremental turn writes, corruption recovery, age,
LRU, and byte limits.

`npm run test:persistent-chat-opening` mounts the full app with synthetic providers,
a temporary profile, and real SQLite data. It verifies saved messages appear
while the provider reply is withheld, fresh detail replaces them, alternate send
paths stay blocked during previews, and a failed refresh can be retried. Run this
GUI fixture through the isolated-gui helper on a private display and D-Bus session.
