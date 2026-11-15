// The FM-1 session: connect, read four tracks, write steps, keep in sync.
// Wire work is the upstream protocol layer (see proto.js); this file is only the tablet's use of it.

import { loadProtocol } from "./proto.js";
import { tags } from "./ext.js";
import { makeMock } from "./mock.js";
import { parseStep, encodeStep, emptyStep } from "./steps.js";

const NTRK = 4;
const PID = { LEVEL: 0, LEN: 29, DIV: 30, SWG: 31, GATE: 32 };       /* track parameter ids (core.h P_*; checked against DESC labels) */
const GID = { BPM: 0, CLK: 2 };                                      /* global ids (G_*) */
const KIT_ENGINES = new Set(["DRUM"]);
const PORT_RE = /felucca|kriechstrom|clipper|sloop|fm-1/i;

export class Device {
  constructor() {
    this.A = null; this.link = null; this.mock = null; this.output = null; this.input = null;
    this.info = null; this.caps = {}; this.tracks = []; this.steps = []; this.names = {};
    this.sel = 0; this.listeners = {}; this.timers = []; this.closed = false; this.pollRR = 0;
    this.global = { bpm: 120, clk: 0, clkNames: [], ok: false };
  }
  on(name, fn) { (this.listeners[name] ||= []).push(fn); return this; }
  emit(name, ...args) { for (const fn of this.listeners[name] || []) fn(...args); }
  say(text, kind = "info") { this.emit("status", text, kind); }

  async connect({ mock = false, krst = true } = {}) {
    this.say("Connecting");
    const A = this.A = await loadProtocol();
    let access;
    if (mock) { this.mock = makeMock(A, { krst }); access = this.mock.access; }
    else {
      if (!navigator.requestMIDIAccess) throw new Error(window.isSecureContext
        ? "This browser has no WebMIDI. Use Chrome or Edge."
        : "MIDI is only available on a secure page: https, or localhost. This page was opened over plain http from another address.");
      try { access = await navigator.requestMIDIAccess({ sysex: true }); }
      catch (e) { throw new Error("MIDI access with SysEx was refused."); }
    }
    this.access = access;
    const isF = (p) => PORT_RE.test(p.name || "") && p.state !== "disconnected";
    this.input = [...access.inputs.values()].find(isF);
    this.output = [...access.outputs.values()].find(isF);
    if (!this.input || !this.output) throw new Error("No FM-1 found. Connect it by USB.");
    access.onstatechange = (e) => {
      const p = e.port;
      if (p && PORT_RE.test(p.name || "") && p.state === "disconnected") { this.say("The FM-1 was disconnected", "error"); this.close(); this.emit("lost"); }
    };
    this.link = new A.Link((d) => this.output.send(d), {
      timeout: 300,
      onPush: (f) => this.onPush(f),
      onTimeout: () => this.say("The FM-1 is not answering", "error"),
    });
    this.input.onmidimessage = (e) => this.link.receive(e.data);
    if (this.input.open) await this.input.open().catch(() => {});
    await this.load();
  }

  rq(r, opt) { return this.link.request(r, opt); }

  async load() {
    const { A } = this, { CMD, req, parse } = A;
    this.say("Reading the machine");
    const raw = await this.rq(req.info(), { timeout: 500, retries: 3 });
    this.info = parse[CMD.INFO](raw);
    this.caps = scanCaps(raw, this.info);
    this.tags = tags(this.caps.trailer);
    this.ntrk = Math.min(NTRK, this.info.ntrk || 1);
    const tr = parse[CMD.TRACK](await this.rq(req.track()));
    this.sel = tr.sel;
    this.tracks = [];
    this.steps = Array.from({ length: NTRK }, () => []);
    for (let t = 0; t < this.ntrk; t++) {
      const x = tr.tracks[t];
      this.tracks[t] = { engine: x.engine, preset: x.preset, level: x.level, mute: !!x.mute, armed: !!x.armed,
        engineName: this.info.engines[x.engine] ?? "", drum: KIT_ENGINES.has(this.info.engines[x.engine]),
        name: "", len: 16, div: 2, swing: 0, gate: 64, qntz: null, loaded: 0 };
    }
    await this.readDescs();
    for (let t = 0; t < this.ntrk; t++) { await this.readTrackParams(t); await this.readName(t); }
    await this.readGlobal();
    const w = await this.rq(req.watch(3));
    this.watch = w[0];
    this.timers.push(setInterval(() => { if (this.link && this.link.idle) this.link.request(req.ping(), { quiet: true, retries: 0 }).catch(() => {}); }, 1000));
    this.timers.push(setInterval(() => this.poll(), 700));
    this.emit("tracks");
    for (let t = 0; t < this.ntrk; t++) await this.loadSteps(t, 0, 16);
    this.say("Ready");
    this.emit("ready");
    for (let t = 0; t < this.ntrk; t++) this.loadSteps(t, 16, 64).catch(() => {});
  }

