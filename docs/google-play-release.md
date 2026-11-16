# Google Play release preparation

The first Play candidate is version **3.35.0**, version code **3035000**, package
`com.chipichapa.sele.android`. This is a new Sele listing under the existing
**Chipi & Chapa Corp.** developer account. The existing account and app use the
public contact `chipi.chapa.corporation@gmail.com`; personal account contact details
are not reused in the app listing.

## Current status

The Play release build is separate from GitHub's debug APK. It produces a signed
AAB and SHA-256 checksum. A successful technical verification does **not** mean the
app is approved for Google Play or compliant with every production policy. Do not
submit the current candidate as production-ready until the blockers below are resolved.

Local validation passed for the TLS implementation: `npm run check` completed
with 2,253 passing tests, six skips and all three integration files passing. Android
release lint and five native unit tests passed. The isolated emulator exercised
matching request-bound pairing codes, rejection of a wrong certificate before a
WebSocket opens, chat send/stream, a 2 MB upload, saved-host restart, reconnect,
revocation, host switching and explicit repair of a changed certificate without
automatic trust or prompt replay. Browser companion and visualization fixtures also
passed over HTTPS, and the desktop pairing dialog was visually checked.

The signed AAB passes bundletool, manifest/signature/certificate/checksum and bundled
CSP checks. Production WebView debugging is disabled. Full pairing/provider behavior
is tested in the debug variant; release-variant startup is a separate smoke check.
The release publishes desktop and Android platform builds together. The signed
Play bundle is prepared separately by the manual workflow.

AI reporting is deferred at the owner's request. The current release work omits
reporting UI, provider feedback integration and a developer collection backend.
See the deferred policy question below; this decision does not confirm an exemption.

## Build and verify

Use JDK 21, SDK platform 36, and Build-Tools 35.0.0. Configure these environment
variables through private storage or your CI secret manager:

| Variable | Meaning |
| --- | --- |
| `SELE_ANDROID_KEYSTORE` | Absolute path to the production upload keystore |
| `SELE_ANDROID_STORE_PASSWORD` | Keystore password |
| `SELE_ANDROID_KEY_ALIAS` | Upload key alias |
| `SELE_ANDROID_KEY_PASSWORD` | Private key password |

```sh
npm run build:android:play
node scripts/verify-android-play.mjs dist/sele-3.35.0-android-release.aab /path/to/bundletool-all-1.18.3.jar
```

The verifier runs Google's bundletool, checks the package/version/target API,
rejects debuggable and test-only manifests and Android Debug certificates, checks
the JAR upload signature and checksum, and verifies that no native `.so` libraries
need a separate 16 KB page alignment audit. It also rejects a remotely hosted app
shell or explicitly enabled WebView debugging. The verification JSON records that
production policy review remains incomplete.

`Prepare Google Play bundle` is a manual Actions workflow that prepares artifacts;
it does not upload to Play Console, publish policy text, or roll out an app.
Its signing secrets are `ANDROID_PLAY_KEYSTORE_BASE64`,
`ANDROID_PLAY_STORE_PASSWORD`, `ANDROID_PLAY_KEY_ALIAS`, and
`ANDROID_PLAY_KEY_PASSWORD`.
The dedicated upload key and all four encrypted repository secrets were prepared
on November 16, 2026. The workflow produces reviewable signed artifacts; it does not submit a Play rollout.

Keep the private keystore and passwords outside the repository and backed up
securely. The exported upload certificate is public and may be given to Play Console.
For a first listing, use Play App Signing and distinguish Google's app signing key
from the upload key. The existing GitHub debug key is not a valid Play production key.
Switching an existing debug installation to Play requires uninstall/reinstall;
back up any desired device-local data first. Host-side workspace data remains on the computer.

## Store material

`fastlane/metadata/android/en-US` contains the title, short/full descriptions and
first test release notes in a conventional metadata layout. It is preparation
material, not evidence of a published listing. The description clearly states that
desktop Sele must be awake on the same trusted LAN and that provider accounts and
subscriptions are separate.

`fastlane/metadata/android/PRIVACY.md` is specific to Sele. It reuses the
existing developer/contact details and the structure of the existing privacy-policy
repository. It must not be replaced by the PDF Scanner policy, which describes a
different data flow. The public policy uses the existing `Chipi-Chapa-Corp/privacy-policy` repository
under its dedicated `sele/` directory.
The same policy is bundled for offline access before pairing and in Settings,
and published at https://github.com/Chipi-Chapa-Corp/privacy-policy/blob/main/sele/PRIVACY.md.

