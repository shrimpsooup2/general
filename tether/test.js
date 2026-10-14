#!/usr/bin/env node
/*
  Engine rule tests. Run: node tether/test.js
  Each case builds a tiny chart at 60 BPM (1 beat = 1 s), feeds timed inputs and checks the result.
*/
'use strict';
const path = require('path');
const E = require(path.join(__dirname, 'engine.js'));
const L = require(path.join(__dirname, 'levels.js'));
let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); }
// 60 BPM so 1 beat = 1 s
function mk(build, opts) { return new E.Game(L.level({ id: 't', name: 't', bpm: 60, music: { bars: 4 } }, build), opts); }
function run(g, inputs, until) {
  for (const i of inputs) g.input(i);
  g.advance(until);
  return g.drain();
}
const judges = (ev) => ev.filter((e) => e.type === 'judge').map((e) => `${e.note.type}@${e.note.x}:${e.grade}${e.part === 'body' ? '(body)' : ''}`);

// 1 stationary catch
let g = mk((c) => c.tap(1, 2));
ok(judges(run(g, [], 2)).join() === 'tap@2:perfect', 'stationary paddle catches lane note perfectly');

// 2 neighbour lane not caught
g = mk((c) => c.tap(1, 3));
ok(judges(run(g, [], 2)).join() === 'tap@3:miss', 'note in next lane is missed when you sit still');

// 3 gem caught by moving through, missed when sitting
g = mk((c) => c.tap(1, 2.5));
ok(judges(run(g, [{ t: 0.97, kind: 'dir', dir: 1, down: true }], 2)).join() === 'gem@2.5:perfect', 'gem caught while moving through');
ok(g.paddle.x === 3, 'paddle ends on lane 3');
g = mk((c) => c.tap(1, 2.5));
ok(judges(run(g, [], 2)).join() === 'gem@2.5:miss', 'gem missed when sitting in lane 2');

// 4 reversal mid move
g = mk(() => {});
run(g, [{ t: 0, kind: 'dir', dir: 1, down: true }, { t: 0.04, kind: 'dir', dir: -1, down: true }], 1);
ok(g.paddle.x === 2 && g.paddle.target === 2, 'reversing mid-move returns to the lane you left');
g = mk(() => {});
run(g, [{ t: 0, kind: 'dir', dir: 1, down: true }, { t: 0.02, kind: 'dir', dir: 1, down: true }], 1);
ok(g.paddle.x === 4, 'double tap queues two lanes');

// 5 hover by spamming keeps paddle between lanes
g = mk((c) => c.hold(1, 1, 2.5));
const spam = [];
spam.push({ t: 0.9, kind: 'dir', dir: 1, down: true });
let d = -1;
for (let t = 0.95; t < 2.0; t += 0.05) { spam.push({ t, kind: 'dir', dir: d, down: true }); d = -d; }
const ev5 = run(g, spam, 2.3);
ok(judges(ev5).some((j) => j.includes('(body)') && !j.includes('miss')), 'spamming ←→ holds a thin note between lanes: ' + judges(ev5).join(' '));

// 6 snap through zip
g = mk((c) => c.zip(1, 2.5));
let ev = run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1.01, kind: 'dir', dir: 1, down: true }], 2);
ok(judges(ev).join() === 'zip@2.5:perfect' && g.paddle.x === 3, 'snap across zip is perfect and lands on lane 3');
// moving across a zip doesn't count
g = mk((c) => c.zip(1, 2.5));
ev = run(g, [{ t: 0.95, kind: 'dir', dir: 1, down: true }], 2);
ok(judges(ev).join() === 'zip@2.5:miss', 'moving (not snapping) across a zip misses it');