  async readDescs() {
    const { CMD, req, parse } = this.A;
    this.desc = {};
    for (const [key, id] of Object.entries(PID)) {
      try { this.desc[key] = parse[CMD.DESC](await this.rq(req.desc(0, id))); } catch (e) { this.desc[key] = null; }
    }
    const lab = (d) => (d ? d.label : "");
    this.paramsOk = lab(this.desc.LEN) === "LEN" && lab(this.desc.DIV) === "DIV";
    this.qntzId = null;
    for (let id = 88; id < Math.min(this.info.pcount, 110); id++) {
      try { const d = parse[CMD.DESC](await this.rq(req.desc(0, id))); if (/^QNT/.test(d.label)) { this.qntzId = id; break; } } catch (e) { /* skip */ }
    }
  }

  async readTrackParams(t) {
    const { CMD, req, parse } = this.A, tr = this.tracks[t];
    if (!this.paramsOk) return;
    const get = async (id) => parse[CMD.TRACK_PARAM](await this.rq(req.trackParam(t, id))).value;
    tr.len = await get(PID.LEN); tr.div = await get(PID.DIV); tr.swing = await get(PID.SWG); tr.gate = await get(PID.GATE);
    if (this.qntzId != null) tr.qntz = await get(this.qntzId);
  }

  async readName(t) {
    const { CMD, req, parse } = this.A, tr = this.tracks[t];
    if (!this.names[tr.engine]) {
      try { this.names[tr.engine] = parse[CMD.NAMES](await this.rq(req.names(tr.engine))).names; } catch (e) { this.names[tr.engine] = []; }
    }
    tr.name = this.names[tr.engine][tr.preset] || tr.engineName || "Track " + (t + 1);
  }

  async readGlobal() {
    const { CMD, req, parse } = this.A, g = this.global;
    try {
      const b = parse[CMD.DESC](await this.rq(req.desc(1, GID.BPM))), c = parse[CMD.DESC](await this.rq(req.desc(1, GID.CLK)));
      g.ok = b.label === "BPM" && c.label === "CLK" && c.names.includes("USB");
      g.clkNames = c.names;
      if (g.ok) {
        g.bpm = parse[CMD.GET](await this.rq(req.get(1, GID.BPM))).value;
        g.clk = parse[CMD.GET](await this.rq(req.get(1, GID.CLK))).value;
      }
    } catch (e) { g.ok = false; }
  }

  async setClockSource(v) {
    const { CMD, req, parse } = this.A;
    const r = parse[CMD.SET](await this.rq(req.set(1, GID.CLK, v)));
    this.global.clk = r.value;
    return r.value;
  }

