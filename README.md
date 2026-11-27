<p align="center">
  <img src="./assets/prod/t3-black-web-icon-192x192.png" width="88" height="88" alt="Sele logo" />
</p>

<h1 align="center">Sele</h1>

<p align="center">A desktop workspace for AI coding agents — an unofficial fork based on the open-source T3 Code codebase.</p>

<p align="center">
  <a href="https://github.com/Chipi-Chapa-Corp/sele/releases"><strong>Download</strong></a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="https://github.com/Chipi-Chapa-Corp/sele/tree/legacy-v1">Legacy v1–v3</a>
</p>

> [!NOTE]
> **Unofficial Fork Notice:** Sele is an independent, unofficial fork based on the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) source code. Sele is maintained by Chipi Chapa Corp and is **not** affiliated with, endorsed by, sponsored by, or maintained by T3 Tools, Inc. See [TRADEMARK.md](./TRADEMARK.md) and [LICENSE](./LICENSE).
>
> Looking for the original v1–v3 Sele implementation? It is preserved on the [`legacy-v1`](https://github.com/Chipi-Chapa-Corp/sele/tree/legacy-v1) branch.

Sele runs coding agents on your machine and brings conversations, diffs, worktrees, terminals, and remote environments together into one fast desktop interface.

It works with Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent you already have installed and authenticated on your computer.

## Install

Download the latest Windows, macOS, or Linux build from [GitHub Releases](https://github.com/Chipi-Chapa-Corp/sele/releases).

### Windows

Download and run `sele-windows-x64-setup.exe` from [GitHub Releases](https://github.com/Chipi-Chapa-Corp/sele/releases). Built-in auto-updates keep Windows installations up to date automatically.

### macOS (Apple Silicon)

Install with Homebrew:

```bash
brew tap chipi-chapa-corp/sele https://github.com/Chipi-Chapa-Corp/sele.git
brew install --cask chipi-chapa-corp/sele/sele
```

Or download `sele-macos-arm64.dmg` from [GitHub Releases](https://github.com/Chipi-Chapa-Corp/sele/releases) and drag **Sele** into **Applications**.

> [!IMPORTANT]
> Unsigned macOS builds can trigger Gatekeeper on first launch. If macOS says Sele is damaged or cannot be opened, clear the download quarantine flag and launch it again:
>
> ```bash
> sudo xattr -dr com.apple.quarantine /Applications/Sele.app
> open /Applications/Sele.app
> ```
>
> Subsequent in-app updates work automatically on unsigned macOS installs by verifying the release archive's SHA-256 digest and bundle metadata, clearing quarantine, and atomically replacing `Sele.app`.

### Linux (Flatpak)

Install from Sele's Flatpak repository (updates are delivered through Flatpak):

```bash
flatpak install --user https://chipi-chapa-corp.github.io/sele/flatpak/sele.flatpakref
```

Standalone `.flatpak` bundles and `.tar.gz` archives are also attached to [GitHub Releases](https://github.com/Chipi-Chapa-Corp/sele/releases).

## Development

Build and run locally from source:

```bash
vp install
vp run dev:desktop
```

See [docs/operations/00_development.md](./docs/operations/00_development.md) for the full development setup.

## License & Attribution

The source code is licensed under the [MIT License](./LICENSE), derived from the open-source [pingdotgg/t3code](https://github.com/pingdotgg/t3code) project. All Sele branding, icons, and distribution channels belong to Chipi Chapa Corp; T3 Code trademarks belong to T3 Tools, Inc.
