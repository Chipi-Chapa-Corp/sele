# Maintaining the compatibility inventory

The reviewed comparison lives in `features.json`. `snapshot.json` freezes the public-source metadata and installed Codex exports. `coverage-decisions.json` and `update-decisions.json` are explicit review decisions, including exclusions. This is a semi-deterministic audit: discovery and rendering are mechanical; interpreting feature scope and Sele behavior requires review.

## Offline rebuild

From the repository root:

```sh
python scripts/compatibility/build.py
python scripts/compatibility/build.py --check
```

The builder validates unique IDs, status values, source coverage, update coverage, reviewed source hashes/retrieval status, source-file existence, and evidence anchors. It then generates the report, flat CSV, standalone searchable HTML, and mechanical appendices. It rescans the current Codex adapter files for protocol method literals. A literal match is labelled only as a reference: it does not certify implementation, parameters, approvals, rendering, or execution.

The HTML file works locally without a server or network requests. Its external links are documentation references, not automatic fetches. CSV is UTF-8. The JSON catalog remains the editable source of truth.

## Refresh discovery

The collector uses Python 3 with `requests` and `beautifulsoup4`, and a locally installed Codex executable. Install Python dependencies in a temporary virtual environment if needed; they are not Sele application dependencies.

```sh
python scripts/compatibility/collect.py --out tmp/parity-refresh
```

It discovers every `/codex` navigation URL from the official feature index, normalizes query/fragment variants, retrieves each document's main article, records a hash of whitespace-normalized article text (excluding unstable framework markup IDs), and extracts the desktop update digest headings. For the full desktop changelog it hashes the entire main timeline and extracts every entry: each New Features bullet is a candidate; other announcements and fix-only entries receive an entry-level decision. The inspected CLI version's New Features section comes from its version-pinned primary GitHub release. It exports the installed CLI protocol using `codex app-server generate-json-schema --experimental`, and enumerates feature flags using `codex features list`. It does not start a chat, invoke a model, modify provider configuration, or launch a GUI.

The flag booleans are **effective values from the inspected installation**, not upstream defaults or a support claim. Removed, deprecated, experimental, and under-development flags stay in the mechanical inventory with their lifecycle stage. Exported experimental methods likewise do not imply public availability.

The collector writes a candidate snapshot and change report under `tmp/`. It does not overwrite reviewed files. Review additions, removals, changed pages, new release entries, schema changes, and failed requests before promoting that snapshot. After reviewing an updated source, update its `reviewed_sha256` and `reviewed_fetch_status` in `coverage-decisions.json`; a changed source cannot pass the builder on an old review decision.

For each discovered page, retain or add a decision:

- `Mapped`: list feature IDs or reference the page directly from feature rows.
- `Reference`: explain why this is a landing page, terminology, operational guidance, or another non-feature reference.
- `Excluded`: explain the desktop/CLI scope boundary.
- `Unavailable`: record retrieval failure rather than treating an empty response as complete coverage.

For each extracted update, map to feature IDs or explicitly classify it as excluded/reference. A source page can cover multiple feature rows, and multiple releases can update the same normalized capability. All entries in the published desktop changelog are accounted for, including fix-only entries and excluded mobile/cloud/enterprise entries. The weekly digest is a second discovery checklist. This is not a claim that all historical CLI releases or every bullet in the general ChatGPT changelog were ingested. The inspected CLI version's New Features section is ingested; its bug fixes, internal commit/PR lists, documentation updates, and packaging chores are not feature candidates. The standalone `codex mcp-server` was removed and is deliberately excluded from current parity gaps.

Source-page mapping is at topic level. It deliberately does not claim a one-row-per-subheading or one-row-per-sentence proof of exhaustiveness. The audit covers the public platform mechanisms and tool families, not an unbounded third-party connector catalog or a private model tool registry. Private tools cannot be enumerated authoritatively from app-server JSON Schema.

## Blocked historical sources

During this audit, direct HTTP requests to the Help Center and the general release index returned 403. The four Help Center articles were read through the available web tool, and are labelled accordingly; there is no content hash for those browser-mediated reads. The general product release index remains explicitly unavailable and is not used as evidence. A future automated refresh does not silently claim it re-read those sources. Re-read blocked sources through a working authorized browsing path, record the retrieval method, or leave them unavailable and narrow the coverage claim.

The macOS notes identify the older app as ChatGPT Classic. Do not combine Classic platform-specific history with the current desktop documentation as if every release applied to every app mode. The current official docs are authoritative for current desktop features, including the current voice capability; an earlier Classic voice retirement is not evidence that current desktop voice is absent.

## Evidence and review rules

Use `Implemented` only when Sele exposes the actual behavior. Add a source file and stable text anchor. `Partial` must name both the implemented subset and missing behavior. `Runtime` means provider/tool-dependent and not end-to-end verified. `Missing` means no native implementation found in the inspected source boundaries. Use `Unverified` when static evidence is insufficient.

The principal negative-search boundaries were `src/main/providers/codex/`, `src/shared/provider.ts`, `src/main/application.ts`, renderer settings/composer/workspace/components, and `docs/browser-use.md`. Provider schema existence, a feature flag, a skill name, a generic MCP transport, a similar-looking UI, or a tool-output label is insufficient to establish compatibility. In particular:

- Sele Done metadata does not call Codex archive/unarchive.
- Plan display does not activate the provider's plan mode.
- Code review comments do not call `review/start`.
- Connected-app toggles do not implement plugin installation or OAuth.
- Rendering a dynamic tool result does not handle a server-requested `item/tool/call`.
- An interactive visualization host is not a general Apps SDK/MCP UI widget host.
- Running `codex` in the terminal is a CLI escape hatch, not graphical parity.

Update the audit date, Sele commit/version, Codex version, source decisions, and assessments together. Rebuild, inspect the report, and run `--check`. If you validate any generated UI on Linux, follow the repository's isolated-gui requirement and use a fixture/separate profile; never launch against the user's existing desktop session.
