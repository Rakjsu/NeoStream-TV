# Changelog

All notable project changes should be documented in this file.

Created by **Rakjsu**.

## Unreleased

### Added

- Multi-channel program guide: channels as rows, time as columns, opened with the new toolbar button
  on the Live TV screen. EPG is fetched lazily per visible row (at most three requests in flight),
  and OK plays the on-air show, opens the archive for a past program, or sets a reminder for a
  future one.
- Test suite (Vitest): 226 tests covering the pure catalog layer, the storage layer with a real
  quota, per-profile scoping and migrations, the player's three decisions (error classification,
  reconnect backoff, quality cap), the parental PIN lockout, provider URL normalization, playback
  progress, catalog caching, reminder timers, QR backup, and every remote key code the app answers.
- Continuous integration on GitHub Actions running the type-check, lint, tests, the Tizen build, and
  two new guards.
- `scripts/check-tizen-css.mjs`: fails the build on CSS features Chromium 69 ignores. Features that
  have a fallback (`gap` in flexbox, `aspect-ratio`) are allowed only while the selector is covered
  by the corresponding fallback file.
- `scripts/check-bundle-budget.mjs`: size budget for the built bundle, measured rather than guessed.
- Rate limiting on the parental PIN: five wrong attempts trigger a wait of 30 s, 2 min, 10 min, and
  30 min. The counter lives in storage, so closing and reopening the app does not reset it.

### Changed

- The Back key now follows one chain across the whole app: content, then the sidebar, then Home,
  then the exit prompt, then exit. Favorites, My List and the Live TV root did not handle Back at
  all; Movies and Series only closed the context menu.
- The exit prompt now expires after four seconds. It used to stay armed indefinitely, so pressing
  Back on Home, watching a film, and pressing Back again closed the app without warning.
- The player's error classification, reconnect backoff and quality cap moved to
  `src/services/playerDecisions.ts`, where they can be tested outside a TV.

### Fixed

- `neostream_scope_migrated_v2` was missing from the storage key inventory, so an account reset
  cleared the v1 migration flag and left the v2 flag behind. Found by the new contract test.

### Changed

- Removed the bundled TMDB API key from source code.
- Added local TMDB key storage through the Settings screen for device/browser testing.
- Split production builds into `build:web` for modern browsers and `build:tizen` for Samsung Tizen.
- Added a dedicated Tizen Vite config for legacy output and expected single-bundle packaging.
- Finalized the Samsung Tizen package identity as `RakjsuNeo1.NeoStreamTV`.
- Improved Xtream server URL handling with normalization and HTTP/HTTPS fallback.
- Improved login remote-control behavior when leaving TV keyboard input fields.

### Documentation

- Rewrote the README to remove broken encoding artifacts.
- Updated the documented stack to React 19, TypeScript 5, and Vite 7.
- Added creator attribution for Rakjsu.
- Added clearer disclaimer and security notes for IPTV credentials, TMDB usage, generated Tizen artifacts, and local logs.
- Added a TMDB API key tutorial explaining that each user must provide their own key.
- Documented the current Tizen package identity and install/run commands.
- Added current maintenance notes for build, lint, and Tizen packaging state.

### Known Follow-ups

- Complete Live TV playback from the channel preview action.
- Clean or ignore generated Tizen workspace metadata and install/debug logs.
- Improve remote-control navigation consistency across screens.