Store graphics must use the existing Sele artwork. Required dimensions include a
512×512 PNG icon, a 1024×500 opaque feature graphic, and at least two genuine app
screenshots. Four 1080×1920 phone captures are preferred for promotional eligibility.
Never use a screenshot containing private real conversations or credentials.
The icon, feature graphic and four phone screenshots are prepared in
`en-US/images`. See `fastlane/metadata/android/SCREENSHOTS.md` for capture details
and suggested accessibility descriptions.

## Production submission blockers

1. **Ship a compatible desktop build.** Encrypted LAN transport is implemented in
   this checkout: HTTPS/WSS, per-computer certificates, matching-code approval and
   Android certificate pinning. The published pre-change desktop release does not
   support it. Ship an updated desktop alongside the Android build. Legacy Android
   pairings require one fresh approval; do not silently fall back to HTTP. User-opened
   HTTP browser/preview pages are separate from the encrypted control channel.
2. **Data safety.** The privacy policy is public and bundled inside the app,
   including before pairing. Complete accurate Console declarations for actual
   off-device transfers; do not reuse the scanner app's answers.
3. **Review access.** The reviewer needs desktop Sele, the same reachable LAN,
   approval on the computer, and a configured provider for chat. Prepare a usable
   review path and a short setup video; do not claim that all functionality is
   accessible without additional setup or equipment.
4. **Owner declarations and account tasks.** Review the Console's account notices,
   trader status, export compliance, target audience/content rating and Play App
   Signing choices. The new-app form requires policy-compliance and US-export
   declarations. These remain unchecked in the prepared form. Internal testing is
   the first intended track. For newer personal developer accounts, production may
   require 12 continuously opted-in closed testers for 14 days and a production
   access application; confirm the requirement shown for this account/app.


## Deferred AI reporting question

The owner chose to omit AI reporting for now. Whether Google applies its AI policy
to Sele's desktop-companion/productivity role remains unresolved. Google documents
limited-scope exclusions but does not explicitly settle remote clients that can
initiate new AI prompts. Reporting is not scheduled implementation work, and its
absence must not be represented as a confirmed policy exemption.

The sources, provider integration findings, unsent support question and conditional
server design are retained in [the reporting investigation](ai-reporting-proposal.md).
Revisit if Play requests reporting or if the owner chooses to resume it. No report,
support message or deployment has been made.

## Data safety preparation

This is an inventory for review, not a completed or submitted declaration:

| Data path | Current behavior |
| --- | --- |
| Device/other identifiers | App-scoped Android-derived ID, model and pairing credential sent to the approved computer for pairing and access |
| Messages and other user content | Prompts, responses, drafts, code and terminal input cross the LAN; provider requests run on the computer |
| Photos/videos and files/documents | Selected attachments are uploaded to the paired computer; optional and user initiated |
| App activity/settings | Workspace actions, preferences and viewed-chat subscriptions reach the paired computer |
| Browser URL metadata | Selected workspace URLs synchronize between phone and computer; open-web sites have their own data behavior |
| Ads/analytics | No advertising or analytics SDK is bundled in the Android client |
| Encryption | Sele control traffic uses TLS with Android certificate pinning; third-party website/provider transport is separate |
| Deletion | Clear phone data/uninstall for local copies; revoke the device and manage stored chats/files on the host; provider deletion is separate |
| Developer support | Only information users intentionally send to the public support address; no automatic developer report upload exists yet |

Google's form defines collection as off-device transmission, not only data received
by the developer's own servers. Review each category and the applicable exceptions
before entering or certifying answers. Adding a reporting backend will change this inventory.

## Official references checked November 16, 2026

- [App signing and upload keys](https://developer.android.com/studio/publish/app-signing)
- [Target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [User data policy](https://support.google.com/googleplay/android-developer/answer/18265346)
- [Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469)
- [AI-generated-content policy](https://support.google.com/googleplay/android-developer/answer/13985936)
- [Listing graphics and screenshots](https://support.google.com/googleplay/android-developer/answer/9866151)
- [Testing for personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
