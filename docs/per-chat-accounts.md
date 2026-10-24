# Per-chat accounts

Codex and Claude chats keep a saved account selection. Selecting an account in a
chat changes only that chat; selecting one in Settings or the new-chat screen
changes the default for future chats. Existing chats keep their credentials,
including while running and after restarting Sele.

Native history stays shared. Discovery binds older chats to the current default
when first encountered. Forks and linked-chat summary forks inherit their source
chat's account. The sidebar account picker, usage limits, model catalog, and
reauthentication use the selected chat's account.

Provider runtimes are pooled by account and retain the existing environment
isolation. Switching one chat releases only its old session and preserves
monotonic UI revisions. Background retries, queued sends, approvals, subagents,
and edits route through the saved binding. Missing credentials fail without
falling back to a different account.

Codex app-servers use a zero inactive-thread unload delay. A chat account switch
drains operations already opening that chat, stops its active turn, and waits for
`thread/closed` after unsubscribing before saving the new account. The unsubscribe
response alone does not release Codex's writer lock. Other chats keep their
runtime and writer ownership. A failed handoff preserves the previous binding.

Codex's account-view helper is version 5. The outer launcher watches changes to
unbound settings sessions; chat launchers explicitly pin credentials. The helper
no longer stops a pinned process when the global default changes. The existing
one-time helper setup upgrades older installations when a managed account starts.

Run `npm run test:chat-accounts` for account routing, credential isolation, and
SQLite upgrade/persistence checks. `node scripts/tests/test-account-limits.cjs`
checks the picker UI; run it with the isolated GUI helper.

With Codex installed, `node scripts/tests/test-codex-account-handoff.cjs` checks
writer exclusion and repeated handoffs between two real app-servers sharing a
temporary profile, including preservation of a sibling chat's ownership. It uses
fixture history without sending an inference request or accessing user accounts.

`node scripts/tests/test-chat-account-switch.cjs` exercises the real Electron IPC
validators together with the actual picker, account-switch handler, usage hooks,
and usage display. It verifies both new-chat and existing-chat account switches
using distinct usage values, statistics replacement, and a preserved chat binding.
Run this fixture with the isolated GUI helper as well.
