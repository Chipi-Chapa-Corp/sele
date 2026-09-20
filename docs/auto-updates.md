# Application updates

Packaged Sele checks for stable GitHub releases at startup and every five minutes. The prompt at the bottom of the chat sidebar uses the provider Skip/Update controls. Skip hides that release until Sele exits; the dropdown can permanently ignore that version or disable suggestions. Preferences are stored in `app-update-preferences.json` in Electron's user-data directory. Remove that file while Sele is closed to reset these preferences.

Update asks to restart (running chats and terminals stop), downloads and installs the update, and relaunches Sele. Failed downloads and preparation leave the application open with an error and an Update button to retry. macOS replacement failures after exit attempt to restore and reopen the previous app; diagnostics are recovered on the next launch. Development builds and unpacked Windows directories do not check for updates.

## Release requirements

- Windows: NSIS installation, `latest.yml`, the setup EXE, and its blockmap. Electron Updater handles replacement and relaunch; normal installer elevation rules apply.
- macOS: an installed `.app` and a release asset named `Sele-VERSION-ARCH-mac.zip` with a SHA-256 `digest` and size in GitHub's release API. No Developer ID signing or notarization is required. The DMG remains the initial installer. macOS does not use Electron Updater or Squirrel. Apps running from a DMG or App Translocation do not check.
- Linux: a standard user or system Flatpak installation with an update remote. Sele checks GitHub and the installation's remote, updates only its own full app ref to the discovered commit, verifies the installed commit, then schedules a host helper to wait for the current sandbox to exit and start a fresh sandbox. It does not replace files inside `/app`. Custom Flatpak installation paths require the package manager.

The release workflow uploads native updater metadata and macOS ZIPs and waits for the Flatpak repository deployment before publishing the GitHub release. Keep the stable Flatpak branch aligned with stable GitHub releases. Old installations need one manual upgrade to a release containing this updater before they can use it.

## Unsigned macOS updates

The app checks GitHub for a newer stable release matching its running architecture. An
explicit Update downloads the ZIP, verifies its size and SHA-256, checks archive paths,
bundle ID, version, executable and architecture, and rejects symlinks outside the bundle.
It extracts without adding quarantine and removes only `com.apple.quarantine` recursively.
A missing checksum or wrong architecture is an error, never an unchecked fallback.

The helper resolves the actual installed bundle (including Homebrew symlinks), creates a
private staging directory on the destination filesystem, and verifies a private archive
copy again before extraction. It waits for Sele to exit before renaming the old and new
bundles. It restores the old bundle if replacement or the relaunch command fails. Successful
`open` is the commit point; it does not prove that the new app cannot crash later.

If the destination or installed bundle is not writable, macOS requests administrator
authorization through `osascript`. Sele never handles passwords. Cancelling leaves Sele
open. Only the installation transaction runs with elevation; the supervisor launches the
app as the original user. Touch ID availability is controlled by macOS.

`mac-update-pending.json` and `mac-update-*/helper.log` in the user-data directory retain
post-exit results. Successful staging is removed on the next launch; failed staging remains
for diagnosis. If even rollback fails, the log identifies the retained backup location.
Homebrew receipts are not rewritten by the in-app updater; `brew upgrade` remains a
separate supported replacement route.

Unsigned older releases need one manual DMG or Homebrew upgrade to acquire this updater.

## Homebrew releases

`Casks/sele.rb` points to a numbered stable release and its DMG SHA-256. After publishing
a stable GitHub release, the release workflow hashes the built DMG and commits the cask
update to `main`, which is the Homebrew tap branch. Prereleases do not update the cask;
rerunning an older release cannot downgrade it. The workflow needs permission to push
to `main` (including any applicable branch rules). Users run `brew update` followed by
`brew upgrade --cask chipi-chapa-corp/sele/sele`. This replaces the app independently of
Electron's updater; it does not sign the app or guarantee Gatekeeper approval.

## Verification

`npm run test:app-update` covers version selection, startup/timer checks, opt-in downloads, dismissal persistence, development/unpacked installs, Flatpak command scope and commit, and failure behavior using mocked platform adapters. The macOS transaction tests execute extraction, replacement, cancellation, checksum rejection, and rollback with real temporary files (Linux substitutes unzip for ditto). macOS CI also checks native quarantine removal. Real install-to-install updates, administrator approval/cancellation, and Homebrew installs must also be tested on unsigned macOS, NSIS Windows, and user/system Flatpak installations before release; the unit tests do not replace that platform check.
