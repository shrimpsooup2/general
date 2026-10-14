#!/usr/bin/env node
/*
  Engine rule tests for Tether Dodge. Run: node tether-dodge/test.js
  Each case builds a tiny chart at 60 BPM (1 beat = 1 s), feeds timed inputs and checks the result.
*/
'use strict';
const path = require('path');
const E = require(path.join(__dirname, 'engine.js'));
const L = require(path.join(__dirname, 'levels.js'));

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); }
function mk(build, opts, meta) { return new E.Game(L.level(Object.assign({ id: 't', name: 't', bpm: 60, music: { bars: 4 } }, meta), build), opts); }
function run(g, inputs, until) { for (const i of inputs) g.input(i); g.advance(until); return g.drain(); }
const kinds = (ev, type) => ev.filter((e) => e.type === type);
const bonuses = (ev) => kinds(ev, 'bonus').map((e) => e.kind).join();
const dir = (t, d, down = true) => ({ t, kind: 'dir', dir: d, down });
const key = (t, kind, down = true) => ({ t, kind, down });

// hits, hearts, invulnerability
let g = mk((c) => c.block(1, 0.5, 2));
let ev = run(g, [], 3);
ok(g.hearts === 2 && g.stats.hits === 1 && g.state === 'play', 'a block landing on you costs one heart');
g = mk((c) => c.block(1, 0.5, 2).block(1.5, 0.5, 2).block(2.5, 0.5, 2).block(3.5, 0.5, 2));
run(g, [], 6);
ok(g.stats.hits === 3 && g.state === 'dead', 'three hits end the run (the second block lands inside the invulnerable second)');
g = mk((c) => c.block(1, 0.5, 2).block(2.5, 0.5, 2).block(4, 0.5, 2), { noFail: true });
run(g, [], 6);
ok(g.stats.hits === 3 && g.hearts === 3 && g.state !== 'dead', 'unlimited hearts: hits count, the run goes on');
g = mk((c) => c.block(1, 1, 3));
run(g, [], 3);
ok(g.stats.hits === 0, 'a block in the next lane is safe');

// beams hurt only once they fire
g = mk((c) => c.beam(1, 0.5, 2, 2, 2));
run(g, [dir(0.92, 1)], 3);
ok(g.stats.hits === 0, 'leaving a beam lane 80 ms before it fires is safe (clearing a lane takes 67 ms)');
g = mk((c) => c.beam(1, 0.5, 2, 2, 2));
run(g, [dir(1.05, 1)], 3);
ok(g.stats.hits === 1, 'still in the lane when it fires is a hit');

// close calls
g = mk((c) => c.block(1, 0.5, 2));
ev = run(g, [dir(0.925, 1)], 3);
ok(bonuses(ev) === 'razor', 'leaving 75 ms before a block lands (clear 8 ms before): razor');
g = mk((c) => c.block(1, 0.5, 2));
ev = run(g, [dir(0.87, 1)], 3);
ok(bonuses(ev) === 'close', 'leaving 130 ms before (clear 63 ms before): close');
g = mk((c) => c.block(1, 0.5, 2));
ev = run(g, [dir(0.6, 1)], 3);
ok(bonuses(ev) === '', 'leaving early is safe but silent');

// glass and the soul
g = mk((c) => c.glass(1, 1, 2));
run(g, [], 3);
ok(g.stats.hits === 1, 'unbroken glass hurts like a block');
g = mk((c) => c.glass(1, 1, 2));
ev = run(g, [key(0.5, 'soul')], 3);
ok(g.stats.hits === 0 && kinds(ev, 'shatter').length === 1, 'holding the soul key guards: glass landing on you breaks first');
g = mk((c) => c.glass(1, 2, 4).block(2, 1, 0, 3));
ev = run(g, [key(0.7, 'soul'), dir(0.8, 1), dir(1.1, 1, false), key(1.15, 'soul', false), dir(1.3, 1), dir(1.35, 1)], 4);
ok(kinds(ev, 'shatter').length === 1 && g.stats.hits === 0 && g.paddle.x === 4, 'reach: stretch the soul to glass two lanes over, then move into its lane');
g = mk((c) => c.glass(1, 2, 3));
run(g, [key(0.5, 'soul'), dir(0.6, 1)], 0.95);
ok(g.paddle.x === 2, 'the paddle stays put while the soul is out');
g = mk((c) => c.glass(1, 1, 3).glass(1, 1, 1));
ev = run(g, [key(0.7, 'soul'), dir(0.8, 1), dir(1.05, 1, false)], 2);
ok(kinds(ev, 'shatter').length === 2 && bonuses(ev).includes('ricochet'), 'slingshot breaks glass on both sides in one throw (ricochet)');
g = mk((c) => c.block(0, 3, 2).glass(1, 1, 3));
ev = run(g, [dir(-1, -1), key(0.7, 'soul'), dir(0.8, 1)], 2);
ok(g.stats.hits === 0 && kinds(ev, 'shatter').length === 1, 'the soul passes through blocks to reach glass');

