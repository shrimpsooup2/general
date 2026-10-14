/*
  Tether Dodge levels. Each level is a song (synthesised in the browser) plus a chart of hazards.

  Charts are written in beats. Lanes are 0..4 from left to right; a half-step x (1.5, 2.5 ...)
  sits on the divider between two lanes. A hazard hurts while it's on the line: from its beat for
  `len` beats.

    c.block(b, len, x0, x1)        red block over lanes x0..x1 (x1 defaults to x0)
    c.beam(b, len, x0, x1, warn)   lanes flash for `warn` beats (default 2), then fire on beat b
    c.wall(b, len, x)              wall on a divider: no crossing, no snapping through
    c.gapWall(x, from, to, gaps)   wall with openings; gaps = [[centre beat, width in beats], ...]
    c.phaseWall(b, len, x)         dashed wall (fence): snaps pass through it, touching it hurts
    c.phaseBlock(b, len, x0, x1)   dashed block: a snap that would land in it hops over it
    c.sweep(b, from, to, speed)    dashed wall sliding along the line from x `from` to `to` at
                                   `speed` lanes per beat; snap over it as it reaches you
    c.glass(b, len, x0, x1)        glass block: solid until your soul touches it
    c.hardGlass(b, len, x0, x1)    hardglass: only breaks if the soul hits it fast (the slingshot)
    c.soulPhrase(b, len, lane)     the soul is meant to break the glass landing in this window
                                   while the paddle holds `lane` (check.js plans it)
    c.gauntlet(b, step, lanes, ov) one safe lane per segment, every other lane blocked; lanes on
                                   the way stay open `ov` beats either side of each change
    c.say(b, len, title, line)     callout; also a practice section
*/
(function (root) {
  'use strict';

  class Chart {
    constructor(bpm) {
      this.spb = 60 / bpm;
      this.obstacles = [];
      this.texts = [];
      this.phrases = [];
    }
    s(b) { return Math.round(b * this.spb * 1e6) / 1e6; }

    add(kind, b, len, x0, x1, extra) {
      this.obstacles.push(Object.assign({ kind, phase: false, t: this.s(b), t2: this.s(b + len), x0, x1: x1 == null ? x0 : x1, beat: b }, extra));
      return this;
    }
    block(b, len, x0, x1) { return this.add('block', b, len, x0, x1); }
    phaseBlock(b, len, x0, x1) { return this.add('block', b, len, x0, x1, { phase: true }); }
    beam(b, len, x0, x1, warn) { return this.add('beam', b, len, x0, x1, { warn: this.s(warn == null ? 2 : warn) }); }
    glass(b, len, x0, x1) { return this.add('glass', b, len, x0, x1); }
    hardGlass(b, len, x0, x1) { return this.add('glass', b, len, x0, x1, { hard: true }); }
    wall(b, len, x) { return this.add('wall', b, len, x, x); }
    phaseWall(b, len, x) { return this.add('wall', b, len, x, x, { phase: true }); }
    gapWall(x, from, to, gaps, phase) {
      let at = from;
      gaps.slice().sort((a, b) => a[0] - b[0]).forEach(([c, w]) => {
        const g0 = c - w / 2;
        if (g0 > at) this.add('wall', at, g0 - at, x, x, { phase: !!phase });
        at = c + w / 2;
      });
      if (to > at) this.add('wall', at, to - at, x, x, { phase: !!phase });
      return this;
    }
    sweep(b, from, to, speed) {
      const len = Math.abs(to - from) / speed;
      return this.add('wall', b, len, 0, 0, { phase: true, path: [{ t: this.s(b), x: from }, { t: this.s(b + len), x: to }] });
    }
    soulPhrase(b, len, lane) { this.phrases.push({ t: this.s(b), t2: this.s(b + len), lane, beat: b }); return this; }

    gauntlet(b, step, lanes, ov) {
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
      });
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
    done() { return { obstacles: this.obstacles, texts: this.texts, phrases: this.phrases }; }
  }

  function level(meta, build) {
    const c = new Chart(meta.bpm);
    build(c);
    return Object.assign({}, meta, { chart: c.done() });
  }

  // ---------------------------------------------------------------------------------------------
  // 1. FIRST LIGHT: one hazard at a time, well apart. A heart comes back at every section.
  const firstLight = level({
    id: 'first-light',
    name: 'First Light',
    difficulty: 'Easy',
    tier: 1,
    bpm: 92,
    refill: true,
    blurb: 'Blocks, beams, glass your soul breaks, and gates. One idea at a time.',
    music: {
      key: 'A', prog: ['Am', 'F', 'C', 'G'], kit: 'four', bars: 32,
      sections: [[0, 'intro'], [2, 'groove'], [6, 'full'], [13, 'groove'], [17, 'full'], [26, 'drive'], [30, 'outro']],
    },
  }, (c) => {
    c.say(0, 6, 'DODGE', 'Red blocks land on the beat. Press ← → to be somewhere else.');
    c.block(8, 1, 2);
    c.block(10, 1, 0, 1);
    c.block(12, 1, 3, 4);
    c.block(14, 1, 1, 3);
    c.block(16, 2, 0, 2);
    c.block(19, 2, 2, 4);
    c.block(22, 1, 0, 1).block(22, 1, 3, 4);

    c.say(23, 4, 'BEAMS', 'A flashing lane fires on the count. Be out of it by then.');
    c.beam(27, 1, 2);
    c.beam(29, 1, 0, 1);
    c.beam(31, 1, 3, 4);
    c.beam(33, 1, 1, 3);

    c.say(34, 5, 'GLASS', 'Hold CTRL or SPACE: your soul breaks glass, even glass landing right on you.');
    c.block(38, 2, 0, 1).block(38, 2, 3, 4).glass(38, 2, 2).soulPhrase(37.5, 1, 2);
    c.say(41, 4.5, 'REACH', 'Hold CTRL or SPACE and an arrow to stretch your soul to glass in another lane.');
    c.glass(45, 3, 3).beam(46, 1, 0, 2).soulPhrase(44.75, 0.75, 2);
    c.glass(49, 3, 1).beam(50, 1, 2, 4).soulPhrase(48.75, 0.75, 2);

    c.say(51.5, 5, 'GATES', "Walls on the dividers can't be crossed. Go through the gap, or hold SHIFT and snap through.");
    c.gapWall(2.5, 55, 63, [[57, 0.5], [60, 0.5]]);
    c.block(57.6, 1.4, 0, 2).block(60.6, 1.4, 3, 4);
    c.gapWall(1.5, 63, 68, [[65, 0.3]]).block(65.5, 1.5, 2, 4);

    c.say(67, 3, 'TOGETHER', '');
    c.block(70, 1, 0, 1).block(72, 1, 2, 4);
    c.beam(74, 1, 0, 1).beam(76, 1, 3, 4);
    c.block(78, 2, 1, 4).glass(78, 2, 0).soulPhrase(77.75, 0.75, 0);
    c.block(82, 1, 0, 2);
    c.gapWall(2.5, 83, 89, [[86, 0.4]]).block(86.5, 1.5, 3, 4);
    c.beam(89, 1, 0).beam(89, 1, 3, 4);
    c.glass(92, 3, 2).beam(93, 1, 0, 1).beam(93, 1, 3, 4).soulPhrase(91.75, 0.75, 1);
    c.block(96, 1, 1, 3);
    c.block(98, 1, 0).block(98, 1, 4);
    c.beam(100, 1, 0, 2).block(102, 1, 2, 4);

    c.say(103, 3, 'LAST ONES', '');
    c.block(106, 2, 0, 1).block(106, 2, 3, 4).glass(106, 2, 2).soulPhrase(105.5, 1, 2);
    c.block(110, 1, 2).beam(112, 1, 0, 1).beam(114, 1, 3, 4);
    c.block(116, 2, 1, 3);
    c.glass(120, 3, 4).beam(121, 1, 0, 3).soulPhrase(119.75, 0.75, 2);
    c.block(124, 2, 0, 1).block(124, 2, 3, 4).glass(124, 2, 2).soulPhrase(123.5, 1, 2);
  });

  // ---------------------------------------------------------------------------------------------
  // 2. PHASE SHIFT: gates on the beat, fences and hops for the snap, sweepers, and hardglass
  // that only the slingshot breaks.
  const phaseShift = level({
    id: 'phase-shift',
    name: 'Phase Shift',
    difficulty: 'Medium',
    tier: 2,
    bpm: 108,
    refill: true,
    blurb: 'Quarter-beat gates, dashed fences and hops, sweepers to jump, and hardglass for the slingshot.',
    music: {
      key: 'D', prog: ['Dm', 'Bb', 'F', 'C'], kit: 'four', bars: 36,
      sections: [[0, 'intro'], [2, 'groove'], [5, 'full'], [8, 'groove'], [11, 'full'], [14, 'drive'],
        [17, 'break'], [21, 'full'], [25, 'drive'], [33, 'outro']],
    },
  }, (c) => {
    c.say(0, 6, 'PHASE SHIFT', 'Gates, fences, hops, sweepers and hardglass.');
    c.block(6, 1, 2);
    c.gauntlet(8, 1, [1, 0, 1, 2, 3, 4, 3, 2], 0.3);
    c.beam(17, 1, 1, 3).beam(19, 1, 0, 1).beam(19, 1, 3, 4);

    c.say(19.5, 4, 'GATES', 'The gaps are a quarter beat now. Move through right on the beat, or snap.');
    c.gapWall(2.5, 22, 31, [[24, 0.25], [26.5, 0.25], [29, 0.25]]);
    c.block(24.4, 1.5, 0, 2).block(26.9, 1.5, 3, 4).block(29.4, 1.5, 0, 2);

    c.say(30.5, 4, 'FENCES', "Dashed walls: you can't move through them, but a snap passes.");
    c.phaseWall(32, 10, 1.5).phaseWall(32, 10, 2.5);
    c.block(34, 1, 2);
    c.block(36, 1, 0, 1).block(36, 1, 3, 4);
    c.block(38, 1, 2, 4);
    c.block(40, 1, 0, 2);

    c.say(42, 4, 'HOPS', 'Snap into a dashed block and you hop right over it.');
    c.block(44, 1, 4).phaseBlock(44.5, 1.5, 2).block(45, 1.5, 3, 4);
    c.phaseBlock(47.5, 1.5, 2).block(48, 1.5, 0, 1).block(48, 1.5, 4);
    c.phaseBlock(50.5, 1.5, 1, 3).block(51, 1.5, 4);
    c.phaseBlock(53.5, 1.5, 1, 2).block(54, 1.5, 0).block(54, 1.5, 4);

    c.say(55, 5, 'SWEEPERS', 'A dashed wall slides across the line. Snap over it as it reaches you.');
    c.sweep(58, -0.5, 4.5, 1);
    c.sweep(64, 4.5, -0.5, 1);

    c.say(66.5, 5.5, 'HARDGLASS', 'Your soul bounces off it. Stretch past it and let go: the snap-back breaks it.');
    c.hardGlass(72, 2, 1).block(72, 2, 0).block(73, 1, 2, 4).soulPhrase(71.5, 1.25, 2);
    c.hardGlass(76, 2, 3).block(76, 2, 4).block(77, 1, 0, 2).soulPhrase(75.5, 1.25, 2);
    c.say(78, 3.5, 'BACKSHOT', 'One lane from the edge? Pull the other way and the overshoot breaks it.');
    c.hardGlass(82, 2, 4).block(83, 1, 0, 3).soulPhrase(81.25, 1.5, 3);

    c.say(84.5, 3, 'MIX', '');
    c.gauntlet(87, 0.5, [4, 3, 3, 2, 1, 1, 0, 1], 0.2);
    c.beam(92, 1, 0, 2).beam(94, 1, 2, 4);
    c.gapWall(1.5, 95, 101, [[97, 0.25], [99.5, 0.25]]).block(97.4, 1.5, 2, 4).block(99.9, 1, 0, 1);
    c.glass(102, 2, 4).glass(102, 2, 0).block(103, 1, 1, 3).soulPhrase(101.5, 1.25, 2);
    c.sweep(105, -0.5, 4.5, 1.5);
    c.phaseBlock(109.5, 1.5, 1, 2).block(110, 1.5, 0).block(110, 1.5, 4);
    c.hardGlass(113, 2, 2).block(113, 2, 1).block(114, 1, 3, 4).soulPhrase(112.5, 1.25, 3);
    c.phaseWall(116, 6, 1.5).phaseWall(116, 6, 2.5).block(117, 1, 2).block(119, 1, 0, 1).block(119, 1, 3, 4).block(121, 1, 2, 4);

    c.say(122, 3, 'LAST STRETCH', '');
    c.gauntlet(124, 1, [1, 2, 3, 4, 3, 2], 0.25);
    c.sweep(130, 4.5, -0.5, 1);
    c.glass(136, 2, 2).block(136, 2, 0, 1).block(136, 2, 3, 4).soulPhrase(135.5, 1, 2);
    c.beam(139, 1, 0, 1).beam(139, 1, 3, 4);
  });

  // ---------------------------------------------------------------------------------------------
  // 3. SOULBREAK: everything at once, faster, with no hearts back.
  const soulbreak = level({
    id: 'soulbreak',
    name: 'Soulbreak',
    difficulty: 'Hard',
    tier: 3,
    bpm: 126,
    refill: false,
    blurb: 'Half-beat gauntlets, 57 ms gates, fast sweepers, quick beams, chained hops and ricochet glass.',
    music: {
      key: 'E', prog: ['Em', 'C', 'G', 'D'], kit: 'break', bars: 40,
      sections: [[0, 'intro'], [2, 'full'], [6, 'drive'], [10, 'full'], [14, 'break'], [18, 'drive'],
        [22, 'full'], [26, 'break'], [30, 'drive'], [38, 'outro']],
    },
  }, (c) => {
    const G = 0.12; // gate gaps: 57 ms, snap only
    c.say(0, 6, 'SOULBREAK', 'Everything at once. No hearts back. Unlimited hearts is in the settings.');
    c.block(6, 1, 2).block(7, 1, 1, 3);
    c.gauntlet(8, 0.5, [0, 1, 2, 3, 4, 4, 3, 2, 1, 1, 2, 3, 3, 2, 2, 2], 0.18);
    c.beam(17, 0.5, 0, 1, 1).beam(17.5, 0.5, 3, 4, 1).beam(18.5, 0.5, 1, 3, 1).beam(19.5, 0.5, 0, 2, 1);

    c.say(19, 4, 'NEEDLE', 'Gates open for 57 ms. Only a snap fits, and blocks follow you through.');
    // Walls on 1.5 and 2.5 split the field in three; each gap is your only way out before a block lands.
    c.gapWall(2.5, 22, 31, [[24, G], [26, G], [30, G]]);
    c.gapWall(1.5, 22, 31, [[27, G], [29, G]]);
    c.block(24.25, 0.75, 2).block(26.25, 0.75, 3, 4).block(27.25, 0.75, 2).block(29.25, 0.75, 0, 1).block(30.25, 0.75, 2);

    c.say(31, 4, 'SWEEP', 'Sweepers at double speed, from both sides.');
    c.sweep(33, -0.5, 4.5, 2);
    c.sweep(36, 4.5, -0.5, 2);
    c.sweep(39, -0.5, 4.5, 2).block(40, 1, 3, 4);
    c.sweep(42, 4.5, -0.5, 2).block(43, 1, 0, 1);

    c.say(44, 4, 'RICOCHET', 'One throw, two pieces: pull through one, let go, the bounce takes the other.');
    c.glass(48, 1.5, 3).glass(48.25, 1.25, 1).block(48, 1.5, 0).block(48, 1.5, 4).block(49, 1, 2).soulPhrase(47.5, 1.25, 2);
    c.glass(52, 1.5, 1).glass(52.25, 1.25, 3).block(52, 1.5, 0).block(52, 1.5, 4).block(53, 1, 2).soulPhrase(51.5, 1.25, 2);
    c.hardGlass(56, 1.5, 1).block(56, 1.5, 0).block(56.5, 1, 2, 4).soulPhrase(55.25, 1.1, 2);
    c.hardGlass(59, 1.5, 4).block(59.5, 1, 0, 3).soulPhrase(58.25, 1.1, 3);

    c.say(61, 3, 'HOPS', '');
    c.block(63, 1, 0).phaseBlock(64, 1, 1, 3).block(64.5, 1, 4);
    c.phaseBlock(66, 1, 1, 2).block(66.5, 1, 0).block(66.5, 1, 4);
    c.phaseBlock(68, 1, 1, 2).block(68.5, 1, 3, 4);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(70, 6, x));
    c.block(71, 0.5, 1, 4).block(72, 0.5, 0, 2).block(72, 0.5, 4).block(73, 0.5, 0, 1).block(73, 0.5, 3, 4);
    c.block(74, 0.5, 2, 4).block(75, 0.5, 0, 0).block(75, 0.5, 2, 4);

    c.say(76, 4, 'CORRIDOR', 'Walls both sides and glass ahead. Break it as you go.');
    c.wall(80, 8, 0.5).wall(80, 8, 2.5);
    c.block(81, 1, 2).glass(82, 2, 2).block(83, 1, 1).soulPhrase(81.75, 0.75, 1);
    c.block(85, 1, 1).glass(86, 2, 1).block(87, 1, 2).soulPhrase(85.75, 0.75, 2);
    c.gapWall(3.5, 88, 95, [[90, G], [93, G]]).wall(88, 7, 1.5);
    c.block(90.25, 1, 2, 3).block(93.25, 1, 4);

    c.say(94, 3, 'CLIMAX', '');
    c.gauntlet(96, 0.5, [2, 1, 0, 1, 2, 3, 4, 3, 2, 2, 1, 2], 0.18);
    c.sweep(102, -0.5, 4.5, 2).beam(104, 0.5, 0, 1, 1).beam(104, 0.5, 3, 4, 1);
    c.hardGlass(107, 1.5, 3).block(107, 1.5, 4).block(107.5, 1, 0, 2).soulPhrase(106.25, 1.1, 2);
    c.phaseBlock(110, 1, 1, 2).block(110.5, 1, 3, 4);
    c.gapWall(2.5, 112, 118, [[114, G], [116, G]]).block(114.25, 0.75, 0, 2).block(116.25, 0.75, 3, 4);
    c.glass(120, 1.5, 0).glass(120.5, 1, 4).block(120, 1.5, 1, 3).soulPhrase(119.75, 1.25, 0);
    c.sweep(123, 4.5, -0.5, 2).sweep(126, -0.5, 4.5, 2);
    c.gauntlet(130, 0.5, [2, 3, 4, 3, 2, 1, 0, 1, 2, 2], 0.16);

    c.say(135, 3, 'LAST PUSH', '');
    c.beam(138, 0.5, 0, 1, 1).beam(138.5, 0.5, 3, 4, 1).beam(139.5, 0.5, 1, 3, 1);
    c.hardGlass(142, 1.5, 1).block(142, 1.5, 0).block(142.5, 1, 2, 4).soulPhrase(141.25, 1.1, 2);
    [0.5, 1.5, 2.5, 3.5].forEach((x) => c.phaseWall(145, 5, x));
    c.block(146, 0.5, 0, 1).block(146, 0.5, 3, 4).block(147, 0.5, 1, 3).block(148, 0.5, 0, 2).block(149, 0.5, 2, 4);
    c.glass(152, 2, 2).block(152, 2, 0, 1).block(152, 2, 3, 4).soulPhrase(151.5, 1, 2);
    c.sweep(154, -0.5, 4.5, 1.5);
  });

  const LEVELS = [firstLight, phaseShift, soulbreak];

  const api = { Chart, level, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TetherLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
