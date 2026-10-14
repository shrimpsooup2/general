#!/usr/bin/env node
/*
  Chart checker. Run: node tether/check.js

  For every level it sweeps forward in 2 ms steps and tracks every paddle position (in 0.02-lane
  cells) that can still be reached alive at full speed, snapping included. Each note must be caught
  dead on time (the perfect window, not the good one), each hold tick must be under the paddle and
  each zip must be snapped across on its beat. If at some moment no position works, the chart is
  impossible there and it's reported.

  The paddle is treated as if it could stop anywhere. In the game it stops only on lanes, so a
  position between lanes is held by tapping back and forth. Soul notes are checked separately: the
  paddle has to stay still while the soul is out.
*/
'use strict';
const path = require('path');
const { K, compile, holdX } = require(path.join(__dirname, 'engine.js'));
const { LEVELS } = require(path.join(__dirname, 'levels.js'));

const RES = 0.02;
const N = Math.round(K.MAX_X / RES) + 1;
const DT = RES / K.PADDLE_SPEED;
const PH = K.PADDLE_HALF;
const cx = (i) => i * RES;

// `now` holds only the obstacles live at the snap instant.
function hits(now, lo, hi, phase) {
  for (const o of now) if (!!o.phase === phase && lo < o.hi && hi > o.lo) return o;
  return null;
}

// Same rule as Game.snap, from a fractional position.
function snapDest(now, from, d) {
  let dest = d > 0 ? Math.floor(from + 1e-6) + 1 : Math.ceil(from - 1e-6) - 1;
  for (;;) {
    if (dest < 0 || dest > K.MAX_X) return null;
    const lo = Math.min(from, dest) - PH, hi = Math.max(from, dest) + PH;
    if (hits(now, lo, hi, false)) return null;
    if (hits(now, dest - PH, dest + PH, true)) { dest += d; continue; }
    return dest;
  }
}

function checkLevel(level) {
  const c = compile(level);
  const spb = 60 / level.bpm;
  const beat = (t) => (t / spb).toFixed(2);
  const problems = [];
  const cons = [];
  for (const n of c.notes) {
    if (n.type === 'tap' || n.type === 'gem') cons.push({ t: n.t, kind: 'at', x: n.x, tol: n.half + PH, what: `${n.type} x=${n.x}` });
    else if (n.type === 'hold') {
      cons.push({ t: n.t, kind: 'at', x: n.path[0].x, tol: n.half + PH, what: `hold head x=${n.path[0].x}` });
      for (const tt of n.ticks) cons.push({ t: tt, kind: 'at', x: holdX(n, tt), tol: n.half + PH, what: `hold tick x=${holdX(n, tt).toFixed(2)}` });
    } else if (n.type === 'zip') cons.push({ t: n.t, kind: 'zip', x: n.x, what: `zip x=${n.x}` });
  }
  cons.sort((a, b) => a.t - b.t);

  const obs = c.obstacles;
  const start = level.startLane != null ? level.startLane : 2;
  let R = new Uint8Array(N);
  R[Math.round(start / RES)] = 1;
  let ci = 0, oc = 0;
  const end = c.end + 0.5;
  // Which cells survive a step: paddle body clear of every obstacle live during (t0, t1].
  const live = [], now = [];
  let lastProblemT = -9;

  for (let step = 0, t0 = -1.6; t0 < end; step++, t0 = -1.6 + step * DT) {
    const t1 = -1.6 + (step + 1) * DT;
    // movement
    const M = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (R[i]) { M[i] = 1; if (i > 0) M[i - 1] = 1; if (i < N - 1) M[i + 1] = 1; }

    const zipsNow = [], atsNow = [];
    while (ci < cons.length && cons[ci].t <= t1) {
      (cons[ci].kind === 'zip' ? zipsNow : atsNow).push(cons[ci]);
      ci++;
    }

    // obstacles live during this step, and those live at the snap instant t1
    while (oc < obs.length && c.obsMaxEnd[oc] < t0 - 0.05) oc++;
    live.length = 0;
    now.length = 0;
    for (let k = oc; k < obs.length; k++) {
      const o = obs[k];
      if (o.t > t1) break;
      if (o.t < t1 && o.t2 > t0) live.push(o);
      if (o.t2 > t1) now.push(o);
    }

    // snaps, taken at t1 from wherever the paddle can be
    let S;
    if (zipsNow.length) {
      S = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (!M[i]) continue;
        for (const d of [-1, 1]) {
          const dest = snapDest(now, cx(i), d);
          if (dest == null) continue;
          const lo = Math.min(cx(i), dest), hi = Math.max(cx(i), dest);
          if (zipsNow.every((z) => z.x >= lo && z.x <= hi)) S[Math.round(dest / RES)] = 1;
        }
      }
    } else {
      S = M.slice();
      for (let i = 0; i < N; i++) {
        if (!M[i]) continue;
        for (const d of [-1, 1]) {
          const dest = snapDest(now, cx(i), d);
          if (dest != null) S[Math.round(dest / RES)] = 1;
        }
      }
    }

    if (zipsNow.length && !S.some((v) => v)) {
      problems.push(`beat ${beat(t1)}: no legal snap across ${zipsNow.map((z) => z.what).join(', ')}`);
      S = M;
    }

    const clear = (x) => live.every((o) => !(x - PH < o.hi && x + PH > o.lo));
    const next = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (S[i] && clear(cx(i))) next[i] = 1;
    if (!next.some((v) => v)) {
      if (t1 - lastProblemT > 0.25) {
        const o = live.find((o) => S.some((v, i) => v && cx(i) - PH < o.hi && cx(i) + PH > o.lo));
        problems.push(`beat ${beat(t1)}: no way to dodge the ${o.phase ? 'dashed ' : ''}${o.kind} at x ${o.x0}..${o.x1}`);
      }
      lastProblemT = t1;
      // Recover so later problems still show: anywhere clear of obstacles.
      for (let i = 0; i < N; i++) next[i] = clear(cx(i)) ? 1 : 0;
    }

    // notes that must be under the paddle right now
    for (const a of atsNow) {
      const keep = new Uint8Array(N);
      let kept = false;
      for (let i = 0; i < N; i++) if (next[i] && Math.abs(cx(i) - a.x) < a.tol) { keep[i] = 1; kept = true; }
      if (!kept) {
        if (t1 - lastProblemT > 0.05) problems.push(`beat ${beat(a.t)}: can't reach ${a.what} on time`);
        lastProblemT = t1;
        // Recover by assuming the player got there anyway.
        for (let i = 0; i < N; i++) keep[i] = Math.abs(cx(i) - a.x) < a.tol && clear(cx(i)) ? 1 : 0;
      }
      next.set(keep);
    }
    R = next;
  }

  checkSoul(level, c, cons, problems);

  const notes = c.notes.length;
  const len = c.end;
  const counts = {};
  for (const n of c.notes) counts[n.type] = (counts[n.type] || 0) + 1;
  counts.block = obs.filter((o) => o.kind === 'block').length;
  counts.wall = obs.filter((o) => o.kind === 'wall').length;
  return { problems, notes, len, counts };
}

