/*
  Tether engine: the game simulation, with no DOM, audio or drawing.
  index.html drives it in the browser; check.js loads it in Node to verify charts.

  Space is measured in lanes: lane centres sit at x = 0..4, dividers at 0.5, 1.5, 2.5, 3.5.
  Time is in seconds of song time. The engine steps in fixed 2 ms slices and applies each input
  at its own timestamp, so results don't depend on the frame rate.
*/
(function (root) {
  'use strict';

  const K = {
    MAX_X: 4,
    STEP: 0.002,

    PADDLE_HALF: 0.27,
    PADDLE_SPEED: 10, // lanes per second
    // The soul sits on an elastic tether. Pulling aims it SOUL_REACH lanes out and covers 63% of
    // the stretch that's left every SOUL_PULL_TAU seconds, so it slows the farther it goes. Letting
    // go hands it to a spring that snaps it back, overshoots the paddle and bounces.
    SOUL_HALF: 0.18,
    SOUL_REACH: 4.6,
    SOUL_PULL_TAU: 0.2,
    SOUL_PULL_MAX: 24, // lanes per second
    SOUL_SPRING: 24, // rad/s
    SOUL_DAMP: 0.32, // damping ratio: below 1 means it overshoots

    TAP_HALF: 0.34,
    GEM_HALF: 0.11,
    HOLD_HALF: 0.3,
    THIN_HALF: 0.11,
    SOUL_NOTE_HALF: 0.3,
    BLOCK_HALF: 0.4,
    WALL_HALF: 0.035,

    PERFECT: 0.05,
    GOOD: 0.11,
    ZIP_PERFECT: 0.055,
    ZIP_GOOD: 0.12,

    TICK_BEATS: 0.25,
    TICK_BEFORE: 0.07,
    TICK_AFTER: 0.03,

    INVULN: 0.6,
    VALUE: { perfect: 1, good: 0.6, miss: 0 },
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const overlaps = (alo, ahi, blo, bhi) => alo < bhi && ahi > blo;

  // One step of the soul on its tether. s = { x, v, pull }; home is the paddle's x.
  function soulStep(s, pull, home, dt) {
    if (s.pull && !pull) s.v = 0; // let go: the tether takes it from rest
    s.pull = pull;
    const d = s.x - home;
    if (pull) {
      s.v = clamp((pull * K.SOUL_REACH - d) / K.SOUL_PULL_TAU, -K.SOUL_PULL_MAX, K.SOUL_PULL_MAX);
    } else {
      const w = K.SOUL_SPRING;
      s.v += (-w * w * d - 2 * K.SOUL_DAMP * w * s.v) * dt;
    }
    s.x += s.v * dt;
    if (s.x < 0 || s.x > K.MAX_X) { s.x = clamp(s.x, 0, K.MAX_X); s.v = 0; }
  }

  function holdX(n, t) {
    const p = n.path;
    if (t <= p[0].t) return p[0].x;
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i].t) {
        const a = p[i - 1], b = p[i];
        const span = b.t - a.t;
        return span <= 0 ? b.x : a.x + (b.x - a.x) * ((t - a.t) / span);
      }
    }
    return p[p.length - 1].x;
  }

  // Turns a level's authored chart into runtime objects with hit ranges and judging state.
  function compile(level) {
    const spb = 60 / level.bpm;
    const tick = K.TICK_BEATS * spb;
    const src = level.chart;
    const notes = src.notes.map((n, i) => {
      const o = Object.assign({}, n, { id: i, done: false, grade: null, early: false });
      if (n.type === 'tap') o.half = K.TAP_HALF;
      else if (n.type === 'gem') o.half = K.GEM_HALF;
      else if (n.type === 'soul') o.half = K.SOUL_NOTE_HALF;
      else if (n.type === 'zip') o.half = 0;
      else if (n.type === 'hold') {
        o.path = n.path.map((p) => ({ t: p.t, x: p.x }));
        const xs = o.path.map((p) => p.x);
        o.x = xs[0];
        o.thin = n.thin != null ? n.thin : xs.every((x) => x === xs[0]) && !Number.isInteger(xs[0]);
        o.half = o.thin ? K.THIN_HALF : K.HOLD_HALF;
        o.head = { early: false, done: false, grade: null };
        o.ticks = [];
        for (let t = n.t + tick; t <= n.t2 - tick * 0.4 + 1e-9; t += tick) o.ticks.push(t);
        if (!o.ticks.length) o.ticks.push((n.t + n.t2) / 2);
        o.tick = 0;
        o.held = 0;
        o.lastTouch = -Infinity;
        o.holding = false;
      }
      return o;
    });
    notes.sort((a, b) => a.t - b.t || a.id - b.id);

    const obstacles = src.obstacles.map((o, i) => {
      const half = o.kind === 'wall' ? K.WALL_HALF : K.BLOCK_HALF;
      return Object.assign({}, o, { id: i, lo: o.x0 - half, hi: o.x1 + half });
    });
    obstacles.sort((a, b) => a.t - b.t || a.id - b.id);
    let maxEnd = -Infinity;
    const obsMaxEnd = obstacles.map((o) => (maxEnd = Math.max(maxEnd, o.t2)));

    const texts = (src.texts || []).slice().sort((a, b) => a.t - b.t);
    let end = 0;
    for (const n of notes) end = Math.max(end, n.t2 || n.t);
    for (const o of obstacles) end = Math.max(end, o.t2);
    if (level.music && level.music.bars) end = Math.max(end, level.music.bars * 4 * spb);

    let units = 0;
    for (const n of notes) units += n.type === 'hold' ? 2 : 1;
    return { notes, obstacles, obsMaxEnd, texts, end, units };
  }

  class Game {
    constructor(level, opts) {
      opts = opts || {};
      this.level = level;
      this.spb = 60 / level.bpm;
      this.noFail = !!opts.noFail;
      const c = compile(level);
      this.notes = c.notes;
      this.obstacles = c.obstacles;
      this.obsMaxEnd = c.obsMaxEnd;
      this.texts = c.texts;
      this.units = c.units;
      this.endTime = c.end + 1.2;

      // Practice from a point in the song: earlier notes are skipped and don't count.
      this.from = opts.from || 0;
      let start = level.startLane != null ? level.startLane : 2;
      if (this.from > 0) {
        for (const n of this.notes) {
          if (n.t >= this.from) continue;
          n.done = true;
          n.grade = 'skip';
          if (n.head) n.head.done = true;
          this.units -= n.type === 'hold' ? 2 : 1;
        }
        // Start under the first note meant for the paddle, in the nearest lane that's clear.
        const first = this.notes.find((n) => !n.done && n.type !== 'soul' && n.type !== 'zip' && n.by !== 'soul');
        const want = first ? clamp(Math.round(first.x), 0, K.MAX_X) : start;
        const t0 = this.from - 1.6;
        const clear = (x) => !this.obstacles.some((o) => o.t < t0 + 0.3 && o.t2 > t0 && x - K.PADDLE_HALF < o.hi && x + K.PADDLE_HALF > o.lo);
        start = want;
        for (let d = 0; d <= K.MAX_X; d++) {
          if (want - d >= 0 && clear(want - d)) { start = want - d; break; }
          if (want + d <= K.MAX_X && clear(want + d)) { start = want + d; break; }
        }
      }
      this.t = opts.startTime != null ? opts.startTime : this.from - 1.6;
      this.state = 'play'; // play | dead | done
      this.paddle = { x: start, target: start, from: start, bonkT: -9, bonkDir: 0 };
      this.soul = { x: start, from: start, v: 0, pull: 0, out: false };
      this.held = { snap: false, soul: false, dirs: [] };
      this.invulnUntil = -Infinity;
      this.queue = [];
      this.events = [];
      this.noteCursor = 0;
      this.obsCursor = 0;
      this.stats = {
        perfect: 0, good: 0, miss: 0, value: 0, judged: 0,
        combo: 0, maxCombo: 0, hits: 0, ticks: 0, ticksHeld: 0, soulCatches: 0,
        byType: {},
      };
    }

    // --- input -----------------------------------------------------------------------------
    // ev: { t, kind: 'dir', dir: -1|1, down } | { t, kind: 'snap'|'soul', down }
    input(ev) {
      const q = this.queue;
      let i = q.length;
      while (i > 0 && q[i - 1].t > ev.t) i--;
      q.splice(i, 0, ev);
    }

    apply(ev) {
      const h = this.held;
      if (ev.kind === 'snap') { h.snap = ev.down; return; }
      if (ev.kind === 'soul') {
        if (ev.down === h.soul) return;
        h.soul = ev.down;
        if (ev.down) this.soul.out = true;
        this.emit({ type: ev.down ? 'soulOut' : 'soulIn', t: this.t });
        return;
      }
      if (ev.kind !== 'dir') return;
      const i = h.dirs.indexOf(ev.dir);
      if (i >= 0) h.dirs.splice(i, 1);
      if (!ev.down) return;
      h.dirs.push(ev.dir);
      if (h.soul) return; // arrows steer the soul while it's out
      if (h.snap) this.snap(ev.dir);
      else this.move(ev.dir);
    }

    move(d) {
      const p = this.paddle;
      if (p.x === p.target) {
        const to = clamp(p.x + d, 0, K.MAX_X);
        if (to === p.x) { p.bonkT = this.t; p.bonkDir = d; return; }
        p.target = to;
      } else if (Math.sign(p.target - p.x) === d) {
        p.target = clamp(p.target + d, 0, K.MAX_X);
      } else {
        // Reverse mid-move: head for the nearest lane in the new direction.
        p.target = clamp(d > 0 ? Math.floor(p.x) + 1 : Math.ceil(p.x) - 1, 0, K.MAX_X);
      }
      this.emit({ type: 'move', t: this.t, dir: d });
    }

    snap(d) {
      const p = this.paddle, t = this.t, from = p.x, PH = K.PADDLE_HALF;
      let dest = d > 0 ? Math.floor(from + 1e-6) + 1 : Math.ceil(from - 1e-6) - 1;
      let skipped = 0;
      for (;;) {
        if (dest < 0 || dest > K.MAX_X) return this.blocked(d, null);
        const lo = Math.min(from, dest) - PH, hi = Math.max(from, dest) + PH;
        const solid = this.obstacleAt(t, lo, hi, false);
        if (solid) return this.blocked(d, solid);
        // A dashed (phase) block in the landing lane gets skipped: the snap carries on past it.
        if (this.obstacleAt(t, dest - PH, dest + PH, true)) { dest += d; skipped++; continue; }
        break;
      }
      p.x = p.target = p.from = dest;
      const lo = Math.min(from, dest), hi = Math.max(from, dest);
      for (let i = this.noteCursor; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t - K.ZIP_GOOD > t) break;
        if (n.done || n.type !== 'zip' || n.x < lo || n.x > hi) continue;
        const off = Math.abs(t - n.t);
        if (off <= K.ZIP_GOOD) this.judge(n, off <= K.ZIP_PERFECT ? 'perfect' : 'good', t);
      }
      this.emit({ type: 'snap', t, from, to: dest, skipped });
    }

    blocked(d, o) {
      this.paddle.bonkT = this.t;
      this.paddle.bonkDir = d;
      this.emit({ type: 'blocked', t: this.t, dir: d, x: this.paddle.x, obstacle: o });
    }

    obstacleAt(t, lo, hi, phase) {
      const obs = this.obstacles;
      for (let i = this.obsCursor; i < obs.length; i++) {
        const o = obs[i];
        if (o.t > t) break;
        if (!!o.phase === phase && o.t2 > t && overlaps(lo, hi, o.lo, o.hi)) return o;
      }
      return null;
    }

    // --- simulation ----------------------------------------------------------------------------
    // Steps land on a fixed 2 ms grid whatever the frame rate, so the same inputs always give
    // the same result; leftover time waits for the next call.
    advance(target) {
      const q = this.queue;
      const end = Math.floor(target / K.STEP + 1e-9) * K.STEP;
      while (this.state === 'play') {
        while (q.length && q[0].t <= this.t) this.apply(q.shift());
        if (this.t >= end - 1e-9) break;
        let next = Math.min(end, (Math.floor(this.t / K.STEP + 1e-6) + 1) * K.STEP);
        if (q.length && q[0].t < next) next = q[0].t;
        this.step(this.t, next);
        this.t = next;
        if (this.t >= this.endTime && this.state === 'play') {
          this.state = 'done';
          this.emit({ type: 'end', t: this.t });
        }
      }
    }

    step(t0, t1) {
      const dt = t1 - t0;
      const p = this.paddle, s = this.soul, h = this.held;

      p.from = p.x;
      if (p.x !== p.target) {
        const d = Math.sign(p.target - p.x);
        p.x += d * K.PADDLE_SPEED * dt;
        if ((p.target - p.x) * d <= 0) p.x = p.target;
      }

      s.from = s.x;
      if (h.soul || s.out) {
        const pull = h.soul && h.dirs.length ? h.dirs[h.dirs.length - 1] : 0;
        if (s.pull && !pull && Math.abs(s.x - p.x) > 0.4) this.emit({ type: 'twang', t: t1, stretch: s.x - p.x });
        soulStep(s, pull, p.x, dt);
        if (!h.soul && Math.abs(s.x - p.x) < 0.02 && Math.abs(s.v) < 0.4) { s.out = false; s.x = p.x; s.v = 0; s.pull = 0; }
      } else {
        s.x = s.from = p.x;
      }

      const PH = K.PADDLE_HALF;
      const plo = Math.min(p.from, p.x) - PH, phi = Math.max(p.from, p.x) + PH;

      // Obstacles: any touch ends the run (or costs a hit with no-fail on).
      const obs = this.obstacles;
      while (this.obsCursor < obs.length && this.obsMaxEnd[this.obsCursor] < t0 - 0.05) this.obsCursor++;
      if (t1 >= this.invulnUntil) {
        for (let i = this.obsCursor; i < obs.length; i++) {
          const o = obs[i];
          if (o.t >= t1) break;
          if (o.t2 > t0 && !o.struck && overlaps(plo, phi, o.lo, o.hi)) { this.crash(o, t1); break; }
        }
        if (this.state !== 'play') return;
      }

      // While it's out the soul catches anything the paddle can, plus soul notes.
      const SH = K.SOUL_HALF;
      const slo = s.out ? Math.min(s.from, s.x) - SH : 1e9, shi = s.out ? Math.max(s.from, s.x) + SH : -1e9;
      const notes = this.notes;
      while (this.noteCursor < notes.length && notes[this.noteCursor].done) this.noteCursor++;
      for (let i = this.noteCursor; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - 0.15 > t1) break;
        if (n.done) continue;
        switch (n.type) {
          case 'tap':
          case 'gem': {
            const byPaddle = overlaps(plo, phi, n.x - n.half, n.x + n.half);
            this.window(n, n, t1, byPaddle || overlaps(slo, shi, n.x - n.half, n.x + n.half), K.PERFECT, K.GOOD, byPaddle ? 'paddle' : 'soul');
            break;
          }
          case 'soul':
            this.window(n, n, t1, overlaps(slo, shi, n.x - n.half, n.x + n.half), K.PERFECT, K.GOOD, 'soul');
            break;
          case 'zip':
            if (t1 > n.t + K.ZIP_GOOD) this.judge(n, 'miss', t1);
            break;
          case 'hold':
            this.holdStep(n, t1, plo, phi, slo, shi);
            break;
        }
      }
    }

    // Shared timing rule. A touch inside the perfect window is perfect. A touch only before it,
    // or only after it (up to the good window), is good. No touch by the end of the window is a miss.
    window(n, st, t, touch, P, G, by) {
      const off = t - n.t;
      if (off < -G) return;
      if (touch) {
        if (off < -P) { st.early = true; st.by = by; }
        else if (off <= P) return this.judge(n, 'perfect', t, st, null, by);
        else if (off <= G) return this.judge(n, 'good', t, st, null, by);
      }
      if (off > P && st.early) { st.wasEarly = true; return this.judge(n, 'good', t, st, null, st.by); }
      if (off > G) this.judge(n, 'miss', t, st);
    }

    holdStep(n, t, plo, phi, slo, shi) {
      const hx = holdX(n, clamp(t, n.t, n.t2));
      const byPaddle = overlaps(plo, phi, hx - n.half, hx + n.half);
      const touch = byPaddle || overlaps(slo, shi, hx - n.half, hx + n.half);
      if (!n.head.done) this.window(n, n.head, t, touch, K.PERFECT, K.GOOD, byPaddle ? 'paddle' : 'soul');
      if (touch && t >= n.t - K.GOOD) n.lastTouch = t;
      n.holding = touch && t >= n.t && t <= n.t2;
      while (n.tick < n.ticks.length && t >= n.ticks[n.tick] + K.TICK_AFTER) {
        const tt = n.ticks[n.tick++];
        this.stats.ticks++;
        if (n.lastTouch >= tt - K.TICK_BEFORE) {
          n.held++;
          this.stats.ticksHeld++;
          this.bump();
          this.emit({ type: 'tick', t, note: n, x: holdX(n, tt) });
        } else {
          this.breakCombo(t);
          this.emit({ type: 'tickMiss', t, note: n, x: holdX(n, tt) });
        }
      }
      if (n.head.done && n.tick >= n.ticks.length && t >= n.t2) {
        n.holding = false;
        const f = n.held / n.ticks.length;
        this.judge(n, f >= 0.9 ? 'perfect' : f >= 0.5 ? 'good' : 'miss', t, n, 'body');
      }
    }

    judge(n, grade, t, st, part, by) {
      st = st || n;
      st.done = true;
      st.grade = grade;
      if (st === n) n.jt = t;
      const S = this.stats;
      S[grade]++;
      S.value += K.VALUE[grade];
      S.judged++;
      const bt = S.byType[n.type] || (S.byType[n.type] = { perfect: 0, good: 0, miss: 0 });
      bt[grade]++;
      if (grade === 'miss') this.breakCombo(t);
      else this.bump();
      if (by === 'soul' && grade !== 'miss') S.soulCatches++;
      this.emit({ type: 'judge', t, note: n, grade, by, early: !!st.wasEarly || t < n.t, part: part || (n.type === 'hold' ? 'head' : 'note') });
    }

    bump() {
      const S = this.stats;
      S.combo++;
      if (S.combo > S.maxCombo) S.maxCombo = S.combo;
    }

    breakCombo(t) {
      if (this.stats.combo > 0) this.emit({ type: 'comboBreak', t, combo: this.stats.combo });
      this.stats.combo = 0;
    }

    crash(o, t) {
      if (this.noFail) {
        // Practice mode: each obstacle counts once, then you get a moment to get clear.
        o.struck = true;
        this.stats.hits++;
        this.invulnUntil = t + K.INVULN;
        this.breakCombo(t);
        this.emit({ type: 'hurt', t, obstacle: o, x: this.paddle.x });
        return;
      }
      this.state = 'dead';
      this.emit({ type: 'death', t, obstacle: o, x: this.paddle.x });
    }

    emit(ev) { this.events.push(ev); }
    drain() { const e = this.events; this.events = []; return e; }

    score() { return this.units ? Math.round((1e6 * this.stats.value) / this.units) : 0; }
    accuracy() { return this.stats.judged ? this.stats.value / this.stats.judged : 1; }
    progress() { return clamp(this.t / (this.endTime - 1.2), 0, 1); }

    // Callouts double as section markers for practice.
    sections() { return this.texts.filter((x) => x.title).map((x) => ({ t: x.t, title: x.title })); }
  }

  function grade(acc) {
    return acc >= 0.95 ? 'S' : acc >= 0.9 ? 'A' : acc >= 0.8 ? 'B' : acc >= 0.7 ? 'C' : 'D';
  }

  const api = { K, Game, compile, holdX, soulStep, grade, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TetherEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
