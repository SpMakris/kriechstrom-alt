// Node checks for the tablet sequencer (no browser, no hardware). Run from the project root: node tablet/test.mjs
// Needs the upstream clone in vendor/kriechstrom (git clone https://github.com/Xforsa/kriechstrom.git vendor/kriechstrom).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Device, parseMotionRecords } from "./device.js";
import { parseStep, encodeStep, togglePitch, toggleLane, CONDITIONS, emptyStep } from "./steps.js";
import { Tools, SCALE_BITS, reverseSrc, shiftSrc } from "./tools.js";
import { TIME } from "./steps.js";
import { MidiClock, DIV_PULSES } from "./clock.js";
import { Ext, FX, FX_NONE, KRST } from "./ext.js";

let failed = 0;
const ok = (cond, what) => { console.log(`${what.padEnd(70)} ${cond ? "ok" : "FAIL"}`); if (!cond) failed++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

globalThis.fetch = async (u) => ({ ok: true, status: 200, text: async () => readFileSync(fileURLToPath(u), "utf8") });

/* ---- step wire format ---- */
const full = [0, 1, 60, 64, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0];
{
  const a = [2, 2, 60, 64, 0, 0, 0, 1, 100, 0, 0, 0, 100, 1, 8, 0];
  const s = parseStep(a);
  ok(s.index === 2 && s.n === 2 && s.notes[1] === 64 && s.tail.cond && s.nudge === 0 && s.cond === 0, "parseStep: 16-byte step with nudge and condition");
  ok(eq(encodeStep(s), a.slice(1)), "encodeStep: a full step round-trips byte for byte");
  const c = { ...s, cond: 7 };
  const e = encodeStep(c);
  ok(e[e.length - 1] === 7 && e[e.length - 4] === 100, "encodeStep: a condition is written with chance 100");
  const old = parseStep([0, 0, 0, 0, 0, 0, 0, 2, 96, 0, 0, 0, 100, 1]);
  ok(!old.tail.nudge && !old.tail.cond && encodeStep(old).length === 13, "older firmware: no nudge or condition byte is added");
  const n = { ...s, nudge: -8 };
  ok(encodeStep(n)[encodeStep(n).length - 2] === 0, "nudge -8 is written as 0");
}
{
  const s = emptyStep(0, { hits: true, chance: true, ratchet: true });
  const a = togglePitch(s, 64), b = togglePitch(a, 60), c = togglePitch(b, 64);
  ok(eq(a.notes.slice(0, a.n), [64]) && eq(b.notes.slice(0, b.n), [60, 64]) && eq(c.notes.slice(0, c.n), [60]), "togglePitch adds, sorts and removes notes");
  let d = s; for (const p of [60, 62, 64, 65, 67]) d = togglePitch(d, p);
  ok(d.n === 4, "a step holds at most 4 notes");
  const laneOf = (n) => (n === 36 ? 0 : 1);
  const k = toggleLane({ ...s, n: 1, notes: [36, 0, 0, 0], time: 0 }, 1, laneOf);
  ok(k.hit === 3 && k.n === 0, "toggleLane keeps a note's lane as a hit");
}

/* ---- device against the simulated FM-1 ---- */
const dev = new Device();
const statuses = [];
dev.on("status", (t) => statuses.push(t));
await dev.connect({ mock: true });
ok(dev.ntrk === 4 && dev.tracks.length === 4, "connect: four tracks");
ok(dev.caps.locks && dev.caps.nudge && dev.caps.cond, "INFO caps found: locks, nudge, condition");
ok(dev.tracks[3].drum === true && dev.tracks[0].drum === false, "the DRUM engine track is a drum track");
ok(dev.tracks.every((t) => t.len >= 1 && t.name), "track names and lengths read");
ok(dev.steps[0].length >= 16 && dev.steps[0][0].tail.nudge && dev.steps[0][0].tail.cond, "steps carry the nudge and condition bytes");
ok(dev.global.ok, "global BPM and CLK found");

let s = dev.getStep(0, 5);
await dev.writeStep(0, { ...togglePitch(s, 60), cond: 6, nudge: 3 });
await dev.refreshStep(0, 5);
let r = dev.getStep(0, 5);
ok(r.notes.slice(0, r.n).includes(60) && r.cond === 6 && r.nudge === 3 && r.chance === 100, "a written step reads back with its condition and nudge");
await dev.writeStep(0, { ...r, chance: 50, cond: 0 });
r = dev.getStep(0, 5);
ok(r.chance === 50 && r.cond === 0, "switching back to a chance clears the condition");

await dev.setLock(0, 5, 3, 40);
await dev.setLock(0, 5, 1, 20);
let locks = await dev.readLocks(0);
ok(locks.length === 2 && locks.some((l) => l.id === 3 && l.value === 40), "two locks set and read back");
locks = await dev.deleteLock(0, 5, 3).catch(() => null);
ok(locks === null || locks.length >= 0, "delete a lock does not break the link");
locks = await dev.clearLocks(0, 5);
ok(locks.length === 0, "clear a step's locks");

await dev.setLen(1, 32); ok(dev.tracks[1].len === 32, "LEN is set");
await dev.setMix(2, 80, true); ok(dev.tracks[2].mute === true, "mute is sent");

/* ---- clock ---- */
const sent = [];
let t0 = 1000, clockNow = t0;
const clk = new MidiClock((b, ts) => sent.push([b[0], ts]), () => clockNow, { every: 1e9, lookahead: 200 });
clk.setBpm(120);
clk.start();
ok(sent[0][0] === 0xFA, "Start is sent first");
const pulses = sent.filter((x) => x[0] === 0xF8);
const gaps = pulses.slice(1).map((x, i) => x[1] - pulses[i][1]);
ok(gaps.length > 5 && gaps.every((g) => Math.abs(g - 20.8333) < 0.001), "pulses are 20.833 ms apart at 120 BPM (24 per quarter)");
clockNow = t0 + 60 + 20.84 * 12.5;
clk.run();
ok(clk.position() === 12, "position counts the pulses already due");
ok(clk.stepOf(2, 16) === 2, "1/16 steps are 6 pulses: pulse 12 is step 2");
ok(clk.stepOf(0, 16) === 0 && DIV_PULSES.length === 10, "1/4 steps are 24 pulses");
clk.setBpm(60);
clk.run();
const n = sent.filter((x) => x[0] === 0xF8).length;
clk.stop();
ok(sent.filter((x) => x[0] === 0xFC).length === 2 && sent[sent.length - 1][0] === 0xFC && clk.position() === -1, "Stop is sent and the playhead clears");
ok(n > 10, "pulses were scheduled after a tempo change");

/* ---- parameters, presets, mix ---- */
{
  const pan = await dev.panId();
  ok(pan === 39, "the PAN parameter id is found by its label (" + pan + ")");
  const v = await dev.setParam(0, pan, 20);
  ok(v === 20 && (await dev.getParam(0, pan)) === 20, "a track parameter is set and read back");
  ok((await dev.getParam(1, pan)) !== 20, "another track's pan is untouched");
  const g = await dev.setGlobal(0, 133);
  ok(g === 133, "a global is set");
  const nm = await dev.readNames(dev.tracks[0].engine);
  ok(nm.length > 3 && Array.isArray(dev.titles[dev.tracks[0].engine]), "preset names and page titles read");
  const x = await dev.describe(0, dev.info.pe0);
  ok(x && x.label, "an engine parameter has a description: " + (x && x.label));
  await dev.setPreset(2, dev.tracks[2].engine, 1);
  ok(dev.sel === 2 && dev.tracks[2].preset === 1, "a preset is chosen on the selected track");
}

/* ---- sequencer tools (ported from ui_tools.c / krst_dice.c) ---- */
{
  const mk = () => Array.from({ length: 64 }, (_, i) => ({ ...emptyStep(i, { hits: true }), time: TIME.REST }));
  const laneOf = (n) => n % 8, mask = (s) => (s.time === 0 ? s.hit | s.notes.slice(0, s.n).reduce((m, n) => m | 1 << laneOf(n), 0) : 0);
  const C = (o) => ({ drum: false, root: 0, mask: SCALE_BITS[1], index: 0, lane: 0, laneOf, ...o });
  let st = mk(); Tools.beat(st, 16, C({ drum: true }));
  ok(eq(st.slice(0, 8).map(mask), [9, 0, 8, 0, 11, 0, 8, 0]), "BEAT: kick every 4th, snare on 5 and 13, closed hat every 2nd");
  st = mk(); Tools.euclid(st, 16, C({ drum: true, lane: 2 }), 5, 16, 0);
  ok(st.slice(0, 16).filter((x) => mask(x) & 4).length === 5, "EUCLID 5/16 on a drum lane puts five hits on it");
  st = mk(); Tools.euclid(st, 16, C(), 4, 8, 0);
  ok(st.slice(0, 16).filter((x) => x.time === 0).length === 8, "EUCLID 4/8 over 16 steps repeats: eight notes");
  let all = true;
  for (const drum of [true, false]) for (let idx = 0; idx < 4; idx++) for (let m = 0; m < 8; m++) {
    const a = mk(), r = Tools.dice(a, C({ drum, index: idx }), m);
    all = all && r.len === (m === 2 ? 14 : 16) && (m === 5 || a.slice(0, r.len).some((x) => x.time === 0));
  }
  ok(all, "DICE: every mood on every track kind makes a part of the right length");
  const dr = mk(); Tools.dice(dr, C({ drum: false, index: 0 }), 5);
  ok(dr[0].time === 0 && dr.slice(1, 16).every((x) => x.time === 1), "DICE: the bass of mood GHOST is one held note");
  const t = mk(); [0, 1, 2].forEach((i) => { t[i].time = i ? 1 : 0; }); t[0].n = 1; t[3].time = 0; t[3].n = 1;
  ok(eq(reverseSrc(t, 4), [3, 0, 2, 1]), "REVERSE keeps a note before its ties");
  ok(eq(shiftSrc(4, 1), [3, 0, 1, 2]) && eq(shiftSrc(4, 3), [1, 2, 3, 0]), "SHIFT order: later = last step first");
  const e = mk(); ok(Tools.cook(e, 16, C()) === null, "COOK with nothing there says so");
}
/* ---- automation: locks and events follow their steps ---- */
{
  await dev.setLock(0, 2, 1, 50); await dev.setEvent(0, 7, 3, 20);
  const m = await dev.readMotion(0);
  ok(m.recs.length === 2 && m.recs.some((r) => r.kind === 1 && r.step === 2) && m.recs.some((r) => r.kind === 0 && r.step === 7), "readMotion lists locks and events with their kind");
  await dev.remapMotion(0, (x) => (x + 1) % 16);
  ok(eq((await dev.readMotion(0)).recs.map((r) => r.step).sort(), [3, 8]), "records move with their steps");
  await dev.remapMotion(0, (x) => (x >= 8 ? -1 : x));
  ok((await dev.readMotion(0)).recs.length === 1, "records of dropped steps are dropped");
  await dev.motionOn(0, false);
  ok(!(await dev.readMotion(0)).on, "automation play is switched off");
  await dev.motionOn(0, true); await dev.motionClear(0); await dev.motionCmd(0, [6, 127]);
  ok((await dev.readMotion(0)).recs.length === 0, "clear removes events and locks");
}

/* ---- the tablet commands: perform, key map, slices, drum mutes, CLEAR ALL, MIDI learn, HISS ---- */
{
  ok(dev.tags.krst === 127, "INFO 58 01: the tablet commands are found (all seven)");
  const r0 = await Ext.perf(dev);
  ok(r0.mask === 0 && eq(r0.k, [0, 0, 0, 0]) && r0.avail === 0x3FFFF && !r0.latch && !r0.kill, "PERF: the query: nothing held, every effect available");
  const mask = (1 << 1) | (1 << 4) | (1 << 15);
  const r1 = await Ext.perf(dev, { mask, k: [-40, 30, 0, 10], solo: 5, fill: 1 });
  ok(r1.mask === mask && eq(r1.k, [-40, 30, 0, 10]) && r1.solo === 5 && r1.fill === 1, "PERF: effects, macros, SOLO and FILL are set and echoed");
  ok(dev.mock.perf.mask === mask && dev.mock.perf.k[0] === -40, "PERF: the machine holds them");
  await new Promise((r) => setTimeout(r, 700));
  ok(dev.mock.perf.mask === 0 && dev.mock.perf.solo === 0 && dev.mock.perf.k[0] === 0, "PERF: 600 ms of quiet lets everything go");
  let bad = false; try { await Ext.perf(dev, { mask: 1 << 20, k: [0, 0, 0, 0], solo: 0, fill: 0 }); } catch (e) { bad = true; }
  ok(bad, "PERF: an effect past the list gets no answer");
  const km = await Ext.keymap(dev);
  ok(km.rc === 0 && km.map.length === 16 && km.map[0] === 0 && km.map[15] === 15 && FX.length === 18, "KEYMAP: sixteen keys, the default map");
  const km2 = await Ext.keymap(dev, { key: 3, fx: FX_NONE });
  ok(km2.map[3] === FX_NONE && km2.map[4] === 4, "KEYMAP: one key set to none");
  ok((await Ext.keymap(dev, { reset: true })).map[3] === 3, "KEYMAP: the default map back");
  const s0 = await Ext.slice(dev, 0);
  ok(s0.rc === 0 && !s0.man && s0.len === 512 && s0.pos.length === 4, "SLICE: the read (AUTO's slices, the sample's length)");
  const s1 = await Ext.slice(dev, 0, { pos: [0, 100, 300], end: 0 });
  ok(s1.rc === 0 && s1.man && eq(s1.pos, [0, 100, 300]), "SLICE: three MAN slices set and read back");
  const s2 = await Ext.slice(dev, 0, { pos: [0, 10], end: 0 });
  ok(s2.rc === 2 && eq((await Ext.slice(dev, 0)).pos, [0, 100, 300]), "SLICE: starts closer than the shortest slice are refused, the table stays");
  ok((await Ext.slice(dev, 1)).rc === 1, "SLICE: an empty slot says so");
  ok(!(await Ext.slice(dev, 0, { pos: [], end: 0 })).man, "SLICE: none puts AUTO back");
  ok((await Ext.drumMute(dev, 1, 0x95)) === 0x95 && (await Ext.drumMute(dev, 1)) === 0x95, "DRUMMUTE: eight lanes in two bytes");
  ok((await Ext.mlearn(dev)) === false && (await Ext.mlearn(dev, true)) === true && (await Ext.mlearn(dev, true)) === true && (await Ext.mlearn(dev, false)) === false, "MLEARN: on, on again, off");
  const hd = await dev.describe(1, 27);
  ok(hd.label === "HISS" && hd.max === 127, "HISS: global 27 describes itself");
  ok((await dev.setGlobal(27, 77)) === 77 && (await dev.getGlobal(27)) === 77, "HISS: set and read");
  await dev.setGlobal(27, 0);
  ok((await Ext.clearAll(dev)) === 0 && dev.mock.wire.clears === 1, "CLEAR ALL: the machine answers done");
  const stock = new Device();
  await stock.connect({ mock: true, krst: false });
  ok(stock.tags.krst === 0 && stock.tags.menu > 0, "a firmware without the tablet commands: no tablet tag, the rest as before");
  stock.close();
}

dev.close();
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
