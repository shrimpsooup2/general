# Tether Dodge

The dodging version of Tether. There are no notes to hit: hazards land on the beat, and the game
is not being there. It keeps the same paddle, snap and elastic soul as the note version
(`../tether`). The soul gets a new job: it breaks glass.

Open `index.html` in a browser. There's no build step, and all music and sound are synthesised
in the page.

## Controls

| Keys | What it does |
| --- | --- |
| `←` `→` (or `A` `D`) | Move one lane (100 ms). Press again mid-move to go two; press the other way to turn back. |
| `Shift` + `←` `→` | Snap: teleport one lane, instantly. It slips through gaps too short to move through, passes dashed walls and hops dashed blocks. A solid hazard in the way stops it (a clank, no damage). |
| `Ctrl` or `Space` + `←` `→` | Soul: it stretches out on the elastic tether, straight through every hazard, and breaks glass it touches. With no arrow it sits on the paddle and guards your lane. Let go of the arrow and it springs back past the paddle. The paddle can't move while the soul is out. |
| `Esc` / `R` | Pause (with practice from any section) / restart |

On a Mac, Ctrl + arrows switches desktops, so use Space for the soul.

## Hazards

A hazard hurts while it's on the line: from the beat it lands for its length. Lanes are 0 to 4.

| Hazard | What to do | The rule |
| --- | --- | --- |
| Block (red) | Be in another lane when it lands | Covers its lanes ±0.40. Moving out of its lane takes 67 ms, so press at least that early. |
| Beam | Leave the flashing lane by the count | The lane flashes for 2 beats (1 in Hard) with two ticks, then fires on the beat. It hurts exactly like a block. |
| Gate (red wall) | Cross only through a gap | A wall on a divider. A move needs the gap open for the whole ~61 ms crossing; a snap needs it open for an instant. Medium gaps are a quarter beat; Hard gaps are 57 ms, which is snap only. |
| Dashed wall | Snap through it | Touching it hurts, but snaps pass. |
| Dashed block | Hop it | A snap that would land in it carries on to the lane beyond, and chains. |
| Sweeper | Snap over it as it reaches you | A dashed wall sliding along the line at 1 to 2 lanes per beat. You can't outrun it. |
| Glass (ice) | Break it with the soul | Solid, to the paddle and to snaps, until the soul touches it while it's on the line. Then the whole piece shatters. Glass landing on you breaks before it can hit you if you're holding Ctrl as it lands (a guard). |
| Hardglass | Slingshot | Like glass, but only breaks if the soul is moving at 26 lanes/s or more. A pull tops out at 24, so only the spring gets there. **Whip:** with hardglass beside you, pull past it to the edge and let go; it breaks on the way back (~32 lanes/s). **Backshot:** one lane from the edge with hardglass on that side, pull three lanes the other way and let go; the overshoot breaks it (~29 lanes/s). |

The soul's reach, from the paddle: it touches a block 1, 2, 3 or 4 lanes away after about 20, 74,
150 and 272 ms. Every second the soul is out, the paddle is pinned, so each throw is a bet.

## Hearts and scoring

- **Hearts:** 3 per run. A hit costs one, drops your multiplier to ×1 and gives 1 s of
  invulnerability. Easy and Medium give a heart back at each new section; Hard doesn't.
  Unlimited hearts (settings, or the button after a failed run) counts hits without ending the run.
- **Score:** 10 points per beat survived, plus bonuses, all times the **flow** multiplier. Flow
  rises by one every 8 clean beats, up to ×4.
- **Bonuses:** Close +50 (out of a lane less than 90 ms before it was hit), Razor +100 (less than
  40 ms), Thread +100 (through a gap within 60 ms of it closing, or over a sweeper), Hop +100,
  Shatter +100 (hardglass +150), Ricochet +100 for each extra piece broken in one throw. Every
  bonus plays a note of the melody.
