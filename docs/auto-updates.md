# Application updates

Packaged Sele checks for stable GitHub releases at startup and every five minutes. The prompt at the bottom of the chat sidebar uses the provider Skip/Update controls. Skip hides that release until Sele exits; the dropdown can permanently ignore that version or disable suggestions. Preferences are stored in `app-update-preferences.json` in Electron's user-data directory. Remove that file while Sele is closed to reset these preferences.

Update asks to restart (running chats and terminals stop), downloads and installs the update, and relaunches Sele. Failed downloads or installations leave the application open with an error and an Update button to retry. Development builds and unpacked Windows directories do not check for updates.

## Release requirements

- Windows: NSIS installation, `latest.yml`, the setup EXE, and its blockmap. Electron Updater handles replacement and relaunch; normal installer elevation rules apply.
- macOS: an installed `.app`, signed with the release signing identity, plus `latest-mac.yml` and the generated ZIP payload. The DMG remains the initial installer. Set the existing `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` release secrets and Apple notarization secrets. Unsigned releases do not support Squirrel.Mac updates. Apps running from a DMG or App Translocation do not check.
- Linux: a standard user or system Flatpak installation with an update remote. Sele checks GitHub and the installation's remote, updates only its own full app ref to the discovered commit, verifies the installed commit, then schedules a host helper to wait for the current sandbox to exit and start a fresh sandbox. It does not replace files inside `/app`. Custom Flatpak installation paths require the package manager.

The release workflow uploads native updater metadata and macOS ZIPs and waits for the Flatpak repository deployment before publishing the GitHub release. Keep the stable Flatpak branch aligned with stable GitHub releases. Old installations need one manual upgrade to a release containing this updater before they can use it.

## Verification

`npm run test:app-update` covers version selection, startup/timer checks, opt-in downloads, dismissal persistence, development/unpacked installs, Flatpak command scope and commit, and failure behavior using mocked platform adapters. Real install-to-install updates must also be tested on signed macOS, NSIS Windows, and user/system Flatpak installations before release; the unit tests do not replace that platform check.
