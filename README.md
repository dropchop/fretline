# Fretline

A 3D rhythm guitar game for the web, in the style of Clone Hero, designed for a phone held upright.
It plays your Clone Hero song charts (`notes.chart` / `notes.mid` + audio) and ships with a
built-in generated demo song so it works out of the box.

- **3D highway** rendered with [Three.js](https://threejs.org/) (WebGL on an HTML5 `<canvas>`).
  The camera auto-fits so the five frets span a portrait screen, with the strikeline under your thumbs.
  - **Highway view:** in portrait the camera is steep (65° down, 35° field of view), so the lanes stay wide
    all the way up the screen (at 390×844 a lane is 75 px at the strikeline and 56 px at a fifth of the way
    down from the top, against 72 and 15 px before). The price is time: the top of the screen shows about
    1.6 s of notes at the default note speed, so lower Note speed if you want more warning.
    The score and the pause and Star Power buttons sit in their own strip above the highway, so no lane runs
    under a button.
- **Note styles** (Settings → Note style): **Tiles** (default) draws each note as a tall rectangle that fills its
  lane, Piano Tiles style, and **Classic** draws the round gems over fret rings. Both play the same five lanes,
  so Clone Hero charts work unchanged.
- **Touch controls:** multi-touch chords, hold for sustains, slide between lanes. ★ button for Star Power.
  - Tiles: tap anywhere in a lane's column, up or down the screen, to play that fret. Open notes (and the drum
    kick) are the full-width purple bar under the frets.
  - Classic: tap the fret circles as notes reach them; tap anywhere higher up the highway for purple open notes.
  - Left-handed mode mirrors the columns in both styles.
- **Keyboard controls (desktop):** hold `1`–`5` or `A S D F G`, strum with `Enter` / `Space` / `↑` / `↓`,
  `Shift` or `Q` for Star Power, `Esc` to pause. HOPOs and taps can be hammered on without strumming.
- **Clone Hero charts:** `.chart` and `.mid` charts; guitar, bass, rhythm, co-op and keys parts; all four difficulties;
  chords, sustains, HOPOs (natural and forced), tap notes, open notes, Star Power phrases, `song.ini` metadata and album art.
- **Timing grades:** every hit is graded by how far it was from the note: **Perfect**, **Good**, **OK** or
  **Bad**, worth 100 / 75 / 50 / 25 % of the gem's points. All four grades keep the streak and count towards
  the multiplier; only a note that is missed or never tapped breaks it. Settings → **Timing** sets how wide
  the bands are (± around the note):

  | Timing                | Perfect | Good  | OK     | Bad (hit window) |
  | --------------------- | ------- | ----- | ------ | ---------------- |
  | Forgiving _(default)_ | 40 ms   | 80 ms | 130 ms | 200 ms           |
  | Normal                | 20 ms   | 40 ms | 65 ms  | 100 ms           |
  | Strict                | 14 ms   | 28 ms | 46 ms  | 70 ms            |

  A tap judges the earliest note in reach, as it always did, unless that note is more than 100 ms late: then
  it was plainly skipped, the tap goes to the closest note of the run and the earlier one counts as missed.
  A run played steadily a little late therefore keeps every note, and on-time taps after a skipped note are
  not credited to the note before. When tapping, a later note that is hit first only skips earlier notes in
  its own lane; notes in other lanes can still be tapped until their own window ends, and a Star Power
  phrase waits for them before it pays. A stray tap only breaks the streak when a note is within 100 ms.

- **Scoring:** 50 points per gem (times the grade's share), 1x–4x multiplier every 10-note streak, sustain
  points, Star Power doubles the multiplier, guitar track muted on misses, star rating and results screen.
  Stars compare your score with a run of all Perfects (15 / 35 / 55 / 75 / 90 %), so all Good is four stars
  and all OK is two. Gold stars need a full combo that is also at least 90 % of a perfect run.
- **Song library** stored on the device (IndexedDB), so songs stay after reloading.
- **Settings:** note style, note speed, audio latency calibration (with a tap-along calibrator), timing
  (Forgiving / Normal / Strict), volume, left-handed mode, controls mode. The old Hit window slider is gone;
  a value saved by it is ignored, so every device starts on Forgiving.
- Installable as a full-screen, portrait-locked home-screen app, and playable offline after the first visit.
- **High scores** per song, instrument and difficulty, shown in the library and on the song screen.
- **Practice mode:** pick a section of the song and/or slow it down (50–100%). Practice runs aren't recorded.
- **Drums:** 4-pad + kick drum charts from `.chart` and `.mid` (cymbals shown flat), with touch pads, Space / strum = kick.
- **Auto-chart any audio file:** pick an MP3/OGG/etc. and the game detects the tempo and hits (spectral-flux onsets,
  grid-fitted beats) and writes a four-difficulty chart. Results depend on how clear the beat is.
- **Timing feedback:** the grade flashes after every hit (with an ↑ for early or ↓ for late past the Perfect
  band, as the notes fall), and the results screen shows hits per grade, early / late counts, a timing
  histogram and calibration advice.
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
Actions**, then run it from the Actions tab (**Deploy to GitHub Pages → Run workflow**). It doesn't run on
push, so it can't fail while Pages is off; add a `push` trigger to deploy on every push to `main`.

## Single-file build

```sh
npm run build:single   # writes dist/fretline.html
```

`dist/fretline.html` is the whole game in one self-contained HTML file (about 700 kB, mostly Three.js):
no server needed, it works opened straight from disk, by email or from a USB stick, and songs you import
are still saved in the browser. What it drops compared with the hosted version: the web-app manifest
(no "install to home screen") and the service worker (not needed, it's already local). On iPhone, the
Files app previews HTML without running scripts, so open the file in Safari via a server or host it.

## Project layout

| Path                    | What it does                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/chart/`            | `.chart`, `.mid` and `song.ini` parsers, tempo map, conversion into timed notes (chords, HOPOs, Star Power) |
| `src/game/engine.js`    | Gameplay rules: hit/miss judging, scoring, streak, multiplier, sustains, Star Power                         |
| `src/game/timing.js`    | Timing grades: the Perfect / Good / OK / Bad bands per Timing setting and the points for each               |
| `src/game/session.js`   | One play-through: connects audio clock, engine, renderer, HUD and controls                                  |
| `src/render/highway.js` | Three.js scene: highway, gems, sustains, frets, hit effects, camera fitting                                 |
| `src/audio/player.js`   | Multi-stem Web Audio playback; latency-corrected song clock                                                 |
| `src/input/controls.js` | Multi-touch (lane columns, open bar) and keyboard input                                                     |
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
