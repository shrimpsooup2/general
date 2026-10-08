# Vocab Sprint

Type-the-word vocabulary practice with adaptive spaced repetition. It ships with
Sadlier Vocabulary Workshop Level E, Unit 3 (first definitions only), and takes more units.

Open `index.html` in a browser. No build step and no install.

## How a session works

- You see a definition and type the word. `Enter` checks it.
- `Enter` on an empty line (or **Show answer**) reveals the word. You type it once to move on.
- `?` (or **Hint**) shows one more letter. Hints count as partial credit.
- A missed word comes back after three or four other cards. Each correct answer pushes a word
  further out. The push is bigger when you answer quickly and when the word had time to fade first.
- New words come in when nothing is due and you are keeping up, so the pace adapts to you.
  A word you already know on first sight skips ahead.
- One-letter typos and other forms (`harassed` for `harass`) get a gentler penalty than a wrong
  word. Typing a different word from the unit shows what that word means.
- Levels: **Learning** (under 3 min), **Familiar** (3 min+), **Strong** (1 hour+), **Mastered** (1 day+).
  These are how long until your recall chance drops to 90%.

The memory model is in the `ENGINE` block of `index.html`. It uses a power-law forgetting curve
(FSRS-style) with per-word ease and a per-learner calibration that stretches or shrinks every
interval to match your real hit rate.

## Adding units

**In the app:** Units → **Add a unit**, then paste one word per line, for example:

```
adversary (n.) an enemy, opponent
alienate (ā' lē ə nāt) (v.) to turn away; to make indifferent or hostile
cajole - to coax
```

Pronunciations in parentheses are skipped. Everything after the first semicolon is dropped.

**In code:** add a block to `units.js`:

```js
{
  id: "sadlier-e-4",
  book: "Sadlier Vocabulary Workshop, Level E",
  name: "Unit 4",
  words: [
    ["word", "n.", "first definition"],
  ],
},
```

Keep each `id` stable, because saved progress is keyed by unit id and word.

## Where progress is saved

When the page runs as a Claude artifact, progress syncs to the viewer's own private record, so it
follows them across devices. Anywhere else, it stays in that browser's local storage.

## Publishing as a Claude artifact

Artifacts are wrapped in their own `<html>`/`<head>`/`<body>`, so publish a copy with the wrapper
lines removed, plus `units.js` as a supporting file:

```sh
grep -v -x -e '<!doctype html>' -e '<html lang="en">' -e '<head>' -e '</head>' -e '<body>' \
  -e '</body>' -e '</html>' -e '<meta charset="utf-8">' \
  -e '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' \
  index.html > artifact.html
```

Declare the `db` and `user` capabilities so progress can sync.
