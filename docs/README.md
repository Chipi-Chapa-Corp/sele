# Repository guide

See the root [README](../README.md#development) for setup, build commands, and test conventions.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/main/providers/` | Provider adapters, runtime processes, accounts, and native history |
| `src/main/database/` | SQLite workers, preferences, and durable conversation views |
| `src/main/browser/`, `src/main/desktop/` | Embedded browser and explicit desktop/Chrome connections |
| `src/main/mcpApps/` | Interactive MCP widget host |
| `src/preload/` | Renderer IPC bridge |
| `src/renderer/src/` | React UI; workspace coordination lives in `workspace/` |
| `src/shared/` | Shared types and IPC contracts |
| `scripts/tests/`, `scripts/e2e/`, `scripts/benchmarks/` | Integration fixtures, end-to-end checks, and benchmarks |
| `.github/workflows/`, `build/`, `Casks/` | Releases and packaging assets |

Provider runtimes own inference, authentication, and native transcripts. Sele adapts them
to shared UI contracts and stores its own metadata and display projections in SQLite.
Keep host operations in the main process and expose them through validated IPC.

## Implementation notes

- [Conversations](conversations.md): opening, paging, queued messages, linked chats, and restart recovery.
- [Accounts](per-chat-accounts.md): routing and credential isolation.
- [Chat archives](chat-archives.md): export format and native-session import.
- [Browser and desktop](browser-use.md): provider integration and access boundaries.
- [Provider interactions](provider-interactions.md): forms, host tools, widgets, and goals.
- [Prompt suggestions](prompt-suggestions.md): native predictions and the Codex fallback.
- [Performance](performance.md): workers, incremental updates, rendering, and profiling.
- [Updates](auto-updates.md): packaging requirements and release checks.

For Linux GUI checks, use the `isolated-gui` skill's private display and D-Bus session
with fixture profiles. Never use the inherited desktop or session bus. Keep generated
reports in `test-results/` or `benchmark-results/` and scratch files in `tmp/`.
