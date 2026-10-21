# Fretline

A 3D rhythm guitar game for the web, in the style of Clone Hero, designed for a phone held upright.
It plays your Clone Hero song charts (`notes.chart` / `notes.mid` + audio) and ships with a
built-in generated demo song so it works out of the box.

- **3D highway** rendered with [Three.js](https://threejs.org/) (WebGL on an HTML5 `<canvas>`).
  The camera auto-fits so the five frets span a portrait screen, with the strikeline under your thumbs.
- **Touch controls:** tap the fret circles as notes reach them, multi-touch chords, hold for sustains, slide
  between frets. Tap anywhere higher up the highway for purple open notes. ★ button for Star Power.
- **Keyboard controls (desktop):** hold `1`–`5` or `A S D F G`, strum with `Enter` / `Space` / `↑` / `↓`,
  `Shift` or `Q` for Star Power, `Esc` to pause. HOPOs and taps can be hammered on without strumming.
- **Clone Hero charts:** `.chart` and `.mid` charts; guitar, bass, rhythm, co-op and keys parts; all four difficulties;
  chords, sustains, HOPOs (natural and forced), tap notes, open notes, Star Power phrases, `song.ini` metadata and album art.
- **Scoring:** 50 points per gem, 1x–4x multiplier every 10-note streak, sustain points, Star Power doubles the
  multiplier, guitar track muted on misses, star rating and results screen.
- **Song library** stored on the device (IndexedDB), so songs stay after reloading.
- **Settings:** note speed, audio latency calibration (with a tap-along calibrator), hit window, volume,
  left-handed mode, controls mode.
- Installable as a full-screen, portrait-locked home-screen app, and playable offline after the first visit.
- **High scores** per song, instrument and difficulty, shown in the library and on the song screen.
- **Practice mode:** pick a section of the song and/or slow it down (50–100%). Practice runs aren't recorded.
- **Drums:** 4-pad + kick drum charts from `.chart` and `.mid` (cymbals shown flat), with touch pads, Space / strum = kick.
- **Auto-chart any audio file:** pick an MP3/OGG/etc. and the game detects the tempo and hits (spectral-flux onsets,
  grid-fitted beats) and writes a four-difficulty chart. Results depend on how clear the beat is.
- **Timing feedback:** Early / Perfect / Late on every hit, a timing histogram and advice on the results screen.
- **Profile & history:** lifetime totals, an accuracy sparkline and recent plays.
- **Pass & play versus:** two players take turns on one phone; the results screen names the winner.
- **Tilt Star Power:** flick the phone to activate Star Power (DeviceOrientation; iOS asks for motion access).
- **Highway themes:** Classic, Neon, Sunset, Monochrome.
- **Controllers:** gamepads and guitar controllers via the Gamepad API, with a button-mapping screen in Settings.
  Default layout: frets on buttons 0–4, strum on the d-pad or stick, Star Power on Select, pause on Start.
  Untested on real guitar hardware.

## Adding songs

Fretline doesn't include any commercial songs. Use charts you have the right to use.

- **A `.sng` file** (Clone Hero's single-file song format) or **a `.zip`** containing one or more song folders: best on phones. Each folder needs `notes.chart` or
  `notes.mid`, the audio (`song.ogg`, `guitar.ogg`, … in `.ogg`, `.opus`, `.mp3`, `.wav`, `.m4a`), and optionally
  `song.ini` and `album.png`/`album.jpg`.
- **Loose files** of a single song, selected together.
- **A whole songs folder** (desktop and Android browsers; iOS can't pick folders).

## Development

```sh
npm install
npm run dev        # local dev server (also on your LAN: open the printed Network URL on your phone)
npm run check      # typecheck + lint + format check + unit tests
npm test           # unit tests for the chart parsers and gameplay engine
npm run test:e2e   # browser smoke test: builds, serves and plays the game in headless Chromium
npm run build      # production build in dist/
```

Requires Node 22. The `.npmrc` sets `legacy-peer-deps` to work around an npm resolver error with
Vitest's optional peer dependencies. `test:e2e` needs Playwright's Chromium (`npx playwright install chromium`).

The code is plain JavaScript with JSDoc types, checked by `tsc` (`npm run typecheck`); ESLint and Prettier
enforce style. CI runs all of it plus the browser smoke test.

To play on a phone, the page must be served over **HTTPS** (or localhost) for some features such as
installing to the home screen and the screen wake lock. The included GitHub Pages workflow
(`.github/workflows/pages.yml`) handles that: enable it once in **Settings → Pages → Source: GitHub
Actions**, then every push to `main` deploys.

## Project layout

| Path                    | What it does                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/chart/`            | `.chart`, `.mid` and `song.ini` parsers, tempo map, conversion into timed notes (chords, HOPOs, Star Power) |
| `src/game/engine.js`    | Gameplay rules: hit/miss judging, scoring, streak, multiplier, sustains, Star Power                         |
| `src/game/session.js`   | One play-through: connects audio clock, engine, renderer, HUD and controls                                  |
| `src/render/highway.js` | Three.js scene: highway, gems, sustains, frets, hit effects, camera fitting                                 |
| `src/audio/player.js`   | Multi-stem Web Audio playback; latency-corrected song clock                                                 |
| `src/input/controls.js` | Multi-touch and keyboard input                                                                              |
| `src/library/`          | Importing folders/zips/.sng, high scores, and storing songs in IndexedDB                                    |
| `src/demo/demoSong.js`  | Generated demo chart and synthesized audio                                                                  |

## Known limitations

- Not supported yet: 6-fret (GHL) charts, pro-drum scoring (cymbal vs tom isn't judged, only drawn), 2x kick,
  whammy, and online features.
- Audio formats depend on the browser. Chrome and Firefox decode `.ogg`/`.opus`. Safari support for Ogg
  Vorbis/Opus varies by version. If a song won't load on an iPhone, try `.mp3` or `.m4a` audio.
- Behaviour taken from community conventions rather than an official spec, which may differ slightly
  from Clone Hero:
  - HOPO threshold: 65/192 of a beat for `.chart` files, 170/480 for `.mid` files, overridable by
    `hopo_frequency` in `song.ini`.
  - MIDI open notes: `ENHANCED_OPENS` or Phase Shift sysex. Tap notes: MIDI note 104 or sysex.
  - `song.ini` `delay` and `.chart` `Offset` are treated as moving the notes later. Most charts set both to 0.
  - The star rating thresholds are this game's own.
- Touch input uses "tap" rules (no strum). Strum rules apply with a keyboard.
