# Codex work across Sele restarts

Sele's persistent Codex clients connect through a detached runtime that owns the
original app-server stdio connection. App shutdown detaches the UI; it does not
terminate that runtime or unsubscribe its threads. Opening Sele again attaches
to the same provider process, restores thread ownership and client-tool permissions,
and reads fresh native history for its owned threads. It never replays `turn/start`.

The runtime is scoped by the Sele profile, Codex account, execution environment,
and configured Codex home/executable. It accepts one authenticated UI connection
on loopback. Its capability token and endpoint live in the private profile.
Concurrent startup uses a launch lock. A second live client cannot take over the
existing connection. There is no fallback that silently starts another writer.

Native commands and model work can finish while the UI is closed. Unresolved
approvals and questions remain pending until the UI reconnects. Client tools that
need Sele's browser or desktop wait for the UI when they have not started. If a
client tool was already dispatched when the UI disappeared, its result becomes an
explicit unknown-outcome failure; the runtime never repeats that action itself.

Detached runtimes exit after five idle minutes, only when no active turns,
unresolved server requests, or in-flight RPCs remain. Explicit account/runtime
resets still stop the worker. One-shot title generation continues to use disposable
processes. Saved message queues retain their existing paused-on-restore behavior.

This protects against Sele's normal shutdown and frontend/main-process crashes.
It does not make work survive an OS shutdown, a provider/runtime failure, a lost
remote connection, or deliberate termination of the entire app sandbox. The change
applies to Codex; other providers retain their existing process lifetimes. Existing
workers created by older builds cannot be transferred into the detached runtime.

`npm run test:codex-transport` uses real detached Node processes and fake providers.
It kills a frontend during an accepted turn and verifies completion by the same
provider PID with one submission, reconnects pending approvals, checks initialization
and RPC-ID races, prevents client-action replay, and checks exclusive attachment
and idle cleanup. No real provider, account data, or application window is used.
