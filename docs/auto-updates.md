# Application updates

Packaged Sele checks stable GitHub releases at startup and every five minutes. Sidebar
controls let users update, skip until exit, ignore a version, or disable suggestions.
Preferences live in `app-update-preferences.json` in Electron's user-data directory.
Development builds and unpacked Windows directories do not check.

Updating asks to restart, downloads and installs, then relaunches. Preparation failures
leave Sele open for retry. Platform implementations live in `src/main/appUpdate.ts` and
`macAppUpdate.ts`.

## Release requirements

| Platform | Required artifacts and installation |
| --- | --- |
| Windows | NSIS install, `latest.yml`, setup EXE, and blockmap; Electron Updater performs replacement. |
| macOS | Installed `.app`; `Sele-VERSION-ARCH-mac.zip` with SHA-256 digest and size in GitHub's release API. DMG is the initial installer. DMG-mounted/translocated apps do not check. |
| Linux | Standard user/system Flatpak with an update remote. Update only Sele's full ref, verify the commit, then relaunch in a fresh sandbox. Custom installation paths use the package manager. |

The release workflow waits for Flatpak repository deployment before publishing. Keep its
stable branch aligned with GitHub releases. `Casks/sele.rb` tracks numbered stable DMGs;
the workflow updates its checksum on `main` and must have push permission. Prereleases and
older reruns must not downgrade the cask.

The macOS updater verifies size, checksum, archive paths, bundle identity, version, and
architecture before replacement. A helper stages on the destination filesystem, waits for
exit, replaces the bundle, and rolls back on replacement/relaunch failure. macOS handles
administrator authorization when needed. Unsigned apps are supported; only quarantine is
removed. Homebrew receipts are unchanged. `mac-update-pending.json` and staging `helper.log`
files in user data retain post-exit diagnostics; failed staging is kept for recovery.

Run `npm run test:app-update` for platform adapters and filesystem transaction tests.
Before release, also verify real install-to-install updates on macOS, NSIS Windows, and
user/system Flatpak, including administrator cancellation and rollback where applicable.
