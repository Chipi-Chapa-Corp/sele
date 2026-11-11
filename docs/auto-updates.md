# Application updates

Packaged Sele checks stable GitHub releases for its platform at startup and every five minutes. Sidebar
controls let users update, skip until exit, ignore a version, or disable suggestions.
Preferences live in `app-update-preferences.json` in Electron's user-data directory.
Development builds and unpacked Windows directories do not check.

Updating asks to restart, downloads and installs, then relaunches. Preparation failures
leave Sele open for retry. Platform implementations live in `src/main/appUpdate.ts` and
`macAppUpdate.ts`.

Windows starts the downloaded NSIS installer only on Electron's final `quit` event,
after provider/terminal cleanup, renderer saves, and database shutdown have finished.
An abnormal exit does not launch the installer. Windows updater activity and the
shutdown-to-installer handoff are recorded under `app-update` in diagnostics.

## Release requirements

| Platform | Required artifacts and installation |
| --- | --- |
| Windows | NSIS install, `latest.yml`, setup EXE, and blockmap; Electron Updater performs replacement. |
| macOS | Installed `.app`; `Sele-VERSION-ARCH-mac.zip` with SHA-256 digest and size in GitHub's release API. DMG is the initial installer. DMG-mounted/translocated apps do not check. |
| Linux | Standard user/system Flatpak with an update remote. Update only Sele's full ref, verify the commit, then relaunch in a fresh sandbox. Custom installation paths use the package manager. |

Source tags (`vX.Y.Z`) start three independent releases: `vX.Y.Z-windows-x64`,
`vX.Y.Z-macos-arm64`, and `vX.Y.Z-linux-x64`. Each becomes public after validation and
its own artifacts finish uploading. macOS and Windows never wait for Linux. Linux
publishes its `.flatpakref`, repository descriptor and tarball after the update repository
deploys. Its slow standalone `.flatpak` installer builds in a separate workflow and is attached
later; in-app updates and repository installs do not wait for it. Clients from 3.28.1 and
earlier need one migration update before they can use this faster discovery path.
`Casks/sele.rb` updates immediately after the macOS release and points to
that platform's DMG; the workflow needs push permission on `main`.

The updater lists releases, chooses the newest complete stable release for its own
platform, and ignores releases for other platforms. Windows pins Electron Updater's
generic feed to that release's `latest.yml`; macOS uses its checksummed ZIP; Linux uses
the published Flatpak remote. Older combined releases remain valid fallback candidates.
Drafts, prereleases, incomplete releases and downgrades are excluded.

A combined `vX.Y.Z` compatibility release is also published after all three platforms.
The background installer workflow then attaches the `.flatpak` to both Linux and
compatibility entries. It only accepts successful release-tag runs from this repository
and uses their exact source commit and exported repository artifact.
Only this entry is marked GitHub's global latest, keeping existing installed versions
able to upgrade to the platform-aware updater. New installations and subsequent app
updates use the platform entries directly. Platform-tag pushes are excluded from the
build trigger, and publication uses drafts until all required assets are present.

CI bundles portable JavaScript once on Linux while validation runs in parallel.
Main pushes validate and bundle; tags, pull requests and manual runs also build
installers, avoiding duplicate packaging when a release pushes main and a tag together.
Packaging runners prepare their native dependencies concurrently with compilation,
then wait for the completed bundle from the same run. A failed compilation aborts the
wait and prevents publication. Linux exports the Flatpak repository directly and
creates its standalone bundle once, instead of importing and recompressing a bundle.
Static deltas remain enabled for efficient Flatpak downloads. The tarball uses parallel
gzip when available. The glibc-only Electron package excludes Copilot's musl runtime.
Renderer libraries are development dependencies because Vite already bundles them.
Every packaging job verifies its external main-process imports, the native provider
runtimes, and SQLite inside the produced archive before publishing.

The macOS updater verifies size, checksum, archive paths, bundle identity, version, and
architecture before replacement. A helper stages on the destination filesystem, waits for
exit, replaces the bundle, and rolls back on replacement/relaunch failure. macOS handles
administrator authorization when needed. Unsigned apps are supported; only quarantine is
removed. Homebrew receipts are unchanged. `mac-update-pending.json` and staging `helper.log`
files in user data retain post-exit diagnostics; failed staging is kept for recovery.

Run `npm test -- appUpdate` for platform adapters and filesystem transaction tests.
Before release, also verify real install-to-install updates on macOS, NSIS Windows, and
user/system Flatpak, including administrator cancellation and rollback where applicable.