- **Grade:** S for no hits, A for one, B for two. Practice runs (from a section, unlimited hearts
  or a slowed song) aren't graded and don't record a best.

## Levels

| Level | BPM | Length | Hazards | Introduces |
| --- | --- | --- | --- | --- |
| First Light (Easy) | 92 | 1:23 | 52 (0.6/s) | Blocks, beams, glass (guard, then reach), gates with half-beat gaps |
| Phase Shift (Medium) | 108 | 1:20 | 86 (1.1/s) | Quarter-beat gates, dashed fences, hops, sweepers, hardglass (whip and backshot) |
| Soulbreak (Hard) | 126 | 1:16 | 126 (1.7/s) | Half-beat gauntlets, 57 ms gates with blocks behind you, double-speed sweepers, quick beams, ricochets, a walled corridor of glass |

Every level passes `check.js`: there is a way through without a single hit.

## Files

- `index.html`: drawing, synth music and hazard sounds, input, menus.
- `engine.js`: the simulation, with no DOM. Tuning numbers are in `K` at the top.
- `levels.js`: the three charts and the helpers for writing them.
- `check.js`: `node tether-dodge/check.js`. It plans the soul's glass breaking by searching its
  real controls and physics, then sweeps the song in 2 ms steps over every position the paddle can
  reach unhurt, snaps and hops included. It prints the beat of anything you can't get through.
- `test.js`: `node tether-dodge/test.js`. Rule tests: hits and hearts, beams, close calls, guard,
  reach, ricochet, whip and backshot, gates, dashed walls and blocks, sweepers, flow, refills and
  practice starts.

## Writing a chart

Charts are written in beats in `levels.js`. The full list of helpers is at the top of the file.

```js
c.block(16, 2, 0, 2);                        // lanes 0-2 from beat 16 for 2 beats
c.beam(27, 1, 2);                            // lane 2 flashes from beat 25, fires on 27
c.gapWall(2.5, 55, 63, [[57, 0.5]]);         // wall on divider 2.5 with a half-beat gap at 57
c.phaseBlock(44.5, 1.5, 2);                  // dashed block: snap into it to hop over
c.sweep(58, -0.5, 4.5, 1);                   // sweeper crossing the field at 1 lane per beat
c.glass(45, 3, 3).beam(46, 1, 0, 2)          // glass in lane 3, then lanes 0-2 fire:
  .soulPhrase(44.75, 0.75, 2);               //   break it from lane 2, let go, step in
c.gauntlet(8, 1, [1, 0, 1, 2], 0.3);         // one safe lane per beat
c.say(34, 5, 'GLASS', 'Hold CTRL or SPACE...'); // callout, also a practice section
```

Rules for glass: every piece needs a `soulPhrase` saying which lane the paddle holds while the
soul breaks it, and the phrase has to end early enough for you to let go and move before the next
hazard lands. Don't land hardglass on the paddle's own lane: a resting soul can't break it, and
whipping the soul back through your own lane on the exact frame it lands is too precise to ask of
anyone. After editing, run `node tether-dodge/check.js` and `node tether-dodge/test.js`.

## Where the design came from

Three directions were explored: rhythm first (hazards as the drum kit, beams with count-ins,
bonuses for dodging on the beat), mechanics first (the soul as the only thing that removes hazards,
hardglass that needs the slingshot, each throw costing paddle time), and newcomer first (one new
thing at a time, hearts instead of instant failure, a heart back per section). This version
merges them. Ideas left out for now: needles you dodge by leaning half a lane and turning back,
sliders that drift between lanes, glass segments in walls, and a tap-to-calibrate audio offset.

## Publishing as a Claude artifact

Publish a copy without the document wrapper lines, plus `engine.js` and `levels.js`:

```sh
grep -v -x -e '<!doctype html>' -e '<html lang="en">' -e '<head>' -e '</head>' -e '<body>' \
  -e '</body>' -e '</html>' -e '<meta charset="utf-8">' \
  -e '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' \
  index.html > artifact.html
```