  /* any parameter of any track (TRACK_PARAM), a global (GET/SET scope 1), descriptions, names, presets */
  async describe(scope, id) {
    const k = scope + ":" + id, { CMD, req, parse } = this.A;
    this.descCache ||= {};
    if (!(k in this.descCache)) { try { this.descCache[k] = parse[CMD.DESC](await this.rq(req.desc(scope, id))); } catch (e) { this.descCache[k] = null; } }
    return this.descCache[k];
  }
  async getParam(t, id) { const { CMD, req, parse } = this.A; return parse[CMD.TRACK_PARAM](await this.rq(req.trackParam(t, id))).value; }
  async setParam(t, id, v) {
    const { CMD, req, parse } = this.A;
    return parse[CMD.TRACK_PARAM](await this.rq(req.trackParam(t, id, v), { key: `tp${t}:${id}` })).value;
  }
  async getGlobal(id) { const { CMD, req, parse } = this.A; return parse[CMD.GET](await this.rq(req.get(1, id))).value; }
  async setGlobal(id, v) { const { CMD, req, parse } = this.A; return parse[CMD.SET](await this.rq(req.set(1, id, v), { key: `g:${id}` })).value; }
  async panId() {
    if (this.pan === undefined) {
      this.pan = null;
      for (let id = 30; id < Math.min(this.info.pe0 || 60, 60); id++) { const x = await this.describe(0, id); if (x && x.label === "PAN") { this.pan = id; break; } }
    }
    return this.pan;
  }
  async readNames(e) {
    const { CMD, req, parse } = this.A;
    this.titles ||= {};
    if (!this.names[e] || !(e in this.titles)) {
      try { const r = parse[CMD.NAMES](await this.rq(req.names(e))); this.names[e] = r.names; this.titles[e] = r.titles; } catch (x) { this.names[e] ||= []; this.titles[e] = []; }
    }
    return this.names[e];
  }
  async selectTrack(t) {
    if (this.sel === t) return;
    const { CMD, req, parse } = this.A;
    const r = parse[CMD.TRACK](await this.rq(req.track(t)));
    this.sel = r.sel;
  }
  async setPreset(t, e, p) {
    const { CMD, req, parse } = this.A;
    await this.selectTrack(t);
    const r = parse[CMD.PRESET](await this.rq(req.preset(e, p)));
    const tr = this.tracks[t];
    tr.engine = r.engine; tr.preset = r.preset; tr.engineName = this.info.engines[r.engine] ?? ""; tr.drum = KIT_ENGINES.has(tr.engineName);
    await this.readName(t); await this.readTrackParams(t);
    this.emit("tracks");
  }

  /* FM6 patches (INFO's fm6 tag): a track's own patch, the factory ones. v: the 155-byte voice */
  get hasFm6() { return !!(this.info && this.info.fm6); }
  async fm6Read(target, index) {
    const { CMD, req, parse, FM6 } = this.A;
    const r = parse[CMD.FM6_GET](await this.rq(req.fm6Get(target, index)));
    if (r.rc) throw new Error("The machine refused the patch (code " + r.rc + ")");
    return FM6.unpack(r.packed);
  }
  async fm6Write(t, v) {
    const { CMD, req, parse, FM6 } = this.A;
    const r = parse[CMD.FM6_PUT](await this.rq(req.fm6Put(FM6.TARGET.TRACK, t, FM6.pack(v))));
    if (r.rc) throw new Error("The machine refused the patch (code " + r.rc + ")");
  }
  async fm6Names() {
    const { CMD, req, parse } = this.A;
    return parse[CMD.FM6_LIST](await this.rq(req.fm6List()));
  }

  async loadSteps(t, from, to) {
    const { CMD, req } = this.A, tr = this.tracks[t], { tail } = this.stepTail();
    const end = Math.min(this.info.nstep || 64, to);
    for (let i = from; i < end; i++) {
      if (this.closed) return;
      const s = parseStep(await this.rq([CMD.TRACK_STEP, [t, i]]), true);
      this.steps[t][i] = s;
      this.stepShape = s.tail;
    }
    tr.loaded = Math.max(tr.loaded, end);
    this.emit("steps", t);
  }
  stepTail() { return { tail: this.stepShape || {} }; }

  getStep(t, i) { return this.steps[t][i] || emptyStep(i, this.stepShape || {}); }

  /* write a whole step: shown at once, sent keyed so a fast sequence of edits to one step collapses to the last */
  writeStep(t, s) {
    const { CMD } = this.A;
    this.steps[t][s.index] = s;
    this.emit("steps", t, s.index);
    return this.rq([CMD.TRACK_STEP, [t, s.index, ...encodeStep(s)]], { key: `s${t}:${s.index}` })
      .then((a) => { if (!this.link.hasQueued(`s${t}:${s.index}`)) { this.steps[t][s.index] = parseStep(a, true); this.emit("steps", t, s.index); } })
      .catch((e) => { if (e.message !== "closed") this.say("A step did not reach the machine: " + e.message, "error"); });
  }

  async refreshStep(t, i) {
    const { CMD } = this.A;
    this.steps[t][i] = parseStep(await this.rq([CMD.TRACK_STEP, [t, i]]), true);
    this.emit("steps", t, i);
  }

  async setMix(t, level, mute) {
    const { CMD, req, parse } = this.A, tr = this.tracks[t];
    tr.level = level; tr.mute = mute;
    this.emit("tracks");
    try { await this.rq(req.trackMix(t, level, mute), { key: "mix" + t }); } catch (e) { if (e.message !== "closed") this.say("Level not sent: " + e.message, "error"); }
  }