// 7 snap blocked by wall, passes through gap, passes dashed wall
g = mk((c) => c.wall(0, 3, 2.5));
ev = run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1, kind: 'dir', dir: 1, down: true }], 2);
ok(ev.some((e) => e.type === 'blocked') && g.paddle.x === 2 && g.state === 'play', 'snap into a wall is blocked, no death');
g = mk((c) => c.gapWall(2.5, 0, 3, [[1, 0.02]]));
ev = run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1.005, kind: 'dir', dir: 1, down: true }], 2);
ok(g.paddle.x === 3 && g.state === 'play', 'snap through a 20 ms gap works');
g = mk((c) => c.gapWall(2.5, 0, 3, [[1, 0.02]]));
ev = run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1.02, kind: 'dir', dir: 1, down: true }], 2);
ok(g.paddle.x === 2 && ev.some((e) => e.type === 'blocked'), 'snap 10 ms after the gap closes is blocked');
g = mk((c) => c.gapWall(2.5, 0, 3, [[1, 0.02]]));
ev = run(g, [{ t: 1.0, kind: 'dir', dir: 1, down: true }], 2);
ok(g.state === 'dead', 'moving through a 20 ms gap kills you');
g = mk((c) => c.phaseWall(0, 3, 2.5));
ev = run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1, kind: 'dir', dir: 1, down: true }], 2);
ok(g.paddle.x === 3 && g.state === 'play', 'snap passes a dashed wall');
g = mk((c) => c.phaseWall(0, 3, 2.5));
run(g, [{ t: 1, kind: 'dir', dir: 1, down: true }], 2);
ok(g.state === 'dead', 'moving into a dashed wall kills you');

// 8 phase block skip, solid block stop
g = mk((c) => c.phaseBlock(0, 3, 3));
run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1, kind: 'dir', dir: 1, down: true }], 2);
ok(g.paddle.x === 4 && g.state === 'play', 'snap hops over a dashed block (2 -> 4)');
g = mk((c) => c.block(0, 3, 3));
ev = run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1, kind: 'dir', dir: 1, down: true }], 2);
ok(g.paddle.x === 2 && ev.some((e) => e.type === 'blocked'), 'snap into a solid block is blocked');
g = mk((c) => c.phaseBlock(0, 3, 3, 4));
ev = run(g, [{ t: 0, kind: 'snap', down: true }, { t: 1, kind: 'dir', dir: 1, down: true }], 2);
ok(g.paddle.x === 2 && ev.some((e) => e.type === 'blocked'), 'dashed block to the edge: nowhere to land, blocked');

// 9 block kills, no-fail just counts
g = mk((c) => c.block(1, 1, 2));
run(g, [], 3);
ok(g.state === 'dead', 'sitting in a block lane kills you');
g = mk((c) => c.block(1, 1, 2), { noFail: true });
run(g, [], 5);
ok(g.state === 'play' && g.stats.hits === 1, 'no-fail counts the hit and carries on');
g = mk((c) => c.block(1, 1, 3));
run(g, [], 3);
ok(g.state !== 'dead', 'block in the next lane is safe');

