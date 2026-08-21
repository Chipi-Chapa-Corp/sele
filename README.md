# Sele

A focused desktop workspace for working with AI coding agents across local projects.

![Sele showing an agent conversation, code changes, and project files](screenshots/sele-main.png)

Sele keeps conversations, project context, diffs, file editing, and terminal sessions together
in one desktop app. It supports OpenAI Codex, Anthropic Claude Code, GitHub Copilot, and
OpenCode.

## Install

Download the latest Windows, macOS, or Linux package from
[GitHub Releases](https://github.com/Chipi-Chapa-Corp/sele/releases/latest).

Install the Linux Flatpak from Sele's update repository:

```bash
flatpak install --user https://chipi-chapa-corp.github.io/sele/flatpak/sele.flatpakref
```

The repository descriptor is also available as
[`sele.flatpakrepo`](https://chipi-chapa-corp.github.io/sele/flatpak/sele.flatpakrepo) and
as a downloadable asset on each GitHub Release.

Install on macOS with Homebrew:

```bash
brew tap chipi-chapa-corp/sele https://github.com/Chipi-Chapa-Corp/sele.git
brew install --cask chipi-chapa-corp/sele/sele
```

> [!IMPORTANT]
> macOS builds are currently unsigned. If Gatekeeper says Sele is damaged, corrupted, or
> cannot be opened, remove the download quarantine and start the app again:
>
> ```bash
> sudo xattr -dr com.apple.quarantine /Applications/Sele.app
> open /Applications/Sele.app
> ```

Sele uses the coding-agent CLIs, Git, and shell installed on your host system. Install and
authenticate the CLI you want to use before starting Sele.

```bash
codex --version
claude --version
copilot --version
opencode --version
```

Desktop process environments may not include the same `PATH` as your interactive terminal.
If Sele cannot find a provider, or the provider lookup resolves back to Sele and opens duplicate
windows, point Sele at the real provider executable explicitly. For Codex:

```bash
flatpak override --user --env=SELE_CODEX_PATH="$(command -v codex)" com.chipichapa.sele
launchctl setenv SELE_CODEX_PATH "$(command -v codex)"
```

If the Flatpak cannot see a host Copilot install, point Sele at that executable as well:

```bash
flatpak override --user --env=SELE_COPILOT_PATH="$(command -v copilot)" com.chipichapa.sele
```

Claude Code can be configured the same way when it is outside Sele's desktop `PATH`:

```bash
flatpak override --user --env=SELE_CLAUDE_PATH="$(command -v claude)" com.chipichapa.sele
launchctl setenv SELE_CLAUDE_PATH "$(command -v claude)"
```

OpenCode also supports an explicit executable path:

```bash
flatpak override --user --env=SELE_OPENCODE_PATH="$(command -v opencode)" com.chipichapa.sele
launchctl setenv SELE_OPENCODE_PATH "$(command -v opencode)"
```

Authenticate Claude Code with `claude auth login` before using the Claude provider.

For Copilot, start `copilot` once and use `/login` if the CLI is not already authenticated.

For OpenCode, connect at least one model provider with `opencode auth login`. Sele runs a
private, authenticated `opencode serve` process for each supported source. OpenCode works on
the host, in Sele's current container, and in Distrobox or Toolbox sources. Separately selected
remote SSH, Docker, and Podman sources are not currently exposed because their loopback server
is not safely reachable by Sele.

## Development

Requires Node.js 22.

```bash
npm install
npm run dev
```

Run the project checks with:

```bash
npm run lint
npm run typecheck
npm run build
```

## License

[GNU General Public License v3.0 only](LICENSE)
