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

  // ---------------------------------------------------------------------------------------------
  // 1. FIRST LIGHT: one mechanic at a time, with a callout before each.
  const firstLight = level({
    id: 'first-light',
    name: 'First Light',
    difficulty: 'Easy',
    tier: 1,
    bpm: 100,
    blurb: 'Learn every move: lanes, gems, holds, blocks, snaps, walls and your soul.',
    music: {
      key: 'A', prog: ['Am', 'F', 'C', 'G'], kit: 'four', bars: 34,
      sections: [[0, 'intro'], [2, 'groove'], [8, 'full'], [16, 'groove'], [20, 'full'], [26, 'drive'], [32, 'outro']],
    },
  }, (c) => {
    // Moving
    c.say(0, 7.5, 'MOVE', '← → switch lanes. Your paddle catches whatever it touches.');
    c.tap(4, 2).tap(6, 2);
    c.taps(8, 1, [2, 1, 0, 1, 2, 3, 4, 3]);
    c.taps(16, 1, [2, 2, 0, 0, 2, 2, 4, 4]);

    // Holds and slides
    c.say(21.5, 6, 'HOLD', 'Stay under long notes, even when they slide.');
    c.hold(24, 1.5, 3);
    c.hold(26, 1.5, 1);
    c.slide(28, [[0, 1], [1, 1], [2, 3], [3.5, 3]]);

    // Gems
    c.say(30.5, 5, 'GEMS', 'Gold gems sit between lanes. Catch them while you move through.');
    c.tap(32, 3);
    c.tap(33, 2.5).tap(34, 2);
    c.tap(35, 2.5).tap(36, 3);
    c.tap(37, 3.5).tap(38, 4);
    c.tap(39, 3.5).tap(40, 3);
    c.taps(41, 0.5, [2.5, 1.5]).tap(42, 1);
    c.taps(43, 0.5, [1.5, 2.5]).tap(44, 3);
    c.taps(45, 0.5, [2.5, 1.5, 0.5]).tap(47, 0);

    // Blocks
    c.say(45.5, 5, 'BLOCKS', 'Red blocks end the run. Never touch one.');
    c.tap(48, 0);
    c.block(49, 2, 0).taps(49, 1, [1, 1]);
    c.block(51, 1, 0, 1).taps(51, 1, [2, 2]);
    c.block(53, 1, 2, 4).taps(53, 1, [0, 0]);
    c.block(55, 1.5, 0, 2).block(55, 1.5, 4).taps(55, 1, [3, 3]);
    c.block(57, 3, 0, 1).block(57, 3, 4);
    c.slide(57, [[0, 3], [1, 3], [1.5, 2], [2.5, 2], [3, 3]]);
    c.block(61, 2, 2, 4).taps(61, 1, [1, 0]);

    // Snap and zips
    c.say(61.5, 6, 'SNAP', 'Hold SHIFT and tap ← → to teleport a lane. Snap across green zips.');
    c.tap(64, 2);
    c.zip(65, 2.5).tap(66, 3);
    c.zip(67, 2.5).tap(68, 2);
    c.zips(69, 1, [1.5, 0.5]).tap(71, 0);
    c.zips(72, 1, [0.5, 1.5, 2.5, 3.5]).tap(76, 4);

    // Walls
    c.say(74.5, 5, 'WALLS', 'Moving into a wall ends the run. Snap through the gap.');
    c.tap(77, 4);
    c.gapWall(3.5, 76.5, 81, [[79, 0.5]]).zip(79, 3.5).tap(80, 3);
    c.gapWall(2.5, 79.5, 84, [[82, 0.25]]).zip(82, 2.5).tap(83, 2);
    c.gapWall(1.5, 82.5, 87, [[85, 0.25]]).zip(85, 1.5).tap(86, 1);

    // Soul
    c.say(85.5, 6, 'SOUL', 'Hold CTRL or SPACE and press ← →. Your soul slides out. Let go and it snaps back.');
    c.hold(88, 3.5, 1);
    c.souls(89, 1, [4, 4, 4]);
    c.hold(92, 3.75, 0);
    c.souls(93, 0.25, [1, 2, 3, 4]);
    c.hold(96, 7, 2);
    c.souls(97, 0.25, [3, 4]);
    c.souls(99, 0.25, [1, 0]);
    c.souls(101, 0.25, [3, 4]);

    // Everything together
    c.say(102, 3.5, 'ALL TOGETHER', '');
    c.taps(104, 0.5, [2, null, 2.5, 3, null, 3.5, 4, null]);
    c.taps(108, 0.5, [4, null, 3.5, 3, 2.5, 2, null, null]);
    c.block(112, 2, 0, 1).block(112, 2, 3, 4).taps(112, 1, [2, 2]);
    c.zips(114.5, 0.5, [2.5, 3.5]).tap(115.5, 4);
    c.block(116, 2, 0, 3).taps(116, 1, [4, 4]);
    c.zips(118.5, 0.5, [3.5, 2.5, 1.5]);
    c.hold(120, 3.75, 1);
    c.souls(121, 0.25, [2, 3, 4]);
    c.soul(123, 0);
    c.taps(124, 0.5, [1, 1.5, 2, 2.5, 3, 2.5, 2, 1.5]);
    c.slide(128, [[0, 1], [2, 1], [3, 2], [5, 2]]);
    c.tap(134, 2);
  });

  // ---------------------------------------------------------------------------------------------
  // 2. PHASE SHIFT: the moves start to combine.
  const phaseShift = level({
    id: 'phase-shift',
    name: 'Phase Shift',
    difficulty: 'Medium',
    tier: 2,
    bpm: 124,
    blurb: 'Bounces, doubles, a wall maze with tiny gaps, dashed hops and soul sweeps through blocks.',
    music: {
      key: 'D', prog: ['Dm', 'Bb', 'F', 'C'], kit: 'four', bars: 40,
      sections: [[0, 'intro'], [2, 'groove'], [6, 'full'], [10, 'groove'], [14, 'full'], [18, 'break'],
        [22, 'full'], [26, 'groove'], [30, 'drive'], [38, 'outro']],
    },
  }, (c) => {
    c.say(0, 6, 'PHASE SHIFT', 'Bounces, doubles, tiny gaps and dashed walls.');
    c.taps(4, 1, [2, 1, 2, 3]);

    // Runs and bounces
    c.taps(8, 0.5, [2, 1, 0, 1, 2, 3, 4, 3]);
    c.taps(12, 0.5, [2, 2.5, 3, 3.5, 4, 3.5, 3, 2.5]);
    c.say(13.5, 4.5, 'BOUNCE', 'Touch a gem and come straight back: tap → then ← quickly.');
    c.taps(16, 0.5, [2, 2.5, 2, 1.5, 2, 2.5, 2, 1.5]);
    c.taps(20, 0.5, [2, 2.5, 3, 3.5, 3, 2.5, 2, 1.5]);

    // Doubles
    c.say(21.5, 4.5, 'DOUBLES', 'Two notes at once? Cross between them right on the beat.');
    c.tap(24, [1, 2]).tap(25, [2, 3]).tap(26, [3, 4]).tap(27, [2, 3]);
    c.taps(28, 1, [[1, 2], 2.5, [3, 4], 3.5]);
    c.taps(32, 1, [[2, 3], 1.5]).taps(34, 0.5, [[0, 1], 0.5, [1, 2]]);
    c.taps(36, 0.5, [2, 2.5, 3, 2.5, 2, 1.5, 1, 1.5]);

    // Wall maze: the gaps are too short to move through, so snap. Zips mark each gap.
    c.say(37, 5, 'TINY GAPS', 'Too narrow to move through. Snap through them.');
    const G = 0.2;
    const maze = { 0.5: [49, 50], 1.5: [47, 51], 2.5: [41, 46, 53, 54.5], 3.5: [43, 45] };
    for (const x in maze) {
      c.gapWall(+x, 40, 56, maze[x].map((b) => [b, G]));
      maze[x].forEach((b) => c.zip(b, +x));
    }
    c.taps(40, 0.5, [2, 2]).taps(42, 0.5, [3, 3]).taps(44, 0.5, [4, 4]).tap(45.5, 3);
    c.tap(46.5, 2).taps(48, 0.5, [1, 1]).tap(49.5, 0).tap(50.5, 1).taps(52, 0.5, [2, 2]);
    c.taps(53.5, 0.5, [3, 3]).taps(55, 0.5, [2, 2]);

    // Dashed walls: only snaps get through
    c.say(54.5, 5, 'DASHED', 'Snaps pass dashed walls and hop dashed blocks. Touching them still fails.');
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(56, 8, x));
    c.tap(56, 2).zips(57, 0.5, [2.5, 3.5]).tap(58, 4);
    c.zips(58.5, 0.5, [3.5, 2.5, 1.5, 0.5]).taps(60.5, 0.5, [0, 0]);
    c.zips(61.5, 0.25, [0.5, 1.5, 2.5, 3.5]).taps(62.5, 0.5, [4, 4]);
    // Dashed blocks: a snap hops right over them, catching every zip on the way
    c.phaseBlock(64, 2, 3).zip(65, 3.5).zip(65, 2.5).taps(65.5, 0.5, [2, 2]);
    c.phaseBlock(66.5, 2, 1).zip(67.5, 1.5).zip(67.5, 0.5).taps(68, 0.5, [0, 0]);
    c.phaseBlock(68.75, 2, 1, 3).zips(69.5, 0, [0.5, 1.5, 2.5, 3.5]).taps(70, 0.5, [4, 4]);

    // Soul through blocks
    c.say(69.5, 5, 'SOUL SWEEP', 'Your soul goes through blocks. Hold one arrow, tap the other to turn it around.');
    c.hold(72, 7.25, 4).block(72, 7.5, 0, 2);
    c.souls(73, 0.25, [3, 2, 1, 0]);
    c.souls(75, 0.25, [0, 1, 2, 3, 4]);
    c.souls(77, 0.5, [2, 0, 2]);
    c.hold(81, 6.5, 0).block(81, 7, 2, 4);
    c.souls(82, 0.25, [1, 2, 3, 4]);
    c.souls(84, 0.5, [2, 4, 2, 4]);
    c.souls(86, 0.25, [3, 2, 1]);

    // Weave: one safe lane at a time
    c.say(86, 3.5, 'WEAVE', 'One lane is safe. Keep moving.');
    c.gauntlet(88, 1, [0, 1, 2, 1, 2, 3, 4, 3], 0.25, 0.5);
    c.slide(96, [[0, 3], [1, 3], [2, 1], [3, 1]]);
    c.taps(99.5, 0.25, [1.5, 2]);
    c.slide(100, [[0, 2], [0.5, 2], [1.5, 4], [2, 4], [3, 2], [3.5, 2]]);

    // Escape: blocks chase you down the maze; snap out through each gap in time
    c.say(101.5, 5, 'ESCAPE', 'A block is coming down your lane. Snap out through the gap.');
    const route = [[105, 2.5], [107, 3.5], [109, 3.5], [110, 2.5], [111, 1.5], [113, 0.5], [115, 0.5], [116, 1.5], [117.5, 2.5]];
    const gaps = { 0.5: [], 1.5: [], 2.5: [], 3.5: [] };
    route.forEach(([b, x]) => { gaps[x].push([b, G]); c.zip(b, x); });
    for (const x in gaps) c.gapWall(+x, 104, 119.5, gaps[x]);
    [[2, 105.3, 109.7], [3, 107.3, 108.8], [4, 109.3, 112], [3, 110.3, 116], [2, 111.3, 115.7],
      [1, 113.3, 114.7], [0, 115.3, 118], [1, 116.3, 119.5], [2, 117.8, 119.5]].forEach(([L, s, e]) => c.block(s, e - s, L));
    c.taps(104, 0.5, [2, 2]).taps(106, 0.5, [3, 3]).taps(108, 0.5, [4, 4]).tap(109.5, 3).tap(110.5, 2);
    c.taps(112, 0.5, [1, 1]).taps(114, 0.5, [0, 0]).tap(115.5, 1).taps(116.5, 0.5, [2, 2]).taps(118, 0.5, [3, 3]);

    // Finale
    c.say(118.5, 3, 'FINALE', '');
    c.taps(120, 0.5, [3, 3.5, [3, 4], 3.5, [2, 3], 2.5, [1, 2], 1.5]);
    c.taps(124, 0.5, [[0, 1], 0.5, [0, 1], 1.5, [1, 2], 2.5, 3, 2.5]);
    c.hold(128, 3.5, 2).souls(129, 0.25, [3, 4]).souls(130, 0.25, [1, 0]).soul(131, 4);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(132, 4, x));
    c.tap(132, 2).zips(132.5, 0.25, [2.5, 3.5]).tap(133.5, 4).zips(134, 0.25, [3.5, 2.5, 1.5, 0.5]).tap(135.25, 0);
    c.gauntlet(136, 0.5, [0, 1, 2, 2, 3, 4, 4, 3, 2, 1, 1, 2, 3, 3, 2, 2], 0.2, 0.25);
    c.hold(144, 3.5, 2).block(144, 4, 0, 1).block(144, 4, 3, 4);
    c.souls(145, 0.25, [3, 4]).souls(146, 0.25, [1, 0]).souls(147, 0.25, [1, 2, 3, 4]);
    c.taps(148, 0.5, [2, 2.5, 3, 2.5, 2, 1.5, 1, 1.5]);
    c.slide(152, [[0, 2], [1, 2], [2, 0], [3, 0], [5, 4], [6, 4], [7, 2]]);
  });

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
    visits.slice(1).forEach(([L, s, e]) => {
      c.tap(s + 0.25, L);
      if (e - s >= 1) c.tap(s + 0.5, L);
    });
    return lane;
  }

  // ---------------------------------------------------------------------------------------------
  // 3. SOULBREAK: everything, fast. At 150 BPM a 16th note is 100 ms, exactly one lane of travel.
  const soulbreak = level({
    id: 'soulbreak',
    name: 'Soulbreak',
    difficulty: 'Hard',
    tier: 3,
    bpm: 150,
    blurb: '16th-note streams, hovering by tapping, 40 ms gaps, triple hops and split paddle/soul play.',
    music: {
      key: 'E', prog: ['Em', 'C', 'G', 'D'], kit: 'break', bars: 48,
      sections: [[0, 'intro'], [2, 'full'], [6, 'drive'], [10, 'full'], [14, 'break'], [18, 'drive'],
        [22, 'full'], [26, 'break'], [30, 'drive'], [46, 'outro']],
    },
  }, (c) => {
    const G = 0.1; // gap width in beats: 40 ms

    c.say(0, 7, 'SOULBREAK', 'Everything, fast. No-fail mode is in the settings.');
    c.taps(4, 0.5, [2, 1, 2, 3]).taps(6, 0.5, [2, 1.5, 1, 0.5]);

    // Streams: a 16th per lane is the paddle's top speed
    c.taps(8, 0.25, [0, 1, 2, 3, 4, null, 4, 3, 2, 1, 0, null, 0, 0.5, 1, 1.5]);
    c.taps(12, 0.25, [2, 2.5, 3, 3.5, 4, 3.5, 3, 2.5, 2, 1.5, 2, 2.5, 2, 1.5, 1, 0.5]);
    c.taps(16, 0.25, [0, 0.5, 0, 0.5, 1, 1.5, 1, 1.5, 2, 2.5, 2, 2.5, 3, 3.5, 4, null]);
    c.taps(20, 0.25, [4, 3.5, 4, 3.5, 3, 2.5, 3, 2.5, [1, 2], null, 1.5, null, [2, 3], 2.5, [1, 2], 1.5]);

    // Hover: thin holds on a divider. Tap ← → fast to stay on them.
    c.say(21.5, 4.5, 'HOVER', 'Thin holds sit on a divider. Tap ← → ← → fast to stay on it.');
    c.tap(24, 2).hold(24.5, 1.5, 1.5).tap(26.5, 1);
    c.hold(27, 1.5, 2.5).tap(29, 3);
    c.taps(29.5, 0.25, [3.5, 3, 3.5, 4, 3.5, 3, 2.5, 2]);
    c.hold(31.5, 2, 1.5).taps(34, 0.25, [1, 0.5, 0, 0.5, 1, 1.5, 2, 2.5]);
    c.slide(36, [[0, 3], [1, 3], [1.5, 2.5], [2.5, 2.5], [3, 2]], true);
    c.tap(39.5, 2);

    // Needle: the wall maze again with 40 ms gaps, and only every other gap marked
    c.say(37.5, 4.5, 'NEEDLE', 'The gaps are 40 ms now, and blocks follow you out. Snap on the beat.');
    maze(c, 2, 40, 55.75, [[41, 2.5], [42, 3.5], [43.5, 3.5], [44, 2.5], [45, 1.5], [46, 0.5], [47.5, 0.5],
      [48, 1.5], [49, 2.5], [50, 3.5], [51.5, 3.5], [52, 2.5], [53, 1.5], [54.5, 1.5]], G, 2);

    // Split: the paddle holds its lane while the soul sweeps the blocked ones
    c.say(54, 4, 'SPLIT', 'The paddle holds its note while your soul sweeps the blocked lanes.');
    c.hold(56, 7.5, 2).block(56, 8, 0, 1).block(56, 8, 3, 4);
    c.souls(57, 0.25, [3, 4]).souls(57.75, 0.25, [3, 2, 1, 0]).souls(59, 0.25, [1, 2, 3, 4]);
    c.souls(60.5, 0.5, [4, 2, 0, 2, 4]).souls(63, 0.25, [3, 2]);
    c.taps(64, 0.5, [2, 2, 2]).taps(65.25, 0.25, [2.5, 3, 3.5, 4]);
    c.hold(66, 5.5, 4).block(66.5, 5.5, 0, 2);
    c.souls(67, 0.25, [3, 2, 1, 0]).souls(68.25, 0.25, [1, 2, 3, 4]);
    c.souls(69.5, 0.25, [3, 2, 1, 0]).souls(70.75, 0.25, [1, 2]);

    // Hops: chained snaps over dashed blocks; every zip crossed counts
    c.say(70, 4, 'HOPS', 'Chain snaps over dashed blocks. Every zip you cross counts.');
    c.taps(72, 0.5, [4, 4]).phaseBlock(72.75, 1.25, 3).zip(73, 3.5).zip(73, 2.5);
    c.phaseBlock(73.25, 0.65, 1).zip(73.5, 1.5).zip(73.5, 0.5).taps(74, 0.25, [0, 0.5, 1, 0.5, 0]);
    c.phaseBlock(75.25, 0.75, 1, 3).zips(75.5, 0, [0.5, 1.5, 2.5, 3.5]).taps(76, 0.25, [4, 4]);
    c.phaseBlock(76.5, 1.25, 2, 3).zips(77, 0, [3.5, 2.5, 1.5]).tap(77.5, 1);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(78, 4, x));
    c.zips(78, 0.25, [1.5, 2.5, 3.5, null, 3.5, 2.5, 1.5, 0.5, null, 0.5, 1.5, 2.5, null, 2.5, 1.5, null]);
    c.taps(82, 0.25, [1, 1.5, 2, 2.5, 3, 3.5, 3, 2.5]);
    c.phaseBlock(84, 1.5, 0, 1).block(84, 1.4, 3, 4).taps(84, 0.5, [2, 2, 2]);
    c.zip(85.5, 2.5).phaseBlock(85.75, 1.25, 2).tap(86, 3).zips(86.5, 0, [2.5, 1.5]).tap(87, 1);

    // Corridor: follow the slide between the walls, dodging the blocks inside, then thread out
    c.say(86, 4, 'CORRIDOR', 'Ride the slide between the walls.');
    c.gapWall(0.5, 88, 96, [[95.5, G]]).wall(88, 8, 2.5);
    c.slide(88, [[0, 1], [1, 1], [1.5, 2], [2.5, 2], [3, 1], [4, 1], [4.5, 2], [5.5, 2], [6, 1], [7, 1]]);
    c.block(88, 0.9, 2).block(89.7, 0.6, 1).block(91.1, 0.8, 2).block(92.7, 0.6, 1).block(94.1, 1.1, 2);
    c.zip(95.5, 0.5).taps(96, 0.25, [0, 0, 0.5, 1, 1.5, 2]);
    c.gapWall(1.5, 97.5, 104, [[101.5, G]]).wall(97.5, 6.5, 3.5);
    c.slide(98, [[0, 2], [1, 3], [2, 2], [3, 3]]).tap(101.25, 2).zip(101.5, 1.5);
    c.taps(102, 0.25, [1, 1, 0.5, 0]);

    // Breather: half time, soul and hovers
    c.say(103, 3.5, 'BREATHE', '');
    c.hold(104, 3.5, 0).souls(105, 0.5, [2, 4, 2, 4]);
    c.hold(108, 1.5, 0.5).tap(110, 1).hold(110.5, 1.5, 1.5).tap(112.5, 2);
    c.hold(113, 3, 2).souls(114, 0.25, [1, 0]).souls(115, 0.25, [3, 4]);
    c.taps(116.5, 0.5, [2.5, 3, 3.5]).hold(118, 1.5, 3.5);

    // Climax
    c.say(118.5, 3, 'CLIMAX', '');
    c.taps(120, 0.25, [4, 3, 2, 1, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 3.5, 3, 2.5]);
    c.taps(124, 0.25, [2, 1.5, 2, 2.5, 2, 1.5, 1, 0.5, 0, 0.5, 1, 1.5, [1, 2], null, [2, 3], null]);
    c.gauntlet(128, 0.5, [3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 2, 1, 2, 3, 3, 2], 0.15, 0.25);
    c.hold(136, 3.5, 2).souls(137, 0.25, [3, 4, 3, 2, 1, 0]).souls(138.75, 0.25, [1, 2, 3, 4]);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(140, 4, x));
    c.tap(140, 2).zips(140.5, 0.25, [1.5, 0.5, null, 0.5, 1.5, 2.5, 3.5, null, 3.5, 2.5, null, 1.5]);
    c.tap(144, 1).hold(144.5, 1.25, 1.5).taps(146, 0.25, [2, 2.5, 3, 2.5]).hold(147, 0.75, 2.5).tap(148, 3);
    c.phaseBlock(148.5, 1, 1, 2).zips(149, 0, [2.5, 1.5, 0.5]).taps(149.5, 0.25, [0, 0.5, 1, 1.5, 2, 2]);

    // Last push. Walled in: the paddle catches its lane while the soul works outside the walls.
    c.say(150, 3.5, 'LAST PUSH', 'Your soul goes through walls too.');
    c.wall(152, 8, 1.5).gapWall(2.5, 152, 160, [[159, G]]);
    c.taps(152, 0.5, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    c.souls(152.75, 0.25, [3, 4]).souls(153.75, 0.25, [1, 0]).souls(154.75, 0.25, [3, 4, 3, 2, 1, 0]);
    c.souls(156.75, 0.25, [1, 2, 3, 4]).souls(158, 0.25, [3, 4]);
    c.block(159.25, 0.75, 2).zip(159, 2.5).taps(159.5, 0.25, [3, 3.5, 4]);
    c.phaseBlock(160.25, 0.75, 1, 3).zips(160.5, 0, [3.5, 2.5, 1.5, 0.5]).taps(161, 0.25, [0, 0.5, 1, 0.5, 0]);
    c.phaseBlock(162.25, 1, 1, 2).block(162.25, 0.85, 4).zips(162.5, 0, [0.5, 1.5, 2.5]).tap(163, 3);
    c.taps(163.25, 0.25, [3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0]);
    c.hold(165.5, 2, 0).souls(166, 0.25, [1, 2, 3, 4]);
    c.gauntlet(168, 0.5, [0, 1, 2, 3, 4, 3, 2, 1, 0, 0, 1, 2, 2, 3, 3, 2], 0.12, 0.25);
    c.taps(176, 0.25, [2, 2.5, 3, 3.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0, 0.5, 1, 1.5]);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(180, 4, x));
    c.zips(180, 0.25, [2.5, 3.5, null, 3.5, 2.5, 1.5, 0.5, null, 0.5, 1.5, 2.5, null, 2.5]);

    // Outro
    c.hold(184, 2, 2).souls(184.5, 0.25, [1, 0]).souls(185.25, 0.25, [3, 4]);
    c.slide(186.5, [[0, 2], [1, 2], [2, 1], [3, 3], [4, 2], [4.5, 2]]);
  });

  const LEVELS = [firstLight, phaseShift, soulbreak];

  const api = { Chart, level, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TetherLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
