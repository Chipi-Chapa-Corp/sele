# Sele

UX-first AI Harness Wrapper.

## Setup

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Distributables

Build each package on its native operating system:

```bash
# Windows x64 NSIS installer (.exe)
npm run build:win -- --x64

# macOS disk image used by the Homebrew cask
npm run build:mac -- --arm64

# Linux x64 Flatpak bundle (requires flatpak and flatpak-builder)
npm run build:linux -- --x64
```

The files are written to `dist/`:

- `sele-windows-x64-setup.exe`
- `sele-macos-arm64.dmg`
- `sele-linux-x64.flatpak`

Install the Linux bundle locally with:

```bash
flatpak install --user dist/sele-linux-x64.flatpak
flatpak run com.chipichapa.sele
```

Release bundles include Sele's update repository. To install directly from that repository:

```bash
flatpak install --user https://chipi-chapa-corp.github.io/sele/flatpak/sele.flatpakref
```

The repository is published to GitHub Pages from `main`. It supplies AppStream metadata to
software centers and allows installed Flatpaks to receive later Sele releases. GitHub Pages
must be enabled with **GitHub Actions** as its source in the repository settings.

Sele is a host-integrated development tool rather than a sandboxed document app. Its Flatpak
uses `flatpak-spawn --host` for Codex, Git, and terminal processes, and therefore requires the
`org.freedesktop.Flatpak` D-Bus permission. Install and authenticate the Codex CLI on the host
before starting Sele. Sele resolves host tools through common install locations and the host
shell, so Codex, Git, and terminal commands should work without extra Flatpak configuration.
If a custom shell setup still causes an `ENOENT` error, expose your host shell `PATH` to the
Flatpak explicitly:

```bash
flatpak override --user \
  --env=PATH="$PATH" \
  com.chipichapa.sele
```

Released macOS builds can be installed through this repository's Homebrew cask:

```bash
brew tap chipi-chapa-corp/sele https://github.com/Chipi-Chapa-Corp/sele.git
brew install --cask chipi-chapa-corp/sele/sele
```

macOS builds are unsigned. If Gatekeeper reports that Sele is damaged, corrupted, or cannot
be opened after installing it from this repository, remove the download quarantine attribute:

```bash
sudo xattr -dr com.apple.quarantine /Applications/Sele.app
open /Applications/Sele.app
```

If Sele opens but a bundled workflow fails with an `ENOENT` error, make sure the command works
in Terminal first. For example:

```bash
codex --version
git --version
```

Sele checks common macOS install locations such as Homebrew, Volta, pnpm, npm global bins,
asdf, mise, and nvm, then asks your shell where commands live. If your tools are installed
somewhere custom and still fail, publish your Terminal `PATH` to GUI apps, quit Sele, and
start it again:

```bash
launchctl setenv PATH "$PATH"
open -a Sele
```

## CI and releases

`.github/workflows/build.yml` validates the project and builds all three distributables on
pull requests, pushes to `main`, and manual runs. Each package is uploaded as a GitHub Actions
artifact.

Pushing a tag that matches the package version (for example, `v1.0.0`) also creates a GitHub
Release with the Windows installer, macOS disk image, and the Flatpak bundle. The Homebrew
cask follows the latest non-prerelease GitHub Release.

Unsigned macOS packages are expected unless Apple Developer ID signing is configured later.
Proper signed and notarized macOS distribution requires a paid Apple Developer Program
membership. Windows signing is optional and uses these GitHub Actions secrets when available:

- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
