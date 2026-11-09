# Desktop downloads and builds

Cardwright 1.3.0 adds an Electron desktop shell. It reuses `server.mjs` and the
existing HTML/JavaScript editor. There is one implementation of cards, AI calls,
drafts, lorebooks, personas, placeholders, audits and exports.

## Downloads

- macOS Apple Silicon: `cardwright-VERSION-mac-arm64.zip`
- macOS Intel: `cardwright-VERSION-mac-x64.zip`
- Windows x64: `cardwright-VERSION-win-x64.zip`
- Linux x64: `cardwright-VERSION-linux-x64.tar.gz`

Extract the archive and open `Cardwright.app`, `Cardwright.exe` or `Cardwright`.
Keep all extracted Windows/Linux files together. End users do not need Node.js.
Source/browser use still works with the existing start scripts or `npm start`.

Production macOS downloads use Developer ID signing, hardened runtime and Apple
notarization. Local test builds have ad-hoc signatures and are not notarized.
Windows archives are not Authenticode-signed; no Windows signing certificate is
configured. Linux uses Chromium's sandbox and needs normal desktop libraries.

## Data and lifecycle

The desktop window uses its own persistent Chromium profile named Cardwright.
Its autosave, persona library, selected provider/key and unfinished drafts are
separate from browser profiles. No existing browser data is read or migrated.
Transfer cards via JSON/PNG export/import, and presets via their JSON backup.

The shared backend binds to `127.0.0.1:8787`. A matching app/version/protocol
already on that port is reused. An unrelated or older server is rejected without
stopping it. Quit stops only the server owned by this desktop instance. Normal
window close runs the editor's existing autosave handler. Keep a card export as
your portable backup; autosave is local to the profile.

Standard Edit/View/Window menus provide copy/paste, undo, zoom, reload and fullscreen.
Normal window width/height are remembered and clamped to the current display;
maximized/fullscreen size is not saved as the normal size. External HTTPS links
open in the system browser. The renderer has no Node.js, preload or generic IPC;
it stays sandboxed and isolated, and retains the shared server access controls.

## Updates

**Help → Check for Updates** reads only Cardwright's public stable GitHub release
metadata, without provider keys, GitHub tokens or card data. Automatic checks
default to once per day and can be switched off in Help. Failed attempts are
also cached across restarts. Update notices and the Help download link open the
release in your browser; downloading, installing and restarting remain your choice.
No automatic installer or background updater is enabled.

## Development and packaging

Use Node.js 24 LTS or newer:

```sh
npm ci
npm test
npm run desktop
npm run dist -- --mac --arm64
node tools/verify-packages.mjs
```

Build each platform on its target OS/architecture. Other flags are `--mac --x64`,
`--win --x64`, and `--linux --x64`. Electron 45.2.3, electron-builder 26.18.0 and
the build dependency graph are pinned in `package-lock.json`. The targeted
minimatch override fixes the affected build-only versions while retaining older
compatible versions used by legacy packaging tools.

`npm run pack` produces an unpacked local app. `npm run smoke:desktop` tests the
development shell. `node tools/verify-packages.mjs` extracts final archives,
checks macOS signatures, runs the actual app twice with a disposable profile and
local mock provider, and writes SHA-256 files only after successful verification.
The tests cover sandboxing, native JSON downloads, source-draft review/apply,
card/greeting/lore metadata preservation and local persistence after restart.
They never read a real browser profile or use live AI credentials.

Maintainer test overrides are `CARDWRIGHT_PROFILE` and `CARDWRIGHT_PORT`; they are
not migration tools. Smoke mode additionally requires an explicit report path
and the disposable profile set by `tools/smoke-electron.mjs`.

## GitHub builds and macOS signing

The Desktop builds workflow validates macOS ARM64/Intel, Windows x64 and Linux x64.
Main commits run the regression suite; PR desktop builds do not use signing secrets. A manual workflow run with
`sign_macos=true` produces signed/notarized test artifacts without publishing.
A `vVERSION` tag builds all four targets, verifies the extracted packages and
checksums, and publishes a release only if every target succeeds.

macOS signing uses these existing repository secrets only in the signing step:
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID`. `electron/signed.cjs` requires a real signing identity and
notarization; missing credentials fail the build rather than publishing unsigned
macOS release downloads. Secrets are never bundled, copied to logs or passed to
the smoke-test application. Signed verification requires a valid stapled ticket
and a successful Gatekeeper assessment.

Keep `package.json`, `package-lock.json`, `version.js`, the README version and
HTML fallback version aligned; `node tools/check-release.mjs` validates them.