// 10 soul
g = mk((c) => c.soul(1, 4));
ev = run(g, [], 2);
ok(judges(ev).join() === 'soul@4:miss', 'soul note missed without the soul');
g = mk((c) => c.soul(1, 2));
ev = run(g, [], 2);
ok(judges(ev).join() === 'soul@2:miss', 'paddle alone does not catch a soul note in its own lane');
g = mk((c) => c.soul(1, 2));
ev = run(g, [{ t: 0.5, kind: 'soul', down: true }], 2);
ok(judges(ev).join() === 'soul@2:perfect', 'releasing the soul catches the note in your lane');
// the elastic tether
g = mk((c) => c.soul(1, 4));
ev = run(g, [{ t: 0.4, kind: 'soul', down: true }, { t: 0.5, kind: 'dir', dir: 1, down: true }], 1.2);
ok(judges(ev).join() === 'soul@4:perfect', 'soul stretches out and catches lane 4');
ok(g.paddle.x === 2, 'paddle stays put while the soul is out');
g = mk(() => {});
run(g, [{ t: 0, kind: 'soul', down: true }, { t: 0.1, kind: 'dir', dir: -1, down: true }], 0.11);
const v1 = Math.abs(g.soul.v);
run(g, [], 0.25);
ok(v1 > 2 * Math.abs(g.soul.v) && g.soul.x < 1, `pulling slows as it stretches (${v1.toFixed(1)} -> ${Math.abs(g.soul.v).toFixed(1)} lanes/s)`);
g = mk(() => {});
run(g, [{ t: 0, kind: 'soul', down: true }, { t: 0.1, kind: 'dir', dir: 1, down: true }], 0.9);
ok(g.soul.x === 4, 'held pull rests against the field edge');
let lowest = 9;
g.input({ t: 0.9, kind: 'dir', dir: 1, down: false });
for (let t = 0.92; t < 1.3; t += 0.01) { g.advance(t); lowest = Math.min(lowest, g.soul.x); }
ev = g.drain();
ok(lowest < 1.5, `letting go flings it past the paddle (to x=${lowest.toFixed(2)})`);
ok(ev.some((e) => e.type === 'twang'), 'letting go of a stretch twangs');
run(g, [], 1.6);
ok(Math.abs(g.soul.x - 2) < 0.05, 'and it settles back on the paddle');
run(g, [{ t: 1.6, kind: 'soul', down: false }], 2.2);
ok(!g.soul.out, 'releasing ctrl puts the soul away');
g = mk((c) => c.block(0, 3, 4).soul(1, 4));
ev = run(g, [{ t: 0.4, kind: 'soul', down: true }, { t: 0.5, kind: 'dir', dir: 1, down: true }], 2);
ok(judges(ev).join() === 'soul@4:perfect' && g.state !== 'dead', 'soul passes through blocks');
// the soul catches normal notes too, and the slingshot catches on the far side
g = mk((c) => c.hold(0.5, 3, 2).block(0, 4, 3, 4).tap(1, 4));
ev = run(g, [{ t: 0.4, kind: 'soul', down: true }, { t: 0.6, kind: 'dir', dir: 1, down: true }], 1.5);
ok(ev.some((e) => e.type === 'judge' && e.note.type === 'tap' && e.grade === 'perfect' && e.by === 'soul'), 'soul catches a normal note inside a block');
ok(g.stats.soulCatches === 1, 'soul catches are counted');
g = mk((c) => c.hold(0.5, 3, 2).tap(1, 4).tap(1.5, 1));
ev = run(g, [{ t: 0.4, kind: 'soul', down: true }, { t: 0.6, kind: 'dir', dir: 1, down: true }, { t: 1.364, kind: 'dir', dir: 1, down: false }], 2);
ok(judges(ev).filter((j) => j.startsWith('tap')).join() === 'tap@4:perfect,tap@1:perfect', 'slingshot: let go just before the beat to catch the other side');

// 11 hold ticks & body; leaving early
g = mk((c) => c.hold(1, 2, 2));
ev = run(g, [], 4);
ok(judges(ev).join() === 'hold@2:perfect,hold@2:perfect(body)', 'hold held all the way');
g = mk((c) => c.hold(1, 2, 2));
ev = run(g, [{ t: 1.5, kind: 'dir', dir: 1, down: true }], 4);
ok(judges(ev).join() === 'hold@2:perfect,hold@2:miss(body)', 'leaving a hold a quarter of the way in: ' + judges(ev).join());
ok(g.stats.combo === 0, 'missed ticks break combo');

// 12 late catch is good, early-then-leave is good
g = mk((c) => c.tap(1, 3));
ev = run(g, [{ t: 0.99, kind: 'dir', dir: 1, down: true }], 2);
ok(judges(ev).join() === 'tap@3:perfect', 'arriving 39 ms after pressing at t-10ms: perfect');
g = mk((c) => c.tap(1, 3));
ev = run(g, [{ t: 1.03, kind: 'dir', dir: 1, down: true }], 2);
ok(judges(ev).join() === 'tap@3:good', 'pressing 30 ms late: good');

// 13 whole levels: with no input you hit a block; with no-fail you reach the end
for (const lv of L.LEVELS) {
  g = new E.Game(lv);
  g.advance(300);
  ok(g.state === 'dead', `${lv.name}: no input runs into a block at ${g.t.toFixed(2)} s`);
  g = new E.Game(lv, { noFail: true });
  g.advance(300);
  ok(g.state === 'done' && g.stats.judged === g.units, `${lv.name}: no-fail reaches the end with every note judged`);
}

// 14 practice from a section skips earlier notes
const lv0 = L.LEVELS[0];
const sec = lv0.chart.texts.find((x) => x.title === 'SOUL');
g = new E.Game(lv0, { from: sec.t, noFail: true });
ok(g.t < sec.t && g.notes.every((n) => n.t >= sec.t || n.grade === 'skip'), 'practice skips notes before the section');
g.advance(300);
ok(g.stats.judged === g.units, 'practice run judges exactly the notes it kept');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
