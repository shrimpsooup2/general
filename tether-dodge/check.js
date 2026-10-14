#!/usr/bin/env node
/*
  Chart checker for Tether Dodge. Run: node tether-dodge/check.js

  Proves each level can be survived without a single hit:
  1. Glass. For every soul phrase (c.soulPhrase), search the soul's real controls (pull left, pull
     right or let go, every 10 ms, with the engine's own tether physics, including the speed
     hardglass needs) for a plan that breaks every piece of glass landing in the phrase. Glass
     landing in the paddle's own lane must break as it lands (a guard); the rest by the end of
     the phrase. Each piece is then treated as gone from its planned shatter time.
  2. The paddle. Sweep the song in 2 ms steps over every position the paddle can still be in
     unhurt (0.02-lane cells), with moves at full speed, snaps and dashed hops, against every
     hazard live on the line. During a soul phrase the paddle is pinned to its lane. If at some
     moment no position survives, the chart can't be cleared there and it's reported.

  As in the note version, the paddle is treated as if it could stop anywhere; in the game it stops
  only on lanes.
*/
'use strict';
const path = require('path');
const { K, compile, soulStep, span } = require(path.join(__dirname, 'engine.js'));
const { LEVELS } = require(path.join(__dirname, 'levels.js'));

const RES = 0.02;
const N = Math.round(K.MAX_X / RES) + 1;
const DT = RES / K.PADDLE_SPEED;
const PH = K.PADDLE_HALF;
const cx = (i) => i * RES;
const cell = (x) => Math.round(x / RES);

function planGlass(level, c, problems) {
  const spb = 60 / level.bpm;
  const beat = (t) => (t / spb).toFixed(2);
  const CTRL = 0.01, SUB = 5;
  const inPhrase = new Set();
  for (const ph of c.phrases) {
    const req = c.obstacles.filter((o) => o.kind === 'glass' && o.t >= ph.t && o.t < ph.t2);
    req.forEach((o) => inPhrase.add(o));
    if (!req.length) { problems.push(`beat ${beat(ph.t)}: soul phrase with no glass landing in it`); continue; }
    // Glass landing on the pinned paddle has to break in the very step it lands (a guard).
    const firstStep = (t) => -1.6 + (Math.floor((t + 1.6) / K.STEP + 1e-9) + 1) * K.STEP;
    const due = req.map((o) => {
      const [a, b] = span(o, o.t);
      return (a < ph.lane + PH && b > ph.lane - PH ? firstStep(o.t) : Math.min(o.t2, ph.t2)) + 1e-9;
    });
    const full = (1 << req.length) - 1;
    let states = [{ x: ph.lane, v: 0, pull: 0, mask: 0, times: [] }];
    let won = null, failAt = null;
    // Run on the paddle sweep's 2 ms grid so a shatter lands exactly on one of its steps.
    const t00 = -1.6 + Math.floor((ph.t + 1.6) / K.STEP + 1e-9) * K.STEP;
    for (let t = t00; t < ph.t2 + 1e-9 && !won; t += CTRL) {
      const next = new Map();
      for (const st of states) {
        for (const pull of [-1, 0, 1]) {
          const s2 = { x: st.x, v: st.v, pull: st.pull };
          let mask = st.mask, times = st.times, ok = true;
          for (let i = 0; i < SUB && ok; i++) {
            const t0 = t + (i * CTRL) / SUB, t1 = t0 + CTRL / SUB, from = s2.x;
            soulStep(s2, pull, ph.lane, CTRL / SUB);
            const lo = Math.min(from, s2.x) - K.SOUL_HALF, hi = Math.max(from, s2.x) + K.SOUL_HALF;
            req.forEach((o, j) => {
              if (mask & (1 << j) || !(o.t < t1 && o.t2 > t0)) return;
              const [a, b] = span(o, t1);
              if (lo < b && hi > a && (!o.hard || Math.abs(s2.v) >= K.HARD_SPEED)) {
                if (t1 > due[j]) { ok = false; return; }
                mask |= 1 << j;
                times = times.slice();
                times[j] = t1;
              }
            });
            for (let j = 0; j < req.length; j++) if (!(mask & (1 << j)) && due[j] < t1) { ok = false; failAt = req[j]; break; }
          }
          if (!ok) continue;
          const key = Math.round(s2.x / 0.04) * 1e7 + Math.round(s2.v) * 100 + (pull + 1) * 32 + mask;
          if (!next.has(key)) next.set(key, { x: s2.x, v: s2.v, pull: s2.pull, mask, times });
          // Of the plans that finish in this slice, keep the one that breaks things earliest.
          if (mask === full) {
            const sum = times.reduce((a, b) => a + b, 0);
            if (!won || sum < won.sum) won = { times, sum };
          }
        }
      }
      if (!next.size) break;
      states = [...next.values()];
    }
    if (!won) {
      const o = failAt || req[0];
      problems.push(`beat ${beat(o.t)}: the soul can't break the ${o.hard ? 'hardglass' : 'glass'} at x ${o.x0}..${o.x1} in time (paddle in lane ${ph.lane})`);
      continue;
    }
    req.forEach((o, j) => { o.t2 = won.times[j]; o.broken = true; });
  }
  for (const o of c.obstacles) {
    if (o.kind === 'glass' && !inPhrase.has(o)) problems.push(`beat ${beat(o.t)}: glass outside any soul phrase (it stays solid)`);
  }
}