  async setTrackParam(t, key, id, v) {
    const { req } = this.A;
    this.tracks[t][key] = v;
    this.emit("tracks");
    try { await this.rq(req.trackParam(t, id, v), { key: `p${t}:${id}` }); } catch (e) { if (e.message !== "closed") this.say("Not sent: " + e.message, "error"); }
  }
  setLen(t, v) { return this.setTrackParam(t, "len", PID.LEN, Math.max(1, Math.min(64, v))); }
  setDiv(t, v) { return this.setTrackParam(t, "div", PID.DIV, v); }
  setSwing(t, v) { return this.setTrackParam(t, "swing", PID.SWG, v); }
  setGate(t, v) { return this.setTrackParam(t, "gate", PID.GATE, v); }
  setQntz(t, v) { return this.qntzId == null ? null : this.setTrackParam(t, "qntz", this.qntzId, v); }

  /* ---- parameter locks (MOTION ops 5..8) ---- */
  async readLocks(t) {
    if (!this.caps.locks) return [];
    const { CMD } = this.A;
    const a = await this.rq([CMD.MOTION, [t, this.caps.motion128 ? 8 : 7]], { retries: 0 });
    return parseMotionRecords(a, this.caps.motion128).filter((r) => r.kind === 1);
  }
  async setLock(t, step, id, value) {
    const { CMD, v14enc } = { ...this.A, v14enc: this.A.v14enc };
    const a = await this.rq([CMD.MOTION, [t, 5, step & 63, id & 127, ...v14enc(value)]], { retries: 0 });
    if (a[1] !== 0) throw new Error(a[1] === 2 ? "All lock and automation records are in use" : "That value or parameter cannot be locked");
    return parseMotionRecords(a, false).filter((r) => r.kind === 1);
  }
  async clearLocks(t, step) {
    const { CMD } = this.A;
    const a = await this.rq([CMD.MOTION, [t, 6, step & 127]], { retries: 0 });
    return parseMotionRecords(a, false).filter((r) => r.kind === 1);
  }
  async deleteLock(t, step, id) {
    const { CMD } = this.A;
    await this.rq([CMD.MOTION, [t, 4, step & 63, id & 127]], { retries: 0 });
    return this.readLocks(t);
  }

  /* ---- automation (MOTION): every record of a track, locks (kind 1) and automation events (kind 0) ---- */
  async readMotion(t) {
    const { CMD } = this.A, op = this.caps.locks ? (this.caps.motion128 ? 8 : 7) : 0;
    const a = await this.rq([CMD.MOTION, op ? [t, op] : [t]], { retries: 0 });
    if (a[1] !== 0) throw new Error("The machine refused the automation request");
    const wide = op === 8;
    return { on: !!a[2], max: wide ? a[5] | a[6] << 7 : a[4], recs: parseMotionRecords(a, wide) };
  }
  async motionCmd(t, args, what = "automation") {
    const a = await this.rq([this.A.CMD.MOTION, [t, ...args]], { retries: 0 });
    if (a[1] !== 0) throw new Error(a[1] === 2 ? "All lock and automation records are in use" : "The machine refused that " + what + " change");
    return a;
  }
  motionOn(t, on) { return this.motionCmd(t, [1, on ? 1 : 0]); }
  motionClear(t) { return this.motionCmd(t, [2]); }
  setEvent(t, step, id, value) { return this.motionCmd(t, [3, step & 63, id & 127, ...this.A.v14enc(value)]); }
  deleteRecord(t, step, id) { return this.motionCmd(t, [4, step & 63, id & 127]); }
  /* records move with their steps: map(step) = the new step, or -1 to drop the record; copy(step) = an extra copy at that step or -1 */
  async remapMotion(t, map, copy) {
    const m = await this.readMotion(t);
    if (!m.recs.length) return 0;
    const out = [];
    for (const r of m.recs) { const s = map(r.step); if (s >= 0) out.push({ ...r, step: s }); const c = copy ? copy(r.step) : -1; if (c >= 0) out.push({ ...r, step: c }); }
    if (out.length > m.max) throw new Error("Automation full");
    await this.motionClear(t);
    if (this.caps.locks) await this.motionCmd(t, [6, 127]);
    for (const r of out) { if (r.kind === 1) await this.setLock(t, r.step, r.id, r.value); else await this.setEvent(t, r.step, r.id, r.value); }
    if (m.on) await this.motionOn(t, true);
    return out.length;
  }
  async roomFor(t, extra) { const m = await this.readMotion(t); return m.recs.length + extra <= m.max; }

