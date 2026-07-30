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

Released macOS builds can be installed through this repository's Homebrew cask:

```bash
brew tap chipi-chapa-corp/sele https://github.com/Chipi-Chapa-Corp/sele.git
brew install --cask chipi-chapa-corp/sele/sele
```

## CI and releases

`.github/workflows/build.yml` validates the project and builds all three distributables on
pull requests, pushes to `main`, and manual runs. Each package is uploaded as a GitHub Actions
artifact.

Pushing a tag that matches the package version (for example, `v1.0.0`) also creates a GitHub
Release with the Windows installer, macOS disk image, and the Flatpak bundle. The Homebrew
cask follows the latest non-prerelease GitHub Release.

Unsigned packages are produced when signing secrets are absent. For production distribution,
configure these GitHub Actions secrets:

- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
- macOS signing: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`
- macOS notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
