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
| `src/main/localAccessServer.ts`, `registerLocalAccess.ts`, `clientIpc.ts` | Opt-in LAN server, access settings, and shared client operations |
| `src/renderer/src/` | React UI; workspace coordination lives in `workspace/` |
| `src/shared/` | Shared types and IPC contracts |
| `scripts/tests/`, `scripts/e2e/`, `scripts/benchmarks/` | Integration fixtures, end-to-end checks, and benchmarks |
| `.github/workflows/`, `build/`, `Casks/` | Releases and packaging assets |

Provider runtimes own inference, authentication, and native transcripts. Sele adapts them
to shared UI contracts and stores its own metadata and display projections in SQLite.
Keep host operations in the main process and expose them through validated client operations.
`handleClientRequest` and `onClientMessage` register operations for both Electron and authenticated
LAN clients. Native dialogs, window controls, updates, and desktop automation stay on desktop-only
IPC. The shared renderer bridge lives in `src/shared/rendererBridge.ts`.

## Implementation notes

LAN checks: `npm test -- localAccessServer` runs network/transport tests without a display.
After building, `npm run test:ui -- local-access` exercises the real renderer over HTTP with fixture
providers; append `-- --dev` to check the Vite proxy. Run these GUI checks with `isolated-gui`.

Android uses `capacitor.config.ts`, `vite.mobile.config.ts`, and the native `android/` project.
`npm run build:android` produces the debug APK; setup is documented in the root README.
`npm test -- mobileConnection` checks connection parsing, persistence, and host isolation.
With built mobile assets, set `SELE_TEST_MOBILE_WEB=1` for the local-access UI fixture to exercise
the packaged client at its app origin. Set `SELE_ANDROID_TEST_SERIAL=emulator-<port>` instead to
test the APK in an already booted, agent-owned emulator; `SELE_ANDROID_ADB_PORT` selects its
ADB server. Neither test mode contacts real provider accounts. GUI and emulator work must use
`isolated-gui`; native testing requires a working emulator or separately authorized device.

- [Mobile](mobile.md): Android wrapper, LAN pairing, adaptive UI, and emulator verification.
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