// Same rule as Game.snap, from a fractional position, against hazards live at instant t.
function snapDest(now, t, from, d) {
  let dest = d > 0 ? Math.floor(from + 1e-6) + 1 : Math.ceil(from - 1e-6) - 1;
  for (;;) {
    if (dest < 0 || dest > K.MAX_X) return null;
    const lo = Math.min(from, dest) - PH, hi = Math.max(from, dest) + PH;
    let landPhase = false;
    for (const o of now) {
      const [a, b] = span(o, t);
      if (!o.phase && lo < b && hi > a) return null;
      if (o.phase && o.kind === 'block' && dest - PH < b && dest + PH > a) landPhase = true;
    }
    if (landPhase) { dest += d; continue; }
    return dest;
  }
}

function checkLevel(level) {
  const c = compile(level);
  const spb = 60 / level.bpm;
  const beat = (t) => (t / spb).toFixed(2);
  const problems = [];
  planGlass(level, c, problems);
  const obs = c.obstacles.filter((o) => o.t2 > o.t);
  obs.sort((a, b) => a.t - b.t);

  const start = level.startLane != null ? level.startLane : 2;
  let R = new Uint8Array(N);
  R[cell(start)] = 1;
  let oc = 0, lastProblemT = -9;
  const live = [], now = [];
  const end = c.end + 0.5;
  for (let step = 0; ; step++) {
    const t0 = -1.6 + step * DT, t1 = t0 + DT;
    if (t0 >= end) break;
    const M = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (R[i]) { M[i] = 1; if (i > 0) M[i - 1] = 1; if (i < N - 1) M[i + 1] = 1; }

    while (oc < obs.length && obs[oc].t2 < t0 - 2) oc++;
    live.length = 0; now.length = 0;
    for (let k = oc; k < obs.length; k++) {
      const o = obs[k];
      if (o.t > t1) break;
      if (o.t < t1 && o.t2 > t0) live.push(o);
      if (o.t2 > t1) now.push(o);
    }

    const S = M.slice();
    for (let i = 0; i < N; i++) {
      if (!M[i]) continue;
      for (const d of [-1, 1]) {
        const dest = snapDest(now, t1, cx(i), d);
        if (dest != null) S[cell(dest)] = 1;
      }
    }

    const ph = c.phrases.find((p) => t1 >= p.t && t1 <= p.t2);
    if (ph) {
      const k = cell(ph.lane), had = S[k];
      S.fill(0);
      if (had) S[k] = 1;
      else {
        if (t1 - lastProblemT > 0.25) problems.push(`beat ${beat(t1)}: the paddle can't be in lane ${ph.lane} for the soul phrase`);
        lastProblemT = t1;
        S[k] = 1;
      }
    }

    // Glass the soul breaks in this step breaks before it can hit the paddle (as in the engine).
    const clear = (x) => live.every((o) => {
      if (o.broken && t1 >= o.t2 - 1e-9) return true;
      const [a0, b0] = span(o, t0), [a1, b1] = span(o, t1);
      return !(x - PH < Math.max(b0, b1) && x + PH > Math.min(a0, a1));
    });
    const next = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) if (S[i] && clear(cx(i))) { next[i] = 1; any = true; }
    if (!any) {
      if (t1 - lastProblemT > 0.25) {
        const hits = (o, x) => { const [a, b] = span(o, t1); return x - PH < b && x + PH > a; };
        const o = live.find((o) => S.some((v, i) => v && hits(o, cx(i)))) || live[0];
        problems.push(`beat ${beat(t1)}: no way to avoid the ${o.phase ? 'dashed ' : ''}${o.hard ? 'hard' : ''}${o.kind}${o.path ? ' (moving)' : ''} at x ${o.x0}..${o.x1}`);
      }
      lastProblemT = t1;
      for (let i = 0; i < N; i++) next[i] = clear(cx(i)) ? 1 : 0;
    }
    R = next;
  }

  const counts = {};
  for (const o of c.obstacles) {
    const k = (o.phase ? 'dashed ' : '') + (o.hard ? 'hard' : '') + (o.path ? 'sweeper' : o.kind);
    counts[k] = (counts[k] || 0) + 1;
  }
  // Hazards that land: everything but wall segments, which come in runs.
  const landing = c.obstacles.filter((o) => o.kind !== 'wall' || o.path).length;
  return { problems, counts, landing, len: c.end };
}

let bad = 0;
for (const level of LEVELS) {
  const r = checkLevel(level);
  const parts = Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`\n${level.name} (${level.difficulty}, ${level.bpm} BPM): ${r.len.toFixed(1)} s, ${r.landing} hazards, ${(r.landing / r.len).toFixed(2)}/s`);
  console.log(`  ${parts}`);
  if (!r.problems.length) console.log('  OK: survivable without a hit');
  for (const p of r.problems) console.log('  ✗ ' + p);
  bad += r.problems.length;
}
process.exit(bad ? 1 : 0);