// hardglass needs the slingshot
g = mk((c) => c.hardGlass(1, 1, 3));
ev = run(g, [key(0.9, 'soul'), dir(0.98, 1)], 2);
ok(kinds(ev, 'shatter').length === 0 && kinds(ev, 'tink').length > 0, 'a plain pull only tinks off hardglass');
g = mk((c) => c.hardGlass(1, 1, 1));
ev = run(g, [key(0.6, 'soul'), dir(0.7, -1), dir(0.95, -1, false)], 2);
ok(kinds(ev, 'shatter').length === 1, 'whip: pull past it to the wall, let go, and the snap-back breaks it');
g = mk((c) => c.hardGlass(1, 1, 4), {}, { startLane: 3 });
ev = run(g, [key(0.4, 'soul'), dir(0.45, -1), dir(0.91, -1, false)], 2);
ok(kinds(ev, 'shatter').length === 1, 'backshot: from one lane off the edge, pull three lanes the other way, let go: the overshoot breaks it');

// snaps: walls, gaps, dashed things, sweepers
g = mk((c) => c.wall(0, 3, 2.5));
ev = run(g, [key(0, 'snap'), dir(1, 1)], 2);
ok(g.paddle.x === 2 && kinds(ev, 'blocked').length === 1 && g.stats.hits === 0, 'snapping into a wall is blocked, no damage');
g = mk((c) => c.gapWall(2.5, 0, 3, [[1, 0.03]]));
ev = run(g, [key(0, 'snap'), dir(1.0, 1)], 2);
ok(g.paddle.x === 3 && bonuses(ev) === 'thread', 'snap through a 30 ms gap: thread');
g = mk((c) => c.gapWall(2.5, 0, 3, [[1, 0.03]]));
run(g, [dir(1.0, 1)], 2);
ok(g.stats.hits === 1, 'moving through a 30 ms gap hits the wall');
g = mk((c) => c.gapWall(2.5, 0, 3, [[1, 0.2]]));
ev = run(g, [dir(1.01, 1)], 2);
ok(g.stats.hits === 0 && bonuses(ev) === 'thread', 'moving through a 200 ms gap just before it closes threads it');
g = mk((c) => c.phaseWall(0, 3, 2.5));
ev = run(g, [key(0, 'snap'), dir(1, 1)], 2);
ok(g.paddle.x === 3 && g.stats.hits === 0, 'snaps pass dashed walls');
g = mk((c) => c.phaseBlock(0, 3, 3));
ev = run(g, [key(0, 'snap'), dir(1, 1)], 2);
ok(g.paddle.x === 4 && bonuses(ev) === 'hop', 'snapping into a dashed block hops over it: hop');
g = mk((c) => c.sweep(0, -0.5, 4.5, 1));
ev = run(g, [key(0, 'snap'), dir(1.5 + 0.5, -1)], 6);
ok(g.stats.hits === 0 && bonuses(ev).includes('thread'), 'jump the sweeper: snap back over it as it reaches you');
g = mk((c) => c.sweep(0, -0.5, 4.5, 1));
run(g, [], 6);
ok(g.stats.hits === 1, 'a sweeper you don\'t snap over hits you');

// flow multiplier and scoring
g = mk((c) => c.block(30, 1, 2));
run(g, [], 17);
ok(g.stats.flow === 3 && g.stats.beats === 17, `flow rises every 8 clean beats (x${g.stats.flow} after ${g.stats.beats} beats)`);
const before = g.stats.flow;
run(g, [], 31.5);
ok(g.stats.flow === 1 && before > 1, 'a hit drops flow back to x1');

// sections and practice
g = mk((c) => c.say(4, 2, 'A').block(3, 0.5, 2).say(8, 2, 'B'));
run(g, [], 9);
ok(g.hearts === 2, 'no refill unless the level says so');
const lvR = L.level({ id: 't', name: 't', bpm: 60, refill: true, music: { bars: 4 } }, (c) => c.block(3, 0.5, 2).say(8, 2, 'B'));
g = new E.Game(lvR);
run(g, [], 9);
ok(g.hearts === 3, 'refill levels give a heart back at the next section');
for (const lv of L.LEVELS) {
  const bad = [];
  for (const sec of lv.chart.texts.filter((x) => x.title && x.t > 0.5)) {
    const pg = new E.Game(lv, { from: sec.t });
    pg.advance(pg.t + 0.4);
    if (pg.stats.hits) bad.push(sec.title);
  }
  ok(!bad.length, `${lv.name}: practice from any section starts clear${bad.length ? ' (hit: ' + bad.join(', ') + ')' : ''}`);
  // Nothing from before the section can touch you in its lead-in.
  const early = [];
  for (const sec of lv.chart.texts.filter((x) => x.title && x.t > 0.5)) {
    const pg = new E.Game(lv, { from: sec.t, noFail: true });
    pg.advance(sec.t - 0.01);
    if (pg.stats.hits) early.push(sec.title);
  }
  ok(!early.length, `${lv.name}: nothing hits you before a practice section begins${early.length ? ' (hit: ' + early.join(', ') + ')' : ''}`);
  const full = new E.Game(lv, { noFail: true });
  full.advance(400);
  ok(full.state === 'done', `${lv.name}: runs to the end`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
