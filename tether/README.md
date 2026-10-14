# Tether (working title)

A playable tech demo for a five-lane rhythm game. A paddle catches notes at the bottom of the
field, a snap teleports it through gaps, and a tethered soul reaches lanes the paddle can't.
There are three levels of rising difficulty, built to find out whether the mechanics are fun.

Open `index.html` in a browser. There's no build step and nothing to install. All music and
sound are synthesised in the page, so there are no audio files.

## Controls

| Keys | What it does |
| --- | --- |
| `←` `→` (or `A` `D`) | Move one lane. Press again while moving to queue another lane. Press the other way mid-move to turn back, and tap fast to hover between lanes. |
| `Shift` + `←` `→` | Snap: teleport to the next lane, instantly. |
| `Ctrl` or `Space` + `←` `→` | Soul: while the arrow is held the soul slides out and the paddle stays put. Let go of the arrow and the soul snaps back. |
| `Esc` / `R` | Pause (with "practice from section") / restart |

On a Mac, Ctrl + arrows switches desktops, so use Space for the soul.

## The rules, exactly

Positions are in lanes: lane centres are 0 to 4 and dividers sit at 0.5, 1.5, 2.5 and 3.5.

- **Catching.** Anything the paddle overlaps as it crosses the line is caught. There's no hit
  button; position is the whole game. The paddle is 0.54 lanes wide and moves at 10 lanes per
  second, so one lane takes 100 ms. Touching a note within ±45 ms of its beat is Perfect,
  within ±95 ms is Good.
- **Notes** (cyan) are 0.68 lanes wide. **Gems** (gold, on a divider) are 0.22 wide. Sitting in a lane
  next to a gem doesn't reach it, so you catch it by moving through it.
- **Holds** need the paddle under them; a tick is checked every 16th note. **Slides** are holds
  that move. **Thin holds** sit on a divider, so you hover by tapping ← → quickly.
- **Zips** (green) are only caught by snapping across them, within ±110 ms.
- **Snap** jumps to the nearest lane in that direction. It fails ("clank", no damage) if a
  solid block or wall is in the way at that instant. A gap in a wall, however short, lets it
  through. If a dashed block sits in the landing lane, the snap carries on past it.
- **Blocks and walls** (red) end the run on contact. Dashed ones still end the run on
  contact, but snaps pass through dashed walls and hop over dashed blocks.
- **Soul.** Holding Ctrl or Space releases it. It catches only soul notes (violet rings), passes
  through every obstacle, slides at 4 lanes per beat (so a sweep lands on 16th notes), can only
  rest against the field edge or back at the paddle, and snaps back at 36 lanes per second. The
  paddle can't move while the soul is out, but it still catches whatever it is sitting under.

A design note that shaped the levels: against a block, moving is only about 34 ms worse than
snapping. Leaving your lane's danger zone takes 67 ms and entering the next one takes 33 ms. A
wall is different, because moving through one needs the gap open for the whole ~61 ms crossing,
while a snap needs only an instant. So "a gap only a snap fits through" is built from walls.

## Levels

| Level | BPM | Length | Notes | What it tests |
| --- | --- | --- | --- | --- |
| First Light (Easy) | 100 | 1:22 | 123 | One mechanic at a time, each introduced by a callout |
| Phase Shift (Medium) | 124 | 1:17 | 258 | Bounces, doubles, a wall maze with 97 ms gaps, dashed hops, soul sweeps through blocks, escapes |
| Soulbreak (Hard) | 150 | 1:17 | 442 | 16th-note streams (one lane per 16th), hovering, 40 ms gaps with blocks chasing you, chained hops, split paddle/soul play |

Every level passes `check.js`: some path catches every note dead on time and dodges everything.
The checker lets the paddle stop between lanes, which in play means tap-hovering, so Soulbreak's
hover sections are possible but genuinely hard.

## Practice and settings

- Pausing lists the level's sections. Pick one to restart from it, and when a run ends you can
  retry from the section you died in. Practice runs, no-fail runs and slowed-down runs don't
  record a best score.
- Settings on the title screen: scroll speed, audio offset (raise it if notes reach the line
  before you hear the beat), song speed 75/85/100%, volume and no-fail. No-fail makes each block
  cost your combo instead of the run.

## Files

- `index.html`: drawing, synth music, input, menus.
- `engine.js`: the simulation. No DOM, so Node can run it. The tuning constants are in `K` at
  the top: paddle speed, hitbox sizes, timing windows and soul speeds.
- `levels.js`: the three charts and the chart-writing helpers.
- `check.js`: run `node tether/check.js`. It proves every chart is clearable. It sweeps the
  song in 2 ms steps over every reachable paddle position, snaps included, using the engine's
  real hitboxes. Soul phrases get their own sweep. It prints the beat of anything impossible.
- `test.js`: run `node tether/test.js`. Rule tests for the engine (catching, reversal,
  hovering, snaps through gaps, dashed hops, soul, holds, timing grades).

## Writing a chart

Charts are written in beats, in `levels.js`:

```js
c.taps(16, 0.5, [2, 2.5, 2, 1.5]);        // 8th notes; 2.5 and 1.5 are gems
c.tap(24, [1, 2]);                        // a double: be between lanes 1 and 2 on the beat
c.slide(28, [[0, 1], [1, 1], [2, 3]]);    // hold that moves from lane 1 to lane 3
c.gapWall(2.5, 40, 48, [[44, 0.1]]);      // wall on divider 2.5 with a 0.1-beat gap at beat 44
c.zip(44, 2.5);                           // mark the gap with a zip
c.hold(56, 4, 2).souls(57, 0.25, [3, 4]); // paddle holds lane 2 while the soul sweeps right
c.phaseBlock(64, 2, 3);                   // a snap from lane 4 hops it and lands in lane 2
c.gauntlet(88, 1, [0, 1, 2, 1], 0.25, 0.5); // one safe lane per beat, notes on the safe lanes
c.say(86, 4, 'WEAVE', 'One lane is safe.');  // callout, also a practice section
```

The full list is at the top of `levels.js`. Each level's song comes from its `music` block: key,
a chord per bar, a drum kit and named sections (`intro`, `groove`, `full`, `drive`, `break`,
`outro`). Notes you catch play chord tones pitched by lane, so the chart is the melody. After
editing, run `node tether/check.js`.

## Publishing as a Claude artifact

Artifacts are wrapped in their own `<html>`/`<head>`/`<body>`, so publish a copy with the
wrapper lines removed, plus `engine.js` and `levels.js` as supporting files:

```sh
grep -v -x -e '<!doctype html>' -e '<html lang="en">' -e '<head>' -e '</head>' -e '<body>' \
  -e '</body>' -e '</html>' -e '<meta charset="utf-8">' \
  -e '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' \
  index.html > artifact.html
```