  /* ---- live sync ---- */
  onPush(f) {
    const { CMD, parse } = this.A;
    try {
      if (f.cmd === CMD.STEP_CHANGED) { const r = parse[CMD.STEP_CHANGED](f.a); this.refreshStep(r.track ?? this.sel, r.index).catch(() => {}); }
      else if (f.cmd === CMD.RELOAD) { this.reloading = true; setTimeout(() => this.reload(), 50); }
      else if (f.cmd === CMD.TRACK_CHANGED || f.cmd === CMD.CHANGED) this.onChanged(f);
    } catch (e) { /* a malformed push is dropped */ }
  }
  onChanged(f) {
    const { CMD, parse } = this.A;
    if (f.cmd === CMD.CHANGED) {
      const r = parse[CMD.CHANGED](f.a);
      if (r.scope === 1 && r.id === GID.BPM) { this.global.bpm = r.value; this.emit("global"); }
      if (r.scope === 1 && r.id === GID.CLK) { this.global.clk = r.value; this.emit("global"); }
      if (r.scope === 0) this.applyParam(this.sel, r.id, r.value);
    } else {
      const r = parse[CMD.TRACK_CHANGED](f.a);
      this.applyParam(r.track, r.id, r.value);
    }
  }
  applyParam(t, id, v) {
    const tr = this.tracks[t];
    if (!tr) return;
    if (id === PID.LEN) tr.len = v; else if (id === PID.DIV) tr.div = v; else if (id === PID.SWG) tr.swing = v;
    else if (id === PID.GATE) tr.gate = v; else if (id === this.qntzId) tr.qntz = v; else return;
    this.emit("tracks");
  }
  async reload() {
    try { for (let t = 0; t < this.ntrk; t++) { await this.readTrackParams(t); await this.readName(t); } this.emit("tracks"); for (let t = 0; t < this.ntrk; t++) await this.loadSteps(t, 0, Math.max(16, this.tracks[t].loaded)); }
    catch (e) { /* closed */ }
    this.reloading = false;
  }
  /* STEP_CHANGED is pushed for the selected track only: re-read the others' visible steps now and then */
  async poll() {
    if (this.closed || !this.link || !this.link.idle || this.reloading || !this.polled) return;
    const t = this.pollRR++ % this.ntrk;
    if (t === this.sel) return;
    const { page = 0 } = this.polled(t) || {};
    try { for (let i = page * 16; i < page * 16 + 16 && i < this.tracks[t].len; i++) { if (!this.link.idle && i > page * 16) return; await this.refreshStep(t, i); } } catch (e) { /* closed */ }
  }

  close() {
    this.closed = true;
    for (const id of this.timers) clearInterval(id);
    this.timers = [];
    if (this.link) this.link.close();
    if (this.input) this.input.onmidimessage = null;
  }
}

/* find the optional feature tags in the INFO trailer (after the engine names and the track count) */
export function scanCaps(a, info) {
  let i = 0;
  while (a[i] !== 0) i++;                      /* version string */
  i += 1 + 5;                                  /* NUL, then engines, pcount, gcount, nstep, pe0 */
  for (let e = 0; e < info.nengines; e++) { while (a[i] !== 0) i++; i++; }
  i++;                                         /* ntrk */
  const tr = a.slice(i), has = (...seq) => tr.some((_, k) => seq.every((b, j) => tr[k + j] === b));
  return { locks: has(0x4C, 1, 1), nudge: has(0x54, 1, 0x10), cond: has(0x4B, 1, 0x0B), motion128: has(0x41, 1, 0, 1), trailer: tr };
}

/* MOTION reply: track, rc, on, count, max, count x (step, id, v14), then count kind bytes (ops 5..8);
   op 8: count and max are two 7-bit bytes each */
export function parseMotionRecords(a, wide) {
  let i = 3;
  const count = wide ? a[i] | a[i + 1] << 7 : a[i];
  i += wide ? 4 : 2;
  const recs = [];
  for (let k = 0; k < count; k++) { recs.push({ step: a[i], id: a[i + 1], value: (a[i + 2] | a[i + 3] << 7) - 8192, kind: 0 }); i += 4; }
  for (let k = 0; k < count && i < a.length; k++) recs[k].kind = a[i++];
  return recs;
}
