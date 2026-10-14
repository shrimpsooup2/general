/*
  Tether levels. Each level is a song (synthesised in the browser) plus a chart.

  Charts are written in beats. Lanes are 0..4 from left to right; a half-step x (1.5, 2.5 ...)
  sits on the divider between two lanes.

    c.tap(b, x)               note. A half-step x makes a gold gem (caught by moving through it)
    c.taps(b, step, xs)       a run of notes, one every `step` beats; null skips, [1, 2] is a double
    c.hold(b, len, x)         long note
    c.slide(b, pts)           long note that moves: pts = [[beat offset, x], ...]
    c.zip(b, x)               green zip on a divider, caught only by snapping (Shift) across it
    c.zips(b, step, xs)
    c.reach(b, x)             a normal note placed for your soul to catch (either catcher counts;
    c.reaches(b, step, xs)      the mark tells check.js to plan it for the soul)
    c.soul(b, x)              violet note, caught only by your soul (Ctrl/Space)
    c.souls(b, step, xs)
    c.block(b, len, x0, x1)   red block over lanes x0..x1 (instant fail)
    c.phaseBlock(...)         dashed block: a snap skips over it, touching it still fails
    c.wall(b, len, x)         red wall on a divider: can't be moved through or snapped through
    c.phaseWall(b, len, x)    dashed wall: snaps pass through it, touching it fails
    c.gapWall(x, from, to, gaps)   wall with openings; gaps = [[centre beat, width in beats], ...]
    c.say(b, len, title, line)     on-screen callout
*/
(function (root) {
  'use strict';

  class Chart {
    constructor(bpm) {
      this.spb = 60 / bpm;
      this.notes = [];
      this.obstacles = [];
      this.texts = [];
    }
    s(b) { return Math.round(b * this.spb * 1e6) / 1e6; }

    tap(b, x) {
      if (Array.isArray(x)) { x.forEach((v) => this.tap(b, v)); return this; }
      this.notes.push({ type: Number.isInteger(x) ? 'tap' : 'gem', t: this.s(b), x, beat: b });
      return this;
    }
    taps(b, step, xs) { xs.forEach((x, i) => { if (x != null) this.tap(b + i * step, x); }); return this; }

    hold(b, len, x, thin) { return this.slide(b, [[0, x], [len, x]], thin); }
    slide(b, pts, thin) {
      const path = pts.map(([db, x]) => ({ t: this.s(b + db), x }));
      const n = { type: 'hold', t: path[0].t, t2: path[path.length - 1].t, path, beat: b };
      if (thin != null) n.thin = thin;
      this.notes.push(n);
      return this;
    }

    zip(b, x) { this.notes.push({ type: 'zip', t: this.s(b), x, beat: b }); return this; }
    zips(b, step, xs) { xs.forEach((x, i) => { if (x != null) this.zip(b + i * step, x); }); return this; }
    reach(b, x) {
      const first = this.notes.length;
      this.tap(b, x);
      for (let i = first; i < this.notes.length; i++) this.notes[i].by = 'soul';
      return this;
    }
    reaches(b, step, xs) { xs.forEach((x, i) => { if (x != null) this.reach(b + i * step, x); }); return this; }
    soul(b, x) { this.notes.push({ type: 'soul', t: this.s(b), x, beat: b }); return this; }
    souls(b, step, xs) { xs.forEach((x, i) => { if (x != null) this.soul(b + i * step, x); }); return this; }

    obstacle(kind, phase, b, len, x0, x1) {
      this.obstacles.push({ kind, phase, t: this.s(b), t2: this.s(b + len), x0, x1: x1 == null ? x0 : x1, beat: b });
      return this;
    }
    block(b, len, x0, x1) { return this.obstacle('block', false, b, len, x0, x1); }
    phaseBlock(b, len, x0, x1) { return this.obstacle('block', true, b, len, x0, x1); }
    wall(b, len, x) { return this.obstacle('wall', false, b, len, x, x); }
    phaseWall(b, len, x) { return this.obstacle('wall', true, b, len, x, x); }
    gapWall(x, from, to, gaps, phase) {
      let at = from;
      gaps.slice().sort((a, b) => a[0] - b[0]).forEach(([c, w]) => {
        const g0 = c - w / 2;
        if (g0 > at) this.obstacle('wall', !!phase, at, g0 - at, x, x);
        at = c + w / 2;
      });
      if (to > at) this.obstacle('wall', !!phase, at, to - at, x, x);
      return this;
    }

    // One safe lane per segment, every other lane blocked. Where the safe lane changes, the lanes
    // on the way stay open for `ov` beats either side of the change. tapAt puts a note in the safe
    // lane that many beats into each segment.
    gauntlet(b, step, lanes, ov, tapAt) {
      const spans = [[], [], [], [], []];
      lanes.forEach((L, i) => {
        const s = b + i * step, e = s + step;
        const prev = i > 0 ? lanes[i - 1] : L, next = i < lanes.length - 1 ? lanes[i + 1] : L;
        for (let k = 0; k <= 4; k++) {
          if (k === L) continue;
          const s2 = (k - prev) * (k - L) <= 0 ? s + ov : s;
          const e2 = (k - L) * (k - next) <= 0 ? e - ov : e;
          const run = spans[k], last = run[run.length - 1];
          if (last && Math.abs(last[1] - s2) < 1e-9) last[1] = e2;
          else run.push([s2, e2]);
        }
        if (tapAt != null) this.tap(s + tapAt, L);
      });
      // Neighbouring lanes with the same timing become one wide block.
      const byTime = new Map();
      spans.forEach((run, k) => run.forEach(([s, e]) => {
        const key = s.toFixed(4) + '|' + e.toFixed(4);
        if (!byTime.has(key)) byTime.set(key, { s, e, lanes: [] });
        byTime.get(key).lanes.push(k);
      }));
      for (const { s, e, lanes: ks } of byTime.values()) {
        let x0 = ks[0];
        for (let j = 1; j <= ks.length; j++) {
          if (j === ks.length || ks[j] !== ks[j - 1] + 1) { this.block(s, e - s, x0, ks[j - 1]); x0 = ks[j]; }
        }
      }
      return this;
    }

    say(b, len, title, line) { this.texts.push({ t: this.s(b), t2: this.s(b + len), title, line: line || '' }); return this; }

    done() { return { notes: this.notes, obstacles: this.obstacles, texts: this.texts }; }
  }

  function level(meta, build) {
    const c = new Chart(meta.bpm);
    build(c);
    return Object.assign({}, meta, { chart: c.done() });
  }

  // A maze: walls on every divider with one gap per move. The paddle starts in `lane` and snaps
  // through each [beat, divider] of `route`. Blocks follow it out of every lane it leaves, and a
  // note waits in each lane it lands in. Returns the lane it ends in.
  function maze(c, lane, from, to, route, gap, zipEvery) {
    const gaps = { 0.5: [], 1.5: [], 2.5: [], 3.5: [] };
    const visits = [];
    let t = from;
    route.forEach(([b, x], i) => {
      if (Math.abs(x - lane) !== 0.5) throw new Error(`maze: divider ${x} isn't next to lane ${lane} at beat ${b}`);
      gaps[x].push([b, gap]);
      if (zipEvery && i % zipEvery === 0) c.zip(b, x);
      visits.push([lane, t, b]);
      lane += x > lane ? 1 : -1;
      t = b;
    });
    visits.push([lane, t, to]);
    for (const x in gaps) c.gapWall(+x, from, to, gaps[x]);
    for (let L = 0; L <= 4; L++) {
      const vs = visits.filter((v) => v[0] === L);
      vs.forEach((v, i) => {
        const s = v[2] + 0.2, e = i + 1 < vs.length ? vs[i + 1][1] - 0.25 : to;
        if (e - s >= 0.3) c.block(s, e - s, L);
      });
    }
    visits.slice(1).forEach(([L, s, e]) => c.tap(s + Math.min(0.5, (e - s) / 2), L));
    return lane;
  }

  // ---------------------------------------------------------------------------------------------
  // 1. FIRST LIGHT: one idea at a time, about one note a second.
  const firstLight = level({
    id: 'first-light',
    name: 'First Light',
    difficulty: 'Easy',
    tier: 1,
    bpm: 96,
    blurb: 'One idea at a time: lanes, holds, gems, blocks, your soul and the snap.',
    music: {
      key: 'A', prog: ['Am', 'F', 'C', 'G'], kit: 'four', bars: 34,
      sections: [[0, 'intro'], [2, 'groove'], [8, 'full'], [16, 'groove'], [24, 'full'], [32, 'outro']],
    },
  }, (c) => {
    c.say(0, 7, 'MOVE', '← → switch lanes. The paddle catches whatever it touches.');
    c.tap(4, 2).tap(6, 2);
    c.taps(8, 2, [2, 1, 0, 1]);
    c.taps(16, 1, [2, 3, 4, null, 3, null, 2, null]);

    c.say(21.5, 5, 'HOLD', 'Stay under long notes, even when they slide.');
    c.hold(24, 2, 2).hold(27, 2, 1);
    c.slide(30, [[0, 1], [1, 1], [2, 3], [3, 3]]);

    c.say(32, 4.5, 'GEMS', 'Gold gems sit between lanes. Catch them by moving through.');
    c.taps(35, 1, [3, 2.5, 2, 1.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 3.5]);

    c.say(45.5, 4.5, 'BLOCKS', 'Red blocks end the run. Get out of their lane.');
    c.tap(48, 3);
    c.block(50, 2, 3, 4).taps(50, 1, [2, 2]);
    c.block(53, 2, 0, 2).taps(53, 1, [3, 3]);
    c.block(56, 2, 2, 4).taps(56, 1, [1, 1]);
    c.block(59, 3, 0, 1).block(59, 3, 3, 4).hold(59, 2.75, 2);

    // The soul from here on: the paddle holds, the soul reaches.
    c.say(61.5, 6, 'SOUL', 'Hold CTRL or SPACE, then an arrow. Your soul stretches out and catches notes. Let go and it springs back.');
    c.hold(64, 3.5, 2).reaches(65, 1, [4, 4]);
    c.hold(68, 3.5, 2).reaches(69, 1, [0, 0]);
    c.say(71, 4, 'THROUGH', "Your soul passes through blocks. The paddle can't.");
    c.block(72, 4, 3, 4).hold(72, 3.5, 1).reaches(73, 1, [4, 4, 4]);

    c.say(76.5, 5, 'SNAP', 'Hold SHIFT and press ← →: teleport one lane. Snap across green zips.');
    c.tap(80, 2).zip(81, 2.5).tap(82, 3).zip(84, 2.5).tap(85, 2).zip(87, 1.5).tap(88, 1);
    c.zips(90, 1, [1.5, 2.5, 3.5]).tap(94, 4);

    c.say(94.5, 3, 'TOGETHER', '');
    c.taps(96, 1, [4, 3.5, 3, null, 2, 2.5, 3, null]);
    c.block(104, 3, 0, 1).hold(104, 2.75, 3).reaches(105, 1, [0, 0]);
    c.zip(108, 2.5).tap(109, 2).zip(110, 1.5).tap(111, 1);
    c.taps(112, 1, [1, 1.5, 2, 2.5, 3, null, 3, null]);
    c.block(120, 3, 3, 4).hold(120, 2.75, 2).reaches(121, 1, [4, 4]);
    c.taps(124, 1, [2, 2.5, 3, null]);
    c.slide(128, [[0, 3], [2, 3], [3, 2], [5, 2]]).tap(134, 2);
  });

  // ---------------------------------------------------------------------------------------------
  // 2. PHASE SHIFT: the moves start to combine.
  const phaseShift = level({
    id: 'phase-shift',
    name: 'Phase Shift',
    difficulty: 'Medium',
    tier: 2,
    bpm: 112,
    blurb: 'Bounces, doubles, walls you snap through, dashed hops and the soul slingshot.',
    music: {
      key: 'D', prog: ['Dm', 'Bb', 'F', 'C'], kit: 'four', bars: 36,
      sections: [[0, 'intro'], [2, 'groove'], [6, 'full'], [10, 'groove'], [14, 'full'], [18, 'break'],
        [22, 'full'], [26, 'drive'], [34, 'outro']],
    },
  }, (c) => {
    const G = 0.3; // wall gaps: 160 ms
    c.say(0, 6, 'PHASE SHIFT', 'Bounces, doubles, walls and the slingshot.');
    c.taps(4, 1, [2, 1, 2, 3]);

    c.taps(8, 1, [2, 1, 0, 1]);
    c.taps(12, 1, [2, 2.5, 3, 4]);
    c.say(13.5, 4.5, 'BOUNCE', 'Touch a gem and come straight back: → then ← quickly.');
    c.taps(16, 0.5, [3, 3.5, 3, null, 3, 2.5, 3, null]);
    c.taps(20, 0.5, [2, 2.5, 2, null, null, null, 2, null]);

    c.say(22, 4, 'DOUBLES', 'Two at once? Cross between them right on the beat.');
    c.tap(24, [1, 2]).tap(26, [2, 3]).tap(28, [3, 4]).tap(30, [2, 3]).tap(31, 2);

    c.say(30, 4.5, 'REACH', 'Your soul catches any note. Violet ones only your soul can catch.');
    c.hold(32, 3.75, 2).reach(33, 4).reach(34, 0).soul(35, 0);
    c.hold(36, 3, 1).block(36, 3.25, 2, 4).souls(37, 0.5, [4, 4, 4]).tap(39.75, 2);

    c.say(38.5, 5, 'WALLS', 'Moving into a wall ends the run. Snap through the gap.');
    c.gapWall(2.5, 40, 47.5, [[42, G], [44, G], [46, G]]).zip(42, 2.5).zip(44, 2.5).zip(46, 2.5);
    c.taps(40, 1, [2, 2, null, 3, null, 2, null, 3]);
    c.gapWall(3.5, 48, 56, [[49, G], [51, G]]).gapWall(1.5, 48, 56, [[53, G], [55, G]]);
    c.zip(49, 3.5).zip(51, 3.5).zip(53, 1.5).zip(55, 1.5);
    c.taps(48, 2, [3, 4, 3]).tap(52.5, 2).tap(54, 1).tap(56, 2);

    c.say(54, 5, 'DASHED', 'Snaps pass dashed walls and hop dashed blocks. Touching them still ends the run.');
    c.phaseWall(57, 7, 1.5).phaseWall(57, 7, 2.5);
    c.zip(58, 2.5).tap(59.5, 3).zip(61, 2.5).tap(62, 2).zip(63, 1.5).tap(64, 1);
    c.phaseBlock(65, 1.5, 2).zips(66, 0, [1.5, 2.5]).tap(67, 3);
    c.phaseBlock(68, 1.5, 2).zips(69, 0, [2.5, 1.5]).taps(70, 1, [1, 1]);

    c.say(70, 5, 'SLINGSHOT', 'Stretch your soul and let go just before the beat: it flies back past the paddle.');
    c.hold(72, 4.5, 2).reach(73, 4).reach(74, 1).reach(75, 0).reach(76, 3);
    c.hold(78, 4.5, 2).block(78, 5, 3, 4).reaches(79, 0.5, [4, 4]).reach(80, 1).reach(81, 0).reach(82, 3);

    c.say(82, 3.5, 'WEAVE', 'One lane is safe at a time.');
    c.gauntlet(84, 1, [2, 1, 0, 1, 2, 3, 4, 3], 0.3, 0.5);
    c.hold(92, 3.5, 3).block(92, 4, 0, 1).reaches(93, 1, [0, 0]);

    c.say(94.5, 3, 'FINALE', '');
    c.taps(96, 1, [3, 3.5, 4, 3.5]);
    c.tap(100, [1, 2]).tap(102, [2, 3]).tap(103, 3);
    c.gapWall(2.5, 104, 111.5, [[106, G], [109, G]]).zip(106, 2.5).zip(109, 2.5);
    c.taps(104, 1, [3, null, null, 2, null, null, 3, null]);
    c.hold(112, 3.5, 3).reach(113, 0).reach(114, 4);
    c.zips(116, 1, [2.5, 1.5]).taps(118, 1, [1, 2]);
    c.hold(122, 3.5, 2).block(122, 4, 3, 4).reach(123, 4).reach(124, 1).soul(125, 0);
    c.taps(126, 1, [2, 3, null, 2]);
    c.phaseBlock(130, 1.5, 2).tap(130, 1).zips(131, 0, [1.5, 2.5]).tap(132, 3);
    c.slide(133, [[0, 3], [1, 3], [2, 2], [3, 2]]);
    c.slide(137, [[0, 2], [2, 2], [3, 1], [4, 1], [5, 2], [6, 2]]);
  });

  // ---------------------------------------------------------------------------------------------
  // 3. SOULBREAK: everything together, at 132 BPM.
  const soulbreak = level({
    id: 'soulbreak',
    name: 'Soulbreak',
    difficulty: 'Hard',
    tier: 3,
    bpm: 132,
    blurb: 'Faster runs, hovering, a gap maze with blocks on your heels, hops and soul work through walls.',
    music: {
      key: 'E', prog: ['Em', 'C', 'G', 'D'], kit: 'break', bars: 40,
      sections: [[0, 'intro'], [2, 'full'], [6, 'drive'], [8, 'full'], [12, 'break'], [16, 'drive'],
        [20, 'full'], [24, 'drive'], [28, 'full'], [30, 'drive'], [38, 'outro']],
    },
  }, (c) => {
    const G = 0.15; // wall gaps: 68 ms
    c.say(0, 7, 'SOULBREAK', 'Everything at once. No-fail is in the settings.');
    c.taps(4, 0.5, [2, 1, 2, 3]).taps(6, 0.5, [2, 1.5, 1, 0.5]);

    c.taps(8, 0.5, [0, 1, 2, 3, 4, 3.5, 3, 2.5]);
    c.taps(12, 0.5, [2, null, 2.5, 2, null, 1.5, 1, 0.5]);
    c.taps(16, 0.25, [0, 1, 2, 3, 4]).taps(18, 0.5, [3.5, 3, null, 2]);
    c.taps(20, 1, [[1, 2], 2.5, [3, 4], 3.5]);

    c.say(22, 4, 'HOVER', 'Thin holds sit on a divider. Tap ← → fast to stay on them.');
    c.tap(24, 3).hold(24.5, 1, 2.5).tap(26, 2).hold(26.5, 1, 1.5).tap(28, 1);
    c.taps(28.5, 0.5, [1.5, 2, 2.5, 3]).hold(30.5, 0.75, 3.5).tap(31.5, 3);

    c.say(30, 4, 'NEEDLE', 'Snap through the gaps on the beat. Blocks follow you out.');
    maze(c, 3, 32, 47.75, [[33, 3.5], [34.5, 3.5], [35, 2.5], [36, 1.5], [37, 0.5], [38.5, 0.5],
      [39, 1.5], [40, 2.5], [41.5, 2.5], [42, 1.5], [43.5, 1.5], [44, 2.5], [45, 3.5], [46.5, 3.5]], G, 1);

    c.say(46, 4, 'SPLIT', 'The paddle holds. Your soul does the rest, slingshots included.');
    c.hold(48, 7, 3).block(48, 7.5, 0, 2);
    c.reaches(49, 0.5, [0, 0]).reach(50, 4).soul(51, 1).reach(51.5, 0).reach(52.5, 4).souls(53.5, 0.5, [0, 0]);
    c.hold(56, 7, 1).block(56.25, 7.25, 2, 4);
    c.reach(57, 4).soul(57.5, 4).reach(58, 0).reach(59, 3).reach(59.5, 4).soul(60.5, 0).reach(61.5, 2).reach(62, 4);

    c.say(62, 4, 'HOPS', 'Chain snaps over dashed blocks. Every zip you cross counts.');
    c.tap(64, 0).phaseBlock(64.5, 1.25, 1, 2).zips(65, 0, [0.5, 1.5, 2.5]).taps(65.5, 0.5, [3, 3]);
    c.phaseBlock(66.5, 1.25, 2).zips(67, 0, [2.5, 1.5]).taps(67.5, 0.5, [1, 0.5, 0]);
    c.phaseBlock(69, 1.5, 1, 3).zips(69.5, 0, [0.5, 1.5, 2.5, 3.5]).taps(70, 0.5, [4, 4]);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(71.5, 4.5, x));
    c.zips(72, 0.5, [3.5, 2.5, 1.5, null, 1.5, 2.5, null, 2.5]);
    c.taps(76, 1, [2, 3, 2, 2]);

    // Corridor: ride the slide between the walls; while it holds still, the soul reaches out
    c.say(78, 4, 'CORRIDOR', 'Ride the slide. When it holds still, your soul reaches through the walls.');
    c.wall(80, 7.5, 0.5).wall(80, 7.5, 2.5);
    c.slide(80, [[0, 2], [1, 2], [1.5, 1], [3, 1], [3.5, 2], [5, 2], [5.5, 1], [7, 1]]);
    c.block(80, 0.8, 1).block(81.7, 1.1, 2).block(83.7, 1.1, 1).block(85.7, 1.1, 2);
    c.reaches(82.25, 0.5, [4, 4]).reach(84, 0).reach(86, 4).reach(86.5, 0);
    c.gapWall(1.5, 88, 95.5, [[95, G]]).wall(88, 7.5, 3.5);
    c.slide(88, [[0, 2], [1, 3], [2, 2], [3, 3], [4, 3]]);
    c.reaches(92.5, 0.5, [0, 0]).tap(94, 2).zip(95, 1.5).tap(95.5, 1);

    c.say(94, 3.5, 'WEAVE', '');
    c.gauntlet(96, 0.5, [1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 2, 1, 1, 2], 0.2, 0.25);
    c.hold(104, 3.5, 2).block(104, 4, 0, 1).block(104, 4, 3, 4).reach(105, 4).reach(106, 1).reach(107, 0);
    c.taps(108, 0.5, [2, 2.5, 3, 3.5, 4, 3.5, 3, 2.5]);

    c.say(110, 3, 'CLIMAX', '');
    c.taps(112, 0.25, [2, 1, 0]).taps(113, 0.5, [0.5, 1, 1.5, 2, 2.5, 3]);
    c.taps(116, 0.5, [[3, 4], 3.5, 3, 2.5, [1, 2], 1.5, 1, 0.5]);
    maze(c, 0, 120, 127.75, [[121, 0.5], [122, 1.5], [123.5, 1.5], [124, 0.5], [125, 0.5], [126, 1.5], [127, 2.5]], G, 2);
    c.hold(128, 3.5, 3).reach(129, 0).reach(130, 4).soul(131, 1);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(132, 4, x));
    c.zips(132, 0.5, [2.5, 1.5, 0.5, null, 0.5, 1.5, 2.5, 3.5]);
    c.taps(136, 1, [4, 3, 2.5, 2]);
    c.gauntlet(140, 0.5, [2, 3, 4, 3, 2, 1, 0, 1, 2, 2, 3, 2], 0.2, 0.25);
    c.hold(146, 3.5, 2).block(146, 4, 0, 1).block(146, 4, 3, 4).reaches(147, 0.5, [4, 4]).reach(148, 1).soul(149, 0);
    c.taps(150, 0.5, [2, 2.5, 3, 3]);
    c.slide(152, [[0, 3], [1, 3], [2, 2], [3, 2], [4, 1], [5, 2], [6, 2]]);
  });

  const LEVELS = [firstLight, phaseShift, soulbreak];

  const api = { Chart, level, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TetherLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
