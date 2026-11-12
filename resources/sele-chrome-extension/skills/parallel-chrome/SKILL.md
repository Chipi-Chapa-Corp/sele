---
name: parallel-chrome
description: Use Sele's paired extension to operate the user's existing signed-in Chrome or Opera in background tabs while the user and other agent chats work concurrently. Applies on macOS, Windows and Linux; requires Sele's per-conversation browser tools.
---

# Parallel Chrome in Sele

Use the user's existing normal Chrome profile and sign-ins. Each conversation owns its own background tabs. This skill guides behavior; Sele's paired transport enforces tab ownership. Installing this skill alone does not connect a browser or add tools to standalone CLI sessions.

## Select the connection

Discover the provided tools. In Sele, Codex uses `chrome`; Claude uses the `chrome_*` tools from `Claude_Browser`. Other providers also expose Sele's Chrome tools. Ordinary `sele_browser` or browser tools without the Chrome prefix control Sele's embedded browser, which has a separate profile.

For Opera, use Codex's `opera` namespace or the MCP `opera_*` tools instead. Chrome and Opera can stay connected simultaneously with independent pairing addresses and ownership maps. Treat a tab's identity as its browser namespace plus numeric ID; IDs can overlap. Keep the same prefix for every observation, input, download and cleanup operation on that tab. Never disconnect Chrome or regenerate its address to add Opera, and never switch browsers to bypass a revoked grant.

Use the paired Sele extension for this workflow. If its tools or connection are unavailable, report the actual error and continue independent work. Do not switch to desktop input, an embedded browser, another profile, incognito, or an independent official Chrome connection as a workaround. Separate official integrations can have different ownership and permission behavior.

## Own background tabs

- Start by listing this conversation's tabs through the selected transport. Use only tabs created by this conversation, or a specific tab the user explicitly hands over.
- Create tabs with `foreground: false` (or the tool's documented equivalent). Never activate a tab or bring a window forward for routine browser work.
- Retain the returned tab IDs and pass an explicit owned ID to every observation and action. Never use the active/current tab as an implicit target.
- Read fresh tab-local UI before clicking or typing. Screenshots, element references and coordinates belong to that tab and document.
- Use only tab-scoped Computer Use input. Do not use the system mouse, keyboard, clipboard, native-app input, shell browser control or injected scripts to operate pages.
- A popup/new tab needs explicit identity and ownership before use; do not adopt every new tab. If the transport cannot grant it to this conversation, request a focused handoff.
- Close only this conversation's created tabs when they are no longer needed. Never close a user window as cleanup.

If the user takes over an agent tab, pause that tab until it is explicitly returned. Native dialogs, passkeys, CAPTCHAs and permission prompts may require a focused user handoff. Sharing a profile also shares account/cookie/server state: coordinate logouts, account changes and edits to the same remote object. This skill grants no extra authority for publication, purchases, messages, deletion or account changes.

## Reconnect without taking over

Pair each browser once through Sele Settings → Browser & desktop → Sele browser extension (Chrome and Opera), using that browser's own Generate/Copy buttons. Treat the pairing address as a credential; never print it or place it in logs. A normal Sele or browser restart retains pairing and reconnects automatically. Allow up to one minute for a cold extension retry, then inspect the error instead of repeatedly generating addresses. Reopen the popup to obtain fresh status; a restored setup page can show an earlier startup snapshot. Disconnect removes only the named browser's binding.

A transport interruption, Sele restart or service-worker suspension preserves ownership within the current Chrome session. Revalidate each owned tab after recovery. Full Chrome restart or extension reload revokes old tab grants while retaining pairing. Never reclaim a tab from its numeric ID alone or silently create replacement tabs to bypass a revoked grant. Report missing tabs and request a handoff when continuation needs them. Explicit Disconnect removes saved pairing.

## Verify what was observed

Use harmless fixture pages for input and isolation checks. Check per-chat ownership, inactive tab creation, screenshots and rejection of foreign tab IDs. Do not claim Windows/Linux live validation from a macOS test or claim physical pointer/focus preservation from page focus/visibility values. State which checks ran and which need the user's observation.