// Soul phrases. While the soul is out the paddle can't move, so for each phrase there has to be a
// lane the paddle can sit in for the whole phrase. Then the soul itself: it slides at the level's
// soul speed while an arrow is held, rests only against an edge or back at the paddle, and snaps
// back fast. Every soul note has to be under it dead on time.
function checkSoul(level, c, cons, problems) {
  const spb = 60 / level.bpm;
  const beat = (t) => (t / spb).toFixed(2);
  const v = (level.soulLanesPerBeat || K.SOUL_LANES_PER_BEAT) / spb;
  const dt = RES / v;
  const ret = Math.max(1, Math.round(K.SOUL_RETURN / v));
  const tol = K.SOUL_NOTE_HALF + K.SOUL_HALF;
  const phrases = [];
  for (const n of c.notes) {
    if (n.type !== 'soul') continue;
    const last = phrases[phrases.length - 1];
    if (last && n.t - last[last.length - 1].t < 1.5 * spb) last.push(n);
    else phrases.push([n]);
  }
  for (const ph of phrases) {
    const end = ph[ph.length - 1].t;
    let solved = false, why = 'no lane where the paddle can sit still for the whole phrase';
    for (let p = 0; p <= K.MAX_X && !solved; p++) {
      const start = ph[0].t - Math.abs(ph[0].x - p) / v - 0.03;
      if (cons.some((a) => a.t >= start && a.t <= end && (a.kind === 'zip' || Math.abs(p - a.x) >= a.tol))) continue;
      if (c.obstacles.some((o) => o.t < end && o.t2 > start && p - PH < o.hi && p + PH > o.lo)) continue;
      const home = Math.round(p / RES);
      let S = new Uint8Array(N);
      S[home] = 1;
      let k = 0, failed = null;
      for (let t = start; k < ph.length; t += dt) {
        const nx = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
          if (!S[i]) continue;
          if (i > 0) nx[i - 1] = 1;
          if (i < N - 1) nx[i + 1] = 1;
          if (i === 0 || i === N - 1 || i === home) nx[i] = 1;
          nx[i > home ? Math.max(home, i - ret) : Math.min(home, i + ret)] = 1;
        }
        while (k < ph.length && ph[k].t <= t + dt) {
          const n = ph[k++];
          let any = false;
          for (let i = 0; i < N; i++) if (nx[i] && Math.abs(i * RES - n.x) >= tol) nx[i] = 0; else if (nx[i]) any = true;
          if (!any) { failed = n; break; }
        }
        if (failed) break;
        S = nx;
      }
      if (!failed) solved = true;
      else why = `the soul can't reach x=${failed.x} at beat ${beat(failed.t)} (paddle in lane ${p})`;
    }
    if (!solved) problems.push(`beat ${beat(ph[0].t)}: soul phrase of ${ph.length}: ${why}`);
  }
}

let bad = 0;
for (const level of LEVELS) {
  const r = checkLevel(level);
  const parts = Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`\n${level.name} (${level.difficulty}, ${level.bpm} BPM): ${r.len.toFixed(1)} s, ${r.notes} notes, ${(r.notes / r.len).toFixed(2)}/s`);
  console.log(`  ${parts}`);
  if (!r.problems.length) console.log('  OK: every note can be caught on time');
  for (const p of r.problems) console.log('  ✗ ' + p);
  bad += r.problems.length;
}
process.exit(bad ? 1 : 0);
