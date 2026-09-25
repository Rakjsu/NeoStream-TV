# NeoStream TV

IPTV player for Samsung Tizen and LG webOS Smart TVs.

Created by **Rakjsu**.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite)
![License](https://img.shields.io/badge/License-MIT-green)
![Tests](https://img.shields.io/badge/tests-226-brightgreen)
![Target](https://img.shields.io/badge/Tizen-5.5%2B%20(Chromium%2069)-1428A0?logo=samsung)

## Disclaimer

**NeoStream TV is a player application only.** It does not provide, host, sell, or distribute channels, movies, series, playlists, streams, or media content.

Users must provide their own IPTV subscription or playlist credentials and are solely responsible for the content they access through their provider.

This application:

- Does not include channels, movies, series, streams, or playlists.
- Does not store, host, proxy, or redistribute media content.
- Is not affiliated with IPTV providers.
- Connects only to user-provided Xtream Codes servers.
- Stores user settings and credentials locally on the device.

Use at your own risk. The creator and contributors are not responsible for how the application is used.

## Features

### Live TV
- Channel grid with virtualized rendering, search, and category filtering.
- **EPG on demand** (`get_short_epg`): now/next on the channel card and a mini guide inside the player.
- **Full day agenda** (`get_simple_data_table`) per channel, navigable with the D-pad.
- **Catch-up / replay**: restart the current program or play any archived program; the queue advances
  to the next program and returns to live when it reaches the on-air show.
- **Zapping**: CH+/CH- keys, channel number entry with on-screen display, channel list overlay with
  EPG preview, recent-channel history, and resume of the last watched channel.
- **Quality variants** (4K/FHD/HD/SD) grouped into a single card with per-variant buttons.
- Favorite channels as a virtual category, hidden channels, hidden categories, EPG-only filter,
  and random zap.
- **Multi-channel program guide**: channels as rows, time as columns, EPG fetched lazily per visible
  row. OK plays what is on air, opens the archive for a past program, or sets a reminder for a future
  one.
- Color key shortcuts: red (EPG filter), green (random), yellow (favorite), blue (hide).
- EPG timezone offset adjustment per playlist, for providers that report the wrong timezone.
- Optional "power on and watch": boot straight into the last watched channel.

### Movies and series
- Catalog sorting (default, recent, name, rating), NEW badge, and hide-watched filter.
- **Continue watching** with saved playback position for movies and episodes.
- **Episode queue** with next/previous controls and automatic next episode.
- New-episode detection for followed series, with badges and a dedicated Home row.
- Local affinity-based recommendations, a **"because you watched X"** row with a named seed, and a
  weighted "surprise me" roulette.
- **Genre filter** derived from the provider's own category names, so it works without a TMDB key and
  covers the whole catalog. Only genres the provider actually carries are offered.
- Minimum-rating and decade filters, an A–Z jump bar, and Dubbed/Subtitled/4K chips.
- Content detail modal with TMDB metadata, seasons, and episodes, plus:
  - **Collection row**: the other films of the saga *that you have*, matched against your catalog by
    TMDB id and then by name and year.
  - **Cast strip** with photos, falling back to the cast the provider sends when there is no TMDB key.
  - **Per-episode synopsis and thumbnail**, straight from the provider — the list only grows when
    there is something to show.
  - **Trailer**: an embed in the browser, and the system's own app on the TV (a cross-origin iframe
    would swallow the remote's keys inside a `file://` widget).
- **Named personal lists** ("Friday marathon", "Watch with the family") alongside the default one.
  Names come from suggestions navigable with left/right — no free typing on a D-pad.

### Player
- HLS.js playback with quality selection and TV-tuned buffer limits.
- **Resilience**: stall watchdog, exponential-backoff reconnection with visible attempts,
  cause-specific error messages, automatic retry when the network returns, and automatic
  failover between channel quality variants.
- Sleep timer, aspect ratio and zoom modes remembered per content, and a back-to-live button.

### System
- Global search across channels, movies, and series from the sidebar.
- Multi-playlist management: several Xtream accounts, switching, and removal.
- Real Kids profile with adult-category filtering, PIN management, and profile switching.
- Themes: AMOLED background plus six accent colors, applied through CSS variables.
- Usage statistics with a Wrapped-style recap.
- Portuguese, English, and Spanish language resources.
- Optional TMDB metadata using a user-provided local API key.
- Flexible Xtream server URL input, including bare domains, `http`, `https`, ports, and common
  Xtream endpoint paths.
- Samsung Tizen build support with Vite legacy output.

## Quick Start

```bash
git clone https://github.com/Rakjsu/NeoStream-TV.git
cd NeoStream-TV
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Scripts

```bash
npm run dev          # Start the Vite development server
npm run build        # Alias for build:web
npm run build:web    # Type-check and build the modern web app
npm run build:tizen  # Type-check, build the Tizen bundle, and copy assets into tizen/
npm run lint         # Run ESLint
npm test             # Run the test suite (Vitest)
npm run test:watch   # Run the tests in watch mode
npm run check:css    # Check the CSS against Chromium 69 (the oldest supported TV)
npm run check:bundle # Check the built bundle against the size budget
npm run preview      # Preview the production build locally
npx tsc -b           # Type-check exactly like the build does
```

## Quality gates

Every push and pull request runs [CI](.github/workflows/ci.yml):

| Gate | What it protects |
| --- | --- |
| `npx tsc -b` | The same type-check the build performs. `tsc --noEmit` lets errors through in a project with references. |
| `npm run lint` | ESLint, including the React Hooks rules the project treats as errors. |
| `npm test` | 226 tests. Node environment, except the `useTVNavigation` suite, which needs jsdom. |
| `npm run check:css` | CSS features Chromium 69 ignores. They break neither the build nor the browser — they only disappear on the TV. |
| `npm run build:tizen` | Fails if `tizen/index.html` points at assets the build did not produce (that ships a black screen). |
| `npm run check:bundle` | Size budget. On a 2019 TV the cost of a large bundle is parse time and heap, not bandwidth. |

The tests deliberately cover the places where failures are silent: storage quota, per-profile data
scoping, catalog caching, reminder timers, the parental PIN lockout, and every remote key code.

## TMDB API Key

NeoStream TV does not ship with a TMDB API key. TMDB is optional: without a key, the app still works with the channels, movies, series, posters, and metadata returned by your IPTV provider.

To enable TMDB metadata on a device:

1. Create or sign in to your account at [themoviedb.org](https://www.themoviedb.org/).
2. Open your account settings and request an API key from the API section.
3. Open NeoStream TV, go to **Configurações**, paste your TMDB API key, and save it.

Each user should use their own TMDB key. The key is saved only in the local storage of the browser or TV where it was entered, under `neostream_tmdb_api_key`; it is not committed to this repository and is not embedded in the app bundle.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 | UI framework |
| TypeScript 5 | Type safety |
| Vite 7 | Build tooling |
| HLS.js | HLS stream playback |
| React Icons | UI icons |
| Vanilla CSS | Styling |

## Project Structure

```text
src/
|-- components/          Player, overlays (search, agenda, wrapped), and shared UI
|-- contexts/            Shared focus/navigation context
|-- hooks/               TV navigation, HLS, watch session, and translation hooks
|-- i18n/                Language resources (pt, en, es)
|-- pages/               App screens
|-- services/            Xtream, EPG, TMDB, catalog, playlist, theme, and storage services
`-- types/               TypeScript definitions

tizen/
|-- assets/              Built app assets for Samsung Tizen
|-- config.xml           Tizen package configuration
`-- index.html           Tizen entrypoint
```

## TV Navigation

| Key | Action |
|-----|--------|
| Up / Down / Left / Right | Navigate |
| Enter / OK | Select or finish editing an input |
| Back / Return | Go back, close overlays, or leave an active input |
| Play / Pause / Stop | Media control where supported |
| CH+ / CH- | Previous/next channel while watching live TV |
| 0-9 | Jump to a channel by number while watching live TV |
| Red | Toggle the EPG-only channel filter |
| Green | Random channel |
| Yellow | Favorite the focused channel |
| Blue | Hide the focused channel or category |

Keys beyond the arrows, OK, and Back are only delivered to the app on a real Samsung TV when the
`http://tizen.org/privilege/tv.inputdevice` privilege is declared in `tizen/config.xml` and the keys
are registered through `tizen.tvinputdevice.registerKey` at startup. Both are already configured.

## Samsung Tizen

The current Tizen package identity is:

```text
Application ID: RakjsuNeo1.NeoStreamTV
Package ID: RakjsuNeo1
Widget ID: http://rakjsu.neostream.tv
Visible name: NeoStreamTV
```

After `npm run build:tizen`, package the app with Tizen Studio CLI and install it on a connected Samsung TV:

```powershell
& 'C:\tizen-studio\tools\ide\bin\tizen.bat' package -t wgt -s NeoStreamTV -o .\build-tizen -- .\tizen
& 'C:\tizen-studio\tools\ide\bin\tizen.bat' install -n 'NeoStreamTV.wgt' -s '<TV_IP>:26101' -- '<project>\build-tizen'
& 'C:\tizen-studio\tools\ide\bin\tizen.bat' run -p RakjsuNeo1.NeoStreamTV -s '<TV_IP>:26101'
```

If the Tizen CLI has trouble transferring `NeoStreamTV.wgt`, copy the same package to a temporary name such as `NeoFinal.wgt` and install that file. The app identity inside the package remains `RakjsuNeo1.NeoStreamTV`.

## Security Notes

- IPTV credentials are stored in browser/device `localStorage`.
- Server URLs are normalized locally; the app accepts bare domains and common Xtream endpoint URLs, then saves the URL that authenticated successfully.
- TMDB is disabled until the user enters their own API key in Settings.
- The TMDB key is stored locally on the device where it was entered.
- Do not add private provider credentials, private API keys, certificates, generated signatures, logs, or Tizen workspace metadata to commits.

## Current Maintenance Notes

- Modern browser builds use `npm run build:web`.
- Samsung Tizen builds use `npm run build:tizen` and copy generated assets into `tizen/assets/`.
- Type-check with `npx tsc -b`: it is what the build runs, and `--noEmit` alone lets some errors through.
- CSS `gap` in flex containers is not available on the Chromium version shipped with the minimum
  supported Tizen release; use margins on children instead.
- Some generated Tizen artifacts and install/debug logs may exist locally after packaging or device testing.

## Roadmap

Delivered so far: live playback with zapping and EPG, catch-up, catalog browsing with continue
watching, profiles with parental filtering, themes, global search, multi-playlist, and stream
resilience.

Also delivered: the multi-channel program guide, program reminders, the "now on favorites" panel,
embedded audio and subtitle track selection, per-profile data scoping, the test suite with CI, and
the whole catalog-and-discovery set (genre filter, collections, cast, trailers, per-episode detail,
named lists, and the "because you watched" row).

Next up:

- Pairing with the NeoStream desktop app over the LAN (four-digit code, matching the desktop and the
  phone app), which is the prerequisite for
  QR pairing from a phone: sending credentials to the TV needs a receiver, and a Tizen web app cannot
  listen on a socket.
- Backup and restore through the paired desktop, and favorites/progress sync.
- The phone as a keyboard for global search.
- LG webOS packaging.

## License

MIT License. See [LICENSE](LICENSE).
