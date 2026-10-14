/*
  Tether Dodge engine: the simulation, with no DOM, audio or drawing.
  index.html drives it in the browser; check.js and test.js load it in Node.

  Same paddle, snap and elastic soul as the note version. Here nothing is caught: hazards fall
  onto the line and the job is to not be there. The soul breaks glass.

  Space is measured in lanes: lane centres sit at x = 0..4, dividers at 0.5, 1.5, 2.5, 3.5.
  Time is in seconds of song time, stepped on a fixed 2 ms grid. Inputs apply at their own
  timestamps, so results don't depend on the frame rate.
*/
(function (root) {
  'use strict';

  const K = {
    MAX_X: 4,
    STEP: 0.002,

    PADDLE_HALF: 0.27,
    PADDLE_SPEED: 10, // lanes per second

    // Elastic tether: pulling aims SOUL_REACH lanes out and covers 63% of what's left every
    // SOUL_PULL_TAU seconds; letting go hands it to a spring that overshoots and bounces.
    SOUL_HALF: 0.18,
    SOUL_REACH: 4.6,
    SOUL_PULL_TAU: 0.2,
    SOUL_PULL_MAX: 24, // lanes per second
    SOUL_SPRING: 24, // rad/s
    SOUL_DAMP: 0.32,
    HARD_SPEED: 26, // lanes per second the soul needs to break hardglass: only the spring gets there

    BLOCK_HALF: 0.4,
    WALL_HALF: 0.035,

    HEARTS: 3,
    INVULN: 1.0, // seconds after a hit

    CLOSE: 0.09, // dodging out of a hazard's span this late before it lands is a close call...
    RAZOR: 0.04, // ...and this late is a razor
    THREAD: 0.06, // crossing a divider this close to a wall on it threads the gap

    POINTS: { beat: 10, close: 50, razor: 100, thread: 100, hop: 100, shatter: 100, hardShatter: 150, ricochet: 100 },
    FLOW_BEATS: 8, // the multiplier rises by 1 every 8 clean beats...
    FLOW_MAX: 4, // ...up to x4
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

  // Centre of a moving obstacle at time t (path points are [{t, x}], linear between them).
  function pathX(path, t) {
    if (t <= path[0].t) return path[0].x;
    for (let i = 1; i < path.length; i++) {
      if (t <= path[i].t) {
        const a = path[i - 1], b = path[i], span = b.t - a.t;
        return span <= 0 ? b.x : a.x + (b.x - a.x) * ((t - a.t) / span);
      }
    }
    return path[path.length - 1].x;
  }

  // An obstacle's span on the line at time t, padded by its hit half-width.
  function span(o, t) {
    if (!o.path) return [o.lo, o.hi];
    const c = pathX(o.path, t);
    return [c - o.w - o.half, c + o.w + o.half];
  }

  function compile(level) {
    const spb = 60 / level.bpm;
    const obstacles = level.chart.obstacles.map((o, i) => {
      const half = o.kind === 'wall' ? K.WALL_HALF : K.BLOCK_HALF;
      const c = Object.assign({}, o, { id: i, half, lo: o.x0 - half, hi: o.x1 + half, w: (o.x1 - o.x0) / 2 });
      if (o.path) c.path = o.path.map((p) => ({ t: p.t, x: p.x }));
      return c;
    });
    obstacles.sort((a, b) => a.t - b.t || a.id - b.id);
    let maxEnd = -Infinity;
    const obsMaxEnd = obstacles.map((o) => (maxEnd = Math.max(maxEnd, o.t2)));
    const texts = (level.chart.texts || []).slice().sort((a, b) => a.t - b.t);
    const phrases = (level.chart.phrases || []).slice().sort((a, b) => a.t - b.t);
    let end = 0;
    for (const o of obstacles) end = Math.max(end, o.t2);
    if (level.music && level.music.bars) end = Math.max(end, level.music.bars * 4 * spb);
    return { obstacles, obsMaxEnd, texts, phrases, end };
  }

  class Game {
    constructor(level, opts) {
      opts = opts || {};
      this.level = level;
      this.spb = 60 / level.bpm;
      this.noFail = !!opts.noFail;
      const c = compile(level);
      this.obstacles = c.obstacles;
      this.obsMaxEnd = c.obsMaxEnd;
      this.texts = c.texts;
      this.endTime = c.end + 1.2;
      this.refill = !!level.refill;

      this.from = opts.from || 0;
      const t0 = this.from - 1.6;
      this.t = opts.startTime != null ? opts.startTime : t0;
      let start = level.startLane != null ? level.startLane : 2;
      if (this.from > 0) {
        // Hazards from before the section don't exist; anything still on the line lands at `from`.
        for (const o of this.obstacles) {
          if (o.t >= this.from) continue;
          if (o.t2 <= this.from + 1e-6) o.t = o.t2 = -1e9; // over before the section starts: gone
          else o.t = this.from;
        }
        // Practice from a section: start in the lane nearest the middle that's clear for a moment.
        const clear = (x) => !this.obstacles.some((o) => o.t < t0 + 0.4 && o.t2 > t0 && x - K.PADDLE_HALF < o.hi && x + K.PADDLE_HALF > o.lo);
        for (const x of [2, 1, 3, 0, 4]) if (clear(x)) { start = x; break; }
      }

      this.state = 'play'; // play | dead | done
      this.paddle = { x: start, target: start, from: start, bonkT: -9, bonkDir: 0 };
      this.soul = { x: start, from: start, v: 0, pull: 0, out: false, broke: 0 };
      this.held = { snap: false, soul: false, dirs: [] };
      this.hearts = K.HEARTS;
      this.invulnUntil = -Infinity;
      this.queue = [];
      this.events = [];
      this.obsCursor = 0;
      this.textIdx = this.texts.findIndex((x) => x.t > this.t);
      if (this.textIdx < 0) this.textIdx = this.texts.length;
      this.stats = {
        score: 0, flow: 1, cleanBeats: 0, hits: 0, beats: 0, longest: 0, streak: 0,
        close: 0, razor: 0, thread: 0, hop: 0, shatter: 0, ricochet: 0, frozen: 0,
      };
    }

    // --- input ------------------------------------------------------------------------------
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
        if (ev.down) { if (!this.soul.out) this.soul.broke = 0; this.soul.out = true; }
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
        p.target = clamp(d > 0 ? Math.floor(p.x) + 1 : Math.ceil(p.x) - 1, 0, K.MAX_X);
      }
      this.emit({ type: 'move', t: this.t, dir: d });
    }

    // Live obstacles at an instant whose span overlaps [lo, hi]. phase: true/false/undefined (any).
    hazardsAt(t, lo, hi, phase) {
      const out = [];
      const obs = this.obstacles;
      for (let i = this.obsCursor; i < obs.length; i++) {
        const o = obs[i];
        if (o.t > t) break;
        if (o.t2 <= t || (phase != null && !!o.phase !== phase)) continue;
        const [a, b] = span(o, t);
        if (overlaps(lo, hi, a, b)) out.push(o);
      }
      return out;
    }

    snap(d) {
      const p = this.paddle, t = this.t, from = p.x, PH = K.PADDLE_HALF;
      let dest = d > 0 ? Math.floor(from + 1e-6) + 1 : Math.ceil(from - 1e-6) - 1;
      const hopped = [];
      for (;;) {
        if (dest < 0 || dest > K.MAX_X) return this.blocked(d);
        const lo = Math.min(from, dest) - PH, hi = Math.max(from, dest) + PH;
        if (this.hazardsAt(t, lo, hi, false).length) return this.blocked(d);
        const land = this.hazardsAt(t, dest - PH, dest + PH, true).filter((o) => o.kind === 'block');
        if (land.length) { hopped.push(...land); dest += d; continue; }
        break;
      }
      p.x = p.target = p.from = dest;
      this.emit({ type: 'snap', t, from, to: dest, hops: hopped.length });
      for (const o of hopped) if (!o.scored) { o.scored = true; this.bonus('hop', t, o, (from + dest) / 2); }
      // Snapping across a sweeper as it passes, or through a gate gap just as it opens or closes.
      const lo = Math.min(from, dest), hi = Math.max(from, dest);
      for (const o of this.hazardsAt(t, lo, hi, true)) {
        if (o.kind === 'wall' && o.path && !o.scored) { o.scored = true; this.bonus('thread', t, o, span(o, t)[0] + o.half); }
      }
      this.gateThread(lo, hi, t);
    }

    // Crossing divider x between lo and hi at time t: a solid wall there that is live just
    // before or just after (but not at) t means the crossing went through a tight gap.
    gateThread(lo, hi, t) {
      for (let k = 0; k < K.MAX_X; k++) {
        const dv = k + 0.5;
        if (dv < lo || dv > hi) continue;
        for (let i = this.obsCursor; i < this.obstacles.length; i++) {
          const o = this.obstacles[i];
          if (o.t > t + K.THREAD) break;
          if (o.kind !== 'wall' || o.phase || o.path || o.x0 !== dv || o.scored) continue;
          const near = (o.t2 <= t && o.t2 > t - K.THREAD) || (o.t > t && o.t <= t + K.THREAD);
          if (near) { o.scored = true; this.bonus('thread', t, o, dv); break; }
        }
      }
    }

    blocked(d) {
      this.paddle.bonkT = this.t;
      this.paddle.bonkDir = d;
      this.emit({ type: 'blocked', t: this.t, dir: d, x: this.paddle.x });
    }

    // --- simulation ---------------------------------------------------------------------------
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
      const p = this.paddle, s = this.soul, h = this.held, S = this.stats;

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
      if (h.soul) S.frozen += dt;

      // A paddle move across a divider can thread a gate gap.
      if (p.from !== p.x) this.gateThread(Math.min(p.from, p.x), Math.max(p.from, p.x), t1);

      const obs = this.obstacles;
      while (this.obsCursor < obs.length && this.obsMaxEnd[this.obsCursor] < t0 - 0.2) this.obsCursor++;

      // 1. The soul breaks glass it touches (before the paddle is hit, so holding Ctrl guards).
      if (s.out) {
        const slo = Math.min(s.from, s.x) - K.SOUL_HALF, shi = Math.max(s.from, s.x) + K.SOUL_HALF;
        for (let i = this.obsCursor; i < obs.length; i++) {
          const o = obs[i];
          if (o.t >= t1) break;
          if (o.kind !== 'glass' || o.broken || o.t2 <= t0) continue;
          const [a, b] = span(o, t1);
          if (!overlaps(slo, shi, a, b)) continue;
          if (o.hard && Math.abs(s.v) < K.HARD_SPEED) {
            if (!o.tinkT || t1 - o.tinkT > 0.15) { o.tinkT = t1; this.emit({ type: 'tink', t: t1, o, x: s.x }); }
            continue;
          }
          o.broken = true;
          o.t2 = t1;
          s.broke++;
          this.emit({ type: 'shatter', t: t1, o, x: clamp(s.x, a + o.half, b - o.half) });
          this.bonus(o.hard ? 'hardShatter' : 'shatter', t1, o, s.x);
          if (s.broke > 1) this.bonus('ricochet', t1, o, s.x);
        }
      }

      // 2. The paddle against everything live on the line.
      const PH = K.PADDLE_HALF;
      const plo = Math.min(p.from, p.x) - PH, phi = Math.max(p.from, p.x) + PH;
      for (let i = this.obsCursor; i < obs.length; i++) {
        const o = obs[i];
        if (o.t >= t1 + K.CLOSE + 0.01) break;
        // Close calls: being in a hazard's lane until just before it lands.
        if (o.kind !== 'wall' && !o.scored && t1 < o.t && t1 >= o.t - K.CLOSE) {
          const [a, b] = span(o, o.t);
          if (overlaps(plo, phi, a, b)) o.near = t1;
        }
        if (o.t >= t1 || o.t2 <= t0 || o.struck || o.broken) continue;
        const [a0, b0] = span(o, t0), [a1, b1] = span(o, t1);
        if (overlaps(plo, phi, Math.min(a0, a1), Math.max(b0, b1))) {
          if (t1 >= this.invulnUntil) { this.hit(o, t1); if (this.state !== 'play') return; }
          continue;
        }
        if (o.kind !== 'wall' && !o.scored && o.near != null && t0 < o.t + 1e-9) {
          o.scored = true;
          this.bonus(o.near >= o.t - K.RAZOR ? 'razor' : 'close', t1, o, p.x);
        }
      }

      // 3. Beats survived, the flow multiplier, and a heart back at each new section.
      const b0 = Math.floor(t0 / this.spb + 1e-9), b1 = Math.floor(t1 / this.spb + 1e-9);
      if (b1 > b0 && t1 > 0) {
        S.beats++;
        S.streak++;
        S.longest = Math.max(S.longest, S.streak);
        S.score += K.POINTS.beat * S.flow;
        if (++S.cleanBeats % K.FLOW_BEATS === 0 && S.flow < K.FLOW_MAX) {
          S.flow++;
          this.emit({ type: 'flow', t: t1, flow: S.flow });
        }
      }
      while (this.textIdx < this.texts.length && this.texts[this.textIdx].t <= t1) {
        const x = this.texts[this.textIdx++];
        if (x.title && this.refill && this.hearts < K.HEARTS && t1 > this.from + 0.1) {
          this.hearts++;
          this.emit({ type: 'heal', t: t1, hearts: this.hearts });
        }
      }
    }

    bonus(kind, t, o, x) {
      const S = this.stats;
      const pts = K.POINTS[kind] * S.flow;
      S.score += pts;
      const stat = kind === 'hardShatter' ? 'shatter' : kind;
      S[stat]++;
      this.emit({ type: 'bonus', kind, t, o, x, pts });
    }

    hit(o, t) {
      const S = this.stats;
      o.struck = true;
      if (o.kind === 'glass') { o.broken = true; o.t2 = t; }
      S.hits++;
      S.flow = 1;
      S.cleanBeats = 0;
      S.streak = 0;
      this.invulnUntil = t + K.INVULN;
      if (!this.noFail) this.hearts--;
      this.emit({ type: 'hit', t, o, x: this.paddle.x, hearts: this.hearts });
      if (this.hearts <= 0) {
        this.state = 'dead';
        this.emit({ type: 'death', t, o, x: this.paddle.x });
      }
    }

    emit(ev) { this.events.push(ev); }
    drain() { const e = this.events; this.events = []; return e; }

    progress() { return clamp(this.t / (this.endTime - 1.2), 0, 1); }
    sections() { return this.texts.filter((x) => x.title).map((x) => ({ t: x.t, title: x.title })); }
  }

  // Grade from hits on a full run: S none, A one, B two. A failed run has no grade.
  function grade(stats, done) { return !done ? null : stats.hits === 0 ? 'S' : stats.hits === 1 ? 'A' : 'B'; }

  const api = { K, Game, compile, soulStep, pathX, span, grade, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TetherEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
