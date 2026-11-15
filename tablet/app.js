// FM-1 jam board: four tracks on screen, one in hand. See .impeccable/surfaces/tablet-index-html.md for the brief.

import { SongScreen } from "./song.js";
import { LibraryScreen } from "./library.js";
import { SettingsScreen } from "./settings.js";
import { Device } from "./device.js";
import { MidiClock } from "./clock.js";
import { el, ic } from "./ui.js";
import { MixScreen } from "./mix.js";
import { SoundScreen } from "./sound.js";
import { CONDITIONS, TIME, FLAG, togglePitch, toggleLane, stepLaneMask, emptyStep } from "./steps.js";
import { Tools, MOODS, SCALE_BITS, reverseSrc, shiftSrc } from "./tools.js";

const $ = (s, r = document) => r.querySelector(s);
const QS = new URLSearchParams(location.search);
const PAGE = 16;

/* ------------------------------------------------------------ state --- */
const S = {
  dev: null, clock: null, hand: 0, page: [0, 0, 0, 0], octave: [3, 3, 3, 3],   /* octave: the lowest C of the pitch roll */
  sel: null, drawer: false, tab: "step", more: false,
  brush: [{ note: 60, lane: 0 }, { note: 60, lane: 0 }, { note: 60, lane: 0 }, { note: 60, lane: 0 }],
  locks: [], lockDesc: {}, lockable: null, prevClk: null, clockOn: false, undo: null, armClear: false, wake: null, status: { text: "", kind: "info" },
  euclid: 4, sub: { step: "play", track: "len" }, lockPage: 0,
};
const root = $("#app");
let barEl, boardEl, rowsEl, drawerEl;
const screens = {};
const SCREENS = [["jam", "Jam"], ["mix", "Mix"], ["sound", "Sound"], ["song", "Song"], ["library", "Library"], ["settings", "Settings"]];

/* ------------------------------------------------------------ helpers --- */
const dev = () => S.dev;
const trk = (t) => S.dev.tracks[t];
const pagesOf = (t) => Math.max(1, Math.ceil(trk(t).len / PAGE));
const clampPage = (t) => { S.page[t] = Math.max(0, Math.min(pagesOf(t) - 1, S.page[t])); };
const laneOf = (n) => dev().A.drumLane(n);
const LANE_NAMES = ["KICK", "SNARE", "CLAP", "HAT CL", "HAT OP", "TOM", "RIM", "BELL"];
const noteName = (n) => dev().A.noteName(n);
const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);

function say(text, kind = "info") { S.status = { text, kind }; const s = $(".status"); if (s) { s.textContent = text; s.className = "status" + (kind === "error" ? " error" : ""); } }

function medianNote(t) {
  const ns = dev().steps[t].flatMap((s) => (s && s.time === TIME.NOTE ? s.notes.slice(0, s.n) : [])).sort((a, b) => a - b);
  return ns.length ? ns[Math.floor(ns.length / 2)] : 60;
}

/* ------------------------------------------------------------ connect screen --- */
function renderGate(msg) {
  barEl = boardEl = rowsEl = drawerEl = null;
  root.replaceChildren(
    el("header", { class: "bar" }, el("span", { class: "brand", text: "KRIECHSTROM" })),
    el("main", { class: "gate" },
      el("h1", { text: "Jam board" }),
      el("p", { text: "Connect the FM-1 by USB. This screen runs the clock, shows all four tracks and opens one up when you tap it." }),
      msg ? el("p", { class: "status error", text: msg }) : null,
      el("div", { class: "row" },
        el("button", { class: "btn red", onclick: () => start(false), text: "Connect FM-1" }),
        el("button", { class: "btn", onclick: () => start(true), text: "Try the simulated machine" })),
      el("p", { class: "hint", text: "Needs Chrome or Edge with MIDI access. Tablet clock sets the machine's clock source to USB." })));
}

async function start(mock) {
  const d = new Device();
  S.dev = d;
  d.on("status", (t, k) => say(t, k));
  d.on("tracks", () => { if (!rowsEl) return; if (S.screen === "mix" && !S.drag) screens.mix.refresh(); if (S.drag) { S.dirty = true; return; } renderRows(); if (S.drawer) renderDrawer(); renderBar(); });
  d.on("steps", (t, i) => { if (!rowsEl) return; updateCells(t, i); if (S.drawer && !S.drag && S.sel && S.sel.t === t && (i == null || i === S.sel.i)) renderDrawer(); });
  d.on("global", () => { if (barEl && !S.drag) renderBar(); });
  d.on("lost", () => { stopClock(); S.dev = null; S.clockOn = false; S.screen = "jam"; renderGate("The FM-1 was disconnected."); });
  d.polled = (t) => ({ page: S.page[t] });
  try { await d.connect({ mock }); } catch (e) { d.close(); S.dev = null; console.error(e); renderGate(e.message); return; }
  S.hand = Math.min(S.hand, d.ntrk - 1);
  for (let t = 0; t < d.ntrk; t++) S.octave[t] = Math.max(0, Math.floor(medianNote(t) / 12) - 0);
  buildShell();
}

/* ------------------------------------------------------------ shell --- */
function buildShell() {
  barEl = el("header", { class: "bar" });
  rowsEl = el("div", { class: "rows" });
  drawerEl = el("aside", { class: "drawer", "aria-label": "Step and track options" });
  boardEl = el("main", { class: "board" }, rowsEl, drawerEl);
  const ctx = { dev, say, hand: () => S.hand, goto };
  screens.mix = MixScreen(ctx); screens.sound = SoundScreen(ctx); screens.song = SongScreen(ctx); screens.library = LibraryScreen(ctx); screens.settings = SettingsScreen(ctx);
  S.screen = "jam";
  root.replaceChildren(barEl, boardEl);
  renderBar(); renderRows(); renderDrawer();
  $(".status") && ($(".status").textContent = S.status.text);
}

function goto(name, arg) {
  if (S.screen === name && arg == null) return;
  const old = screens[S.screen];
  if (old && old.leave) old.leave();
  S.screen = name;
  root.replaceChildren(barEl, name === "jam" ? boardEl : screens[name].el);
  renderBar();
  if (name === "jam") { renderRows(); renderDrawer(); } else screens[name].open(arg);
}

function renderBar() {
  if (!barEl) return;
  const d = dev(), g = d.global, run = S.clock && S.clock.running;
  const canClock = g.ok;
  barEl.replaceChildren(...[
    el("span", { class: "brand", text: "KRIECHSTROM" }),
    el("nav", { class: "nav", "aria-label": "Screens" }, SCREENS.map(([k, label]) => el("button", { "aria-current": String(S.screen === k), onclick: () => goto(k), text: label }))),
    el("button", { class: "btn play" + (run ? " run" : ""), "aria-label": run ? "Stop" : "Play", disabled: !canClock, onclick: togglePlay }, ic(run ? "stop" : "play")),
    el("div", { class: "bpm" },
      el("button", { "aria-label": "Slower", onclick: () => setBpm(bpm() - 1), onpointerdown: (e) => holdRepeat(e, () => setBpm(bpm() - 1)) }, ic("minus")),
      el("output", { "aria-label": "Tempo" }, String(bpm()), el("small", { text: "BPM" })),
      el("button", { "aria-label": "Faster", onclick: () => setBpm(bpm() + 1), onpointerdown: (e) => holdRepeat(e, () => setBpm(bpm() + 1)) }, ic("plus"))),
    el("button", { class: "switch", role: "switch", "aria-checked": String(S.clockOn), disabled: !canClock, onclick: toggleClockMode },
      el("span", { class: "tr" }), "Tablet clock"),
    S.clockOn && S.clock && S.clock.late ? el("span", { class: "clockwarn", text: "Browser is slowing the clock: keep this tab in front" }) : null,
    !canClock ? el("span", { class: "hint", text: "This firmware does not expose BPM and clock source." }) : null,
    el("span", { class: "status" + (S.status.kind === "error" ? " error" : ""), role: "status", "aria-live": "polite", text: S.status.text })].filter(Boolean));
}

const bpm = () => (S.clock ? S.clock.bpm : dev().global.bpm);
function setBpm(v) { v = Math.max(40, Math.min(240, v)); if (!S.clock) ensureClock(); S.clock.setBpm(v); dev().global.bpm = v; renderBar(); }
function holdRepeat(e, fn) {                                  /* press and hold repeats */
  let t = setTimeout(function loop() { fn(); t = setTimeout(loop, 90); }, 450);
  const end = () => { clearTimeout(t); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
}

/* ------------------------------------------------------------ clock --- */
function ensureClock() {
  if (S.clock) return S.clock;
  const out = dev().output;
  S.clock = new MidiClock((b, ts) => out.send(b, ts));
  S.clock.setBpm(dev().global.bpm || 120);
  return S.clock;
}
async function enableClock() {
  const d = dev();
  ensureClock();
  if (!S.clockOn) {
    S.prevClk = d.global.clk;
    await d.setClockSource(d.global.clkNames.indexOf("USB"));
    S.clockOn = true;
    say("Clock source set to USB. This tablet now drives the tempo.");
  }
}
async function toggleClockMode() {
  if (S.clockOn) { stopClock(); try { await dev().setClockSource(S.prevClk ?? 0); } catch (e) { /* closed */ } S.clockOn = false; say("Clock source restored"); }
  else await enableClock();
  renderBar();
}
async function togglePlay() {
  await enableClock();
  if (S.clock.running) stopClock(); else { S.clock.start(); wakeLock(true); loop(); }
  renderBar();
}
function stopClock() { if (S.clock && S.clock.running) S.clock.stop(); wakeLock(false); updatePlayhead(); renderBar(); }
async function wakeLock(on) {
  try {
    if (on && navigator.wakeLock) S.wake = await navigator.wakeLock.request("screen");
    else if (!on && S.wake) { await S.wake.release(); S.wake = null; }
  } catch (e) { /* not available: the screen may sleep */ }
}
document.addEventListener("visibilitychange", () => { if (S.clock && S.clock.running && !document.hidden) wakeLock(true); });

/* ------------------------------------------------------------ rows --- */
const cellRefs = [[], [], [], []];            /* per track: step index -> cell element(s) for the visible page */

function renderRows() {
  if (!rowsEl) return;
  const d = dev();
  rowsEl.replaceChildren();
  for (let t = 0; t < d.ntrk; t++) { clampPage(t); rowsEl.append(trackRow(t)); }
  updatePlayhead();
}

function headEl(t) {
  const tr = trk(t), hand = S.hand === t;
  const name = el("button", { class: "name", "aria-pressed": String(hand), "aria-label": `Track ${t + 1}, ${tr.name}. ${hand ? "In hand" : "Put in hand"}`,
    onclick: () => putInHand(t) },
    el("span", { class: "num", text: String(t + 1) }), el("span", { class: "txt" }, el("span", { class: "snd", text: tr.name }), hand ? el("span", { class: "eng", text: tr.engineName }) : null));
  const mute = el("button", { class: "mute", "aria-pressed": String(tr.mute), "aria-label": `Mute track ${t + 1}`, text: "M", onclick: () => dev().setMix(t, tr.level, !tr.mute) });
  const lvl = el("div", { class: "lvl" }, el("input", { type: "range", class: "red", min: 0, max: 127, value: tr.level, "aria-label": `Level track ${t + 1}`,
    oninput: (e) => dev().setMix(t, +e.target.value, trk(t).mute) }));
  const head = el("div", { class: "head" }, el("div", { class: "top" }, name, mute, lvl));
  if (hand) head.append(handTools(t));
  else if (pagesOf(t) > 1) head.append(el("button", { class: "pg", "aria-label": `Track ${t + 1} steps page, next`, text: `${S.page[t] + 1}/${pagesOf(t)}`,
    onclick: () => setPage(t, (S.page[t] + 1) % pagesOf(t)) }));
  return head;
}

function handTools(t) {
  const tr = trk(t), pages = pagesOf(t);
  const box = el("div", { class: "tools" });
  if (pages > 1) box.append(el("div", { class: "pager" },
    el("button", { "aria-label": "Previous 16 steps", onclick: () => setPage(t, S.page[t] - 1) }, ic("left")),
    el("output", { text: `Steps ${S.page[t] * PAGE + 1}-${Math.min(tr.len, S.page[t] * PAGE + PAGE)}` }),
    el("button", { "aria-label": "Next 16 steps", onclick: () => setPage(t, S.page[t] + 1) }, ic("right"))));
  if (!tr.drum) box.append(el("div", { class: "pager" },
    el("button", { "aria-label": "Lower octave", onclick: () => { S.octave[t] = Math.max(0, S.octave[t] - 1); renderRows(); } }, ic("down")),
    el("output", { text: `${noteName(S.octave[t] * 12)} - ${noteName(S.octave[t] * 12 + 11)}` }),
    el("button", { "aria-label": "Higher octave", onclick: () => { S.octave[t] = Math.min(9, S.octave[t] + 1); renderRows(); } }, ic("up"))));
  box.append(el("button", { class: "btn", onclick: () => openDrawer("track") }, "Track options"),
    el("button", { class: "btn", onclick: () => { S.sel = S.sel && S.sel.t === t ? S.sel : { t, i: S.page[t] * PAGE }; openDrawer("step"); } }, "Step detail"));
  return box;
}

function trackRow(t) {
  const hand = S.hand === t, tr = trk(t);
  const row = el("section", { class: "trk" + (hand ? " hand" : "") + (tr.mute ? " muted" : ""), "data-t": t, "aria-label": `Track ${t + 1}` }, headEl(t));
  row.append(hand ? rollEl(t) : cellsEl(t));
  return row;
}

function pageRange(t) { const a = S.page[t] * PAGE; return [a, Math.min(trk(t).len, a + PAGE)]; }

function cellsEl(t) {
  const box = el("div", { class: "cells", role: "group", "aria-label": `Track ${t + 1} steps` });
  cellRefs[t] = [];
  const [a, b] = pageRange(t);
  for (let k = 0; k < PAGE; k++) {
    const i = a + k;
    const c = el("button", { class: "cell" + (k % 4 === 0 ? " beat" : "") + (i >= b ? " void" : ""), "data-t": t, "data-i": i });
    cellRefs[t][k] = c;
    if (i < b) paintCell(c, t, i, null);
    box.append(c);
  }
  wireDrag(box, t, null);
  return box;
}

function rollEl(t) {
  const tr = trk(t), box = el("div", { class: "roll", role: "group", "aria-label": `Track ${t + 1} roll` });
  const [a, b] = pageRange(t);
  const rows = tr.drum ? [0, 1, 2, 3, 4, 5, 6, 7] : Array.from({ length: 12 }, (_, k) => S.octave[t] * 12 + 11 - k);
  cellRefs[t] = [];
  box.append(el("div"));
  for (let k = 0; k < PAGE; k++) {
    const i = a + k;
    box.append(el("button", { class: "hd" + (k % 4 === 0 ? " beat" : "") + (i >= b ? " void" : ""), "data-hd": k, "aria-label": `Step ${i + 1} detail`,
      style: i >= b ? "visibility:hidden" : "", text: String(i + 1), onclick: () => { setSel(t, i); openDrawer("step"); } }));
  }
  rows.forEach((r) => {
    box.append(el("div", { class: "lab" + (!tr.drum && r % 12 === 0 ? " root" : ""), text: tr.drum ? LANE_NAMES[r] : noteName(r) }));
    for (let k = 0; k < PAGE; k++) {
      const i = a + k;
      const c = el("button", { class: "cell" + (k % 4 === 0 ? " beat" : "") + (i >= b ? " void" : "") + (!tr.drum && isBlack(r) ? " key" : ""), "data-t": t, "data-i": i, "data-r": r,
        "aria-label": `Step ${i + 1}, ${tr.drum ? LANE_NAMES[r] : noteName(r)}` });
      (cellRefs[t][k] ||= []).push(c);
      if (i < b) paintCell(c, t, i, r);
      box.append(c);
    }
  });
  wireDrag(box, t, true);
  return box;
}

/* a cell's look. row null: the collapsed row (the step as a whole); else one roll row (a pitch or a lane) */
function paintCell(c, t, i, row) {
  const d = dev(), tr = trk(t), s = d.getStep(t, i);
  const note = s.time === TIME.NOTE;
  let on;
  if (row == null) on = tr.drum ? stepLaneMask(s, laneOf) !== 0 && note : note && (s.n > 0 || s.hit !== 0);
  else on = tr.drum ? note && (stepLaneMask(s, laneOf) >> row & 1) === 1 : note && s.notes.slice(0, s.n).includes(row);
  const cls = ["cell"];
  if (c.classList.contains("beat")) cls.push("beat");
  if (c.classList.contains("void")) cls.push("void");
  if (c.classList.contains("key")) cls.push("key");
  if (on) cls.push("on");
  if (s.time === TIME.TIE && (row == null || (tr.drum ? (stepLaneMask(s, laneOf) >> row & 1) === 1 : s.notes.slice(0, s.n).includes(row)))) cls.push("tie");
  if (row == null && s.time === TIME.REST && !on) cls.push("rest");
  if (S.sel && S.sel.t === t && S.sel.i === i) cls.push("sel");
  c.className = cls.join(" ");
  c.replaceChildren();
  const k = [];
  if (on && (row == null || row === firstRow(s, tr))) {
    if (s.flags & FLAG.ACCENT) k.push(el("span", { class: "acc" }));
    const marks = [s.ratchet > 1 ? "x" + s.ratchet : "", s.cond ? CONDITIONS[s.cond] : s.chance < 100 ? s.chance + "%" : "", s.flags & FLAG.SLIDE ? "~" : ""].filter(Boolean).join(" ");
    if (marks && row != null) k.push(el("span", { class: "mk", text: marks }));
    else if (marks) k.push(el("span", { class: "mk", text: marks }));
  }
  if (row == null && !on && s.time !== TIME.TIE) { if ((i % 4) === 0) c.append(document.createTextNode(String(i + 1))); }
  c.append(...k);
  if (S.locks.some((l) => l.t === t && l.step === i) && (row == null || row === firstRow(s, tr))) c.append(el("span", { class: "lk" }));
  if (row == null) c.setAttribute("aria-label", `Track ${t + 1} step ${i + 1}, ${on ? "on" : s.time === TIME.TIE ? "tie" : "off"}`);
  c.setAttribute("aria-pressed", String(on));
}
function firstRow(s, tr) {
  if (tr.drum) { const m = stepLaneMask(s, laneOf); for (let l = 0; l < 8; l++) if (m >> l & 1) return l; return -1; }
  return s.n ? s.notes[s.n - 1] : -1;
}

function updateCells(t, i) {
  const [a] = pageRange(t);
  const refs = cellRefs[t] || [];
  const only = i == null ? null : i - a;
  refs.forEach((x, k) => {
    if (only != null && k !== only) return;
    if (!x) return;
    if (Array.isArray(x)) for (const c of x) { const row = c.dataset.r == null ? null : +c.dataset.r; paintCell(c, t, a + k, row); }
    else paintCell(x, t, a + k, null);
  });
}

/* ------------------------------------------------------------ playhead --- */
let raf = 0;
function loop() { cancelAnimationFrame(raf); const tick = () => { updatePlayhead(); if (S.clock && S.clock.running) raf = requestAnimationFrame(tick); }; tick(); }
function updatePlayhead() {
  const d = S.dev;
  if (!d) return;
  for (let t = 0; t < d.ntrk; t++) {
    const tr = trk(t), cur = S.clock && S.clock.running ? S.clock.stepOf(tr.div, tr.len) : -1;
    const [a] = pageRange(t);
    const shown = cur >= a && cur < a + PAGE ? cur - a : -1;
    const row = rowsEl && rowsEl.children[t];
    if (!row) continue;
    row.querySelectorAll(".cell.now, .hd.now").forEach((x) => x.classList.remove("now"));
    if (shown >= 0) {
      const refs = cellRefs[t][shown];
      if (Array.isArray(refs)) refs.forEach((c) => c.classList.add("now")); else if (refs) refs.classList.add("now");
      const hd = row.querySelector(`.hd[data-hd="${shown}"]`);
      if (hd) hd.classList.add("now");
    }
  }
  if (S.clock) { const was = S.clock.late; S.clock.late = S.clock.running && S.clock.health && !S.clock.health(); if (was !== S.clock.late) renderBar(); }
}

/* ------------------------------------------------------------ taps and drags --- */
function putInHand(t) { if (S.hand === t) return; S.hand = t; S.sel = null; renderRows(); if (S.drawer) renderDrawer(); }
function setPage(t, p) { S.page[t] = p; clampPage(t); renderRows(); }

function cellAt(x, y) { const e = document.elementFromPoint(x, y); return e && e.closest ? e.closest(".cell") : null; }

function wireDrag(box, t, isRoll) {
  let st = null;
  box.addEventListener("pointerdown", (e) => {
    const c = e.target.closest(".cell");
    if (!c || c.classList.contains("void")) return;
    box.setPointerCapture && box.setPointerCapture(e.pointerId);
    st = { x: e.clientX, y: e.clientY, c, painting: false, handled: false, visited: new Set(), row: c.dataset.r == null ? null : +c.dataset.r };
    st.timer = setTimeout(() => { if (st && !st.painting) { st.handled = true; setSel(t, +c.dataset.i); openDrawer("step"); } }, 450);
  });
  box.addEventListener("pointermove", (e) => {
    if (!st || st.handled) return;
    if (!st.painting && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) {
      st.painting = true; clearTimeout(st.timer);
      const i0 = +st.c.dataset.i;
      st.want = !isOn(t, i0, st.row);
      applyCell(t, i0, st.row, st.want); st.visited.add(i0);
    }
    if (st.painting) {
      const c = cellAt(e.clientX, e.clientY);
      if (!c || c.dataset.t !== String(t)) return;
      const r = c.dataset.r == null ? null : +c.dataset.r, i = +c.dataset.i;
      if (r !== st.row || st.visited.has(i) || c.classList.contains("void")) return;
      st.visited.add(i); applyCell(t, i, st.row, st.want);
    }
  });
  box.addEventListener("contextmenu", (e) => e.preventDefault());
  const end = (e) => {
    if (!st) return;
    clearTimeout(st.timer);
    if (!st.painting && !st.handled && e.type === "pointerup") {
      const i = +st.c.dataset.i;
      tapCell(t, i, st.row);
    }
    st = null;
  };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  box.addEventListener("keydown", (e) => {                          /* keyboard: Enter or Space on a focused cell */
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("cell")) {
      e.preventDefault();
      const c = e.target; tapCell(t, +c.dataset.i, c.dataset.r == null ? null : +c.dataset.r);
    }
  });
}

function isOn(t, i, row) {
  const tr = trk(t), s = dev().getStep(t, i);
  if (s.time !== TIME.NOTE) return false;
  if (row == null) return tr.drum ? stepLaneMask(s, laneOf) !== 0 : s.n > 0 || s.hit !== 0;
  return tr.drum ? (stepLaneMask(s, laneOf) >> row & 1) === 1 : s.notes.slice(0, s.n).includes(row);
}

function setSel(t, i) { S.sel = { t, i }; updateAllSel(); }
function tapCell(t, i, row) {
  setSel(t, i);
  applyCell(t, i, row, !isOn(t, i, row));
  if (S.drawer && S.tab === "step") renderDrawer();
}

/* set a cell on or off. row null: the collapsed row uses the track's last pitch or lane, and off clears the whole step */
function applyCell(t, i, row, want) {
  const d = dev(), tr = trk(t), s = d.getStep(t, i), br = S.brush[t];
  let n;
  if (row == null) {
    if (!want) n = clearedStep(s);
    else if (tr.drum) { n = toggleLane(clearedStep(s), br.lane, laneOf); }
    else { n = togglePitch(clearedStep(s), br.note); }
  } else if (tr.drum) {
    br.lane = row;
    n = (stepLaneMask(s, laneOf) >> row & 1) === (want ? 1 : 0) ? s : toggleLane(s, row, laneOf);
  } else {
    br.note = row;
    const has = s.notes.slice(0, s.n).includes(row);
    n = has === want ? s : togglePitch(s, row);
  }
  if (n === s) return;
  if (n.n === 0 && n.hit === 0) n = clearedStep(n);
  d.writeStep(t, n);
}

function clearedStep(s, rest) {
  return { ...s, n: 0, notes: [0, 0, 0, 0], hit: 0, acc: 0, time: rest ? TIME.REST : TIME.NOTE, flags: 0, chance: 100, cond: 0, ratchet: 1, nudge: 0 };
}

/* ------------------------------------------------------------ drawer --- */
function openDrawer(tab) {
  S.drawer = true; S.tab = tab;
  if (tab === "step" && !S.sel) S.sel = { t: S.hand, i: S.page[S.hand] * PAGE };
  boardEl.classList.add("drawer-open");
  renderDrawer(); renderRows();
  if (tab === "step") loadLocks();
}
function closeDrawer() { S.drawer = false; S.sel = null; boardEl.classList.remove("drawer-open"); renderRows(); }

function renderDrawer() {
  if (!drawerEl) return;
  boardEl.classList.toggle("drawer-open", S.drawer);
  if (!S.drawer) { drawerEl.replaceChildren(); return; }
  const tabs = el("div", { class: "dtabs", role: "tablist" },
    el("button", { role: "tab", "aria-selected": String(S.tab === "step"), onclick: () => openDrawer("step"), text: "STEP" }),
    el("button", { role: "tab", "aria-selected": String(S.tab === "track"), onclick: () => openDrawer("track"), text: "TRACK" }),
    el("button", { "aria-label": "Close", onclick: closeDrawer }, ic("close")));
  drawerEl.replaceChildren(tabs, S.tab === "step" ? stepPanel() : trackPanel());
}

function range(label, value, min, max, onInput, fmt = String, cls = "") {
  const out = el("output", { text: fmt(value) });
  const inp = el("input", { type: "range", class: cls, min, max, value, "aria-label": label,
    onpointerdown: () => { S.drag = true; }, oninput: (e) => { out.textContent = fmt(+e.target.value); onInput(+e.target.value); } });
  const end = () => { S.drag = false; };
  inp.addEventListener("pointerup", end); inp.addEventListener("pointercancel", end); inp.addEventListener("change", end);
  return el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: label }), out), inp);
}
function seg(items, current, onPick, label) {
  return el("div", { class: "seg", role: "group", "aria-label": label }, items.map(([val, text]) =>
    el("button", { "aria-pressed": String(current === val), onclick: () => onPick(val), text })));
}

const subtabs = (key, items) => el("div", { class: "seg subtabs", role: "tablist" }, items.map(([k, text]) =>
  el("button", { role: "tab", "aria-selected": String(S.sub[key] === k), "aria-pressed": String(S.sub[key] === k), text, onclick: () => { S.sub[key] = k; if (k === "auto") S.auto = null; renderDrawer(); } })));

function stepPanel() {
  const d = dev(), { t, i } = S.sel, tr = trk(t), s = d.getStep(t, i);
  const edit = (patch) => { const n = { ...s, ...patch }; d.writeStep(t, n); };
  const body = el("div", { class: "dbody" });
  const what = tr.drum
    ? Array.from({ length: 8 }, (_, l) => (stepLaneMask(s, laneOf) >> l & 1 && s.time === TIME.NOTE ? LANE_NAMES[l] : null)).filter(Boolean)
    : s.time === TIME.NOTE ? s.notes.slice(0, s.n).map(noteName) : [];
  body.append(el("h3", {},
    el("span", {}, `Step ${i + 1}`, el("small", { text: `  track ${t + 1}` })),
    el("span", { class: "notes" }, what.length ? what.map((x) => el("span", { class: "tag", text: x })) : el("span", { class: "hint", text: "empty" })),
    el("span", { style: "display:flex;gap:6px" },
      el("button", { class: "btn", "aria-label": "Previous step", onclick: () => stepSel(-1) }, ic("left")),
      el("button", { class: "btn", "aria-label": "Next step", onclick: () => stepSel(1) }, ic("right")))));
  const items = [["play", "Play"]];
  if (s.tail.ratchet || s.tail.chance) items.push(["repeat", "Repeat"]);
  if (s.tail.nudge || d.caps.locks) items.push(["more", "More"]);
  if (!items.some(([k]) => k === S.sub.step)) S.sub.step = "play";
  body.append(subtabs("step", items));
  if (S.sub.step === "play") {
    body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Type" }),
      seg([[TIME.NOTE, "Play"], [TIME.TIE, "Tie"], [TIME.REST, "Rest"]], s.time, (v) => edit({ time: v }), "Step type")));
    body.append(range("Loudness", s.vel || 96, 1, 127, (v) => edit({ vel: v }), (v) => String(v), "red"));
    body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Feel" }), el("div", { class: "seg" },
      el("button", { "aria-pressed": String(!!(s.flags & FLAG.ACCENT)), onclick: () => edit({ flags: s.flags ^ FLAG.ACCENT }), text: "Accent" }),
      el("button", { "aria-pressed": String(!!(s.flags & FLAG.SLIDE)), onclick: () => edit({ flags: s.flags ^ FLAG.SLIDE }), text: "Slide" }))));
  } else if (S.sub.step === "repeat") {
    if (s.tail.ratchet) body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Repeats in the step" }),
      seg([[1, "x1"], [2, "x2"], [3, "x3"], [4, "x4"]], s.ratchet, (v) => edit({ ratchet: v }), "Repeats")));
    if (s.tail.chance) {
      const useCond = s.cond > 0;
      body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Plays" }),
        seg([[0, "Chance"], [1, "Condition"]], useCond ? 1 : 0, (v) => (v ? edit({ cond: s.tail.cond ? 1 : 0 }) : edit({ cond: 0 })), "Chance or condition")));
      if (useCond) body.append(el("div", { class: "chips" }, CONDITIONS.slice(1).map((c, k) =>
        el("button", { "aria-pressed": String(s.cond === k + 1), onclick: () => edit({ cond: k + 1 }), text: c }))),
        el("p", { class: "hint", text: "1:2 plays on the first of every two loops. FILL plays while FILL is held on the machine." }));
      else body.append(range("Chance", s.chance, 0, 100, (v) => edit({ chance: v }), (v) => v + "%"));
    }
  } else {
    if (s.tail.nudge) body.append(range("Nudge", s.nudge, -8, 7, (v) => edit({ nudge: v }), (v) => (v > 0 ? "+" : "") + v + "/16"),
      el("p", { class: "hint", text: "Moves the step off the grid. It plays only while the track's Quantize is off." }));
    if (d.caps.locks) body.append(locksEl(t, i));
  }
  return body;
}

function stepSel(dir) {
  const { t } = S.sel, len = trk(t).len;
  const i = (S.sel.i + dir + len) % len;
  setSel(t, i);
  const p = Math.floor(i / PAGE);
  if (p !== S.page[t] && S.hand === t) { S.page[t] = p; renderRows(); } else updateAllSel();
  renderDrawer(); loadLocks();
}
function updateAllSel() { for (let t = 0; t < dev().ntrk; t++) updateCells(t); }

/* ---- locks ---- */
const LOCK_GROUPS = [[0, 0, "Level"], [1, 4, "Env"], [5, 8, "Env amt"], [9, 12, "LFO"], [13, 16, "LFO amt"], [33, 36, "FX"], [38, 38, "Voice"], [39, 39, "Voice"], [44, 44, "Voice"]];
function lockGroup(id) { const g = LOCK_GROUPS.find(([a, b]) => id >= a && id <= b); return g ? g[2] : "Sound"; }

async function loadLocks() {
  const d = dev();
  if (!d.caps.locks || !S.sel) return;
  try {
    const t = S.sel.t;
    S.locks = (await d.readLocks(t)).map((l) => ({ ...l, t }));
    await ensureLockable();
    updateAllSel();
    if (S.drawer && S.tab === "step" && !S.drag) renderDrawer();
  } catch (e) { /* no reply: locks are left out */ }
}
async function ensureLockable() {
  if (S.lockable) return;
  const d = dev(), { CMD, req, parse } = d.A, pe0 = d.info.pe0, ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 33, 34, 35, 36, 38, 39, 44];
  for (let k = 0; k < 8; k++) ids.push(pe0 + k);
  S.lockable = [];
  for (const id of ids) {
    try {
      const x = parse[CMD.DESC](await d.rq(req.desc(0, id)));
      S.lockDesc[id] = x;
      if (x.max > x.min && x.label !== "-") S.lockable.push(id);
    } catch (e) { /* skip */ }
  }
}
const lockName = (id) => { const x = S.lockDesc[id]; return x ? `${lockGroup(id)} ${x.label}` : "Parameter " + id; };

function locksEl(t, i) {
  const d = dev(), mine = S.locks.filter((l) => l.t === t && l.step === i);
  const box = el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Locks on this step" }), el("output", { text: String(mine.length) })));
  const per = 3, pages = Math.max(1, Math.ceil(mine.length / per)), lp = Math.min(S.lockPage, pages - 1);
  for (const l of mine.slice(lp * per, lp * per + per)) {
    const x = S.lockDesc[l.id], min = x ? x.min : -64, max = x ? x.max : 127;
    box.append(el("div", { class: "lock" }, el("span", { class: "nm", text: lockName(l.id) }),
      el("button", { class: "btn", "aria-label": "Remove lock", onclick: async () => { try { S.locks = (await d.deleteLock(t, i, l.id)).map((r) => ({ ...r, t })); } catch (e) { say(e.message, "error"); } updateAllSel(); renderDrawer(); } }, ic("close")),
      el("input", { type: "range", min, max, value: l.value, "aria-label": lockName(l.id), onpointerdown: () => { S.drag = true; },
        oninput: (e) => { d.setLock(t, i, l.id, +e.target.value).catch((er) => say(er.message, "error")); },
        onchange: () => { S.drag = false; } })));
  }
  const pick = el("select", { "aria-label": "Add a lock" }, el("option", { value: "", text: "Add a lock..." }),
    ...(S.lockable || []).map((id) => el("option", { value: id, text: lockName(id) })));
  pick.addEventListener("change", async () => {
    if (pick.value === "") return;
    const id = +pick.value;
    try {
      const { CMD, req, parse } = d.A;
      const cur = parse[CMD.TRACK_PARAM](await d.rq(req.trackParam(t, id))).value;
      S.locks = (await d.setLock(t, i, id, cur)).map((r) => ({ ...r, t }));
    } catch (e) { say(e.message, "error"); }
    updateAllSel(); renderDrawer();
  });
  if (pages > 1) box.append(el("div", { class: "pager" },
    el("button", { "aria-label": "Previous locks", onclick: () => { S.lockPage = Math.max(0, lp - 1); renderDrawer(); } }, ic("left")),
    el("output", { text: `${lp + 1} / ${pages}` }),
    el("button", { "aria-label": "Next locks", onclick: () => { S.lockPage = Math.min(pages - 1, lp + 1); renderDrawer(); } }, ic("right"))));
  box.append(pick);
  return box;
}

/* ---- automation of a track: every lock and recorded event, as the machine keeps them ---- */
async function loadAuto(t) {
  try { await ensureLockable(); S.auto = { t, ...(await dev().readMotion(t)) }; } catch (e) { S.auto = { t, on: false, max: 0, recs: [], off: true }; }
  if (S.drawer && S.tab === "track" && S.sub.track === "auto" && !S.drag) renderDrawer();
}
function autoEl(t) {
  const d = dev(), a = S.auto && S.auto.t === t ? S.auto : null;
  const box = el("div", { class: "auto" });
  if (!a) { loadAuto(t); box.append(el("p", { class: "hint", text: "Reading the automation..." })); return box; }
  if (a.off) { box.append(el("p", { class: "hint", text: "This firmware keeps no automation." })); return box; }
  const redo = async (fn) => { try { await fn(); } catch (e) { say(e.message, "error"); } await loadAuto(t); updateAllSel(); loadLocks(); };
  box.append(el("div", { class: "row", style: "flex-wrap:nowrap;gap:6px" },
    el("button", { class: "btn", "aria-pressed": String(a.on), title: "Play the automation", onclick: () => redo(() => d.motionOn(t, !a.on)) }, a.on ? "Play" : "Off"),
    el("button", { class: "btn", disabled: !a.recs.some((r) => r.kind === 0), onclick: () => redo(() => d.motionClear(t)) }, "Events x"),
    d.caps.locks ? el("button", { class: "btn", disabled: !a.recs.some((r) => r.kind === 1), onclick: () => redo(() => d.motionCmd(t, [6, 127])) }, "Locks x") : null));
  const per = 2, pages = Math.max(1, Math.ceil(a.recs.length / per)); S.autoPage = Math.min(S.autoPage || 0, pages - 1);
  for (const r of a.recs.slice(S.autoPage * per, S.autoPage * per + per)) {
    const x = S.lockDesc[r.id], min = x ? x.min : -64, max = x ? x.max : 127;
    box.append(el("div", { class: "lock" }, el("span", { class: "nm", text: `${r.step + 1} ${r.kind ? "lock" : "event"} ${lockName(r.id)}` }),
      el("button", { class: "btn", "aria-label": "Remove", onclick: () => redo(() => d.deleteRecord(t, r.step, r.id)) }, ic("close")),
      el("input", { type: "range", min, max, value: r.value, "aria-label": lockName(r.id), onpointerdown: () => { S.drag = true; },
        oninput: (e) => { (r.kind ? d.setLock(t, r.step, r.id, +e.target.value) : d.setEvent(t, r.step, r.id, +e.target.value)).catch((er) => say(er.message, "error")); },
        onchange: () => { S.drag = false; } })));
  }
  if (pages > 1) box.append(el("div", { class: "pager" },
    el("button", { "aria-label": "Previous", onclick: () => { S.autoPage = Math.max(0, S.autoPage - 1); renderDrawer(); } }, ic("left")),
    el("output", { text: `${S.autoPage + 1} / ${pages}  (${a.recs.length}/${a.max})` }),
    el("button", { "aria-label": "Next", onclick: () => { S.autoPage = Math.min(pages - 1, S.autoPage + 1); renderDrawer(); } }, ic("right"))));
  S.autoAt = Math.min(S.autoAt || 0, trk(t).len - 1);
  const pick = el("select", { "aria-label": "Add an event" }, el("option", { value: "", text: "Add an event..." }), ...(S.lockable || []).map((id) => el("option", { value: id, text: lockName(id) })));
  pick.addEventListener("change", () => { if (pick.value === "") return; const id = +pick.value; redo(async () => { const cur = d.A.parse[d.A.CMD.TRACK_PARAM](await d.rq(d.A.req.trackParam(t, id))).value; await d.setEvent(t, S.autoAt, id, cur); }); });
  box.append(el("div", { class: "row" },
    el("div", { class: "stepper", "aria-label": "Step of the new event" },
      el("button", { "aria-label": "Earlier step", onclick: () => { S.autoAt = Math.max(0, S.autoAt - 1); renderDrawer(); } }, ic("minus")),
      el("output", { text: "step " + (S.autoAt + 1) }),
      el("button", { "aria-label": "Later step", onclick: () => { S.autoAt = Math.min(trk(t).len - 1, S.autoAt + 1); renderDrawer(); } }, ic("plus"))), pick));
  return box;
}

/* ---- track panel ---- */
function trackPanel() {
  const d = dev(), t = S.hand, tr = trk(t);
  const body = el("div", { class: "dbody" });
  body.append(el("h3", {}, el("span", {}, "Track " + (t + 1), el("small", { text: "  " + tr.name }))));
  body.append(subtabs("track", [["len", "Length"], ["feel", "Feel"], ["tools", "Tools"], ["dice", "Dice"], ["auto", "Auto"]]));
  if (S.sub.track === "len") {
    body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Length" }),
      el("div", { class: "stepper" },
        el("button", { "aria-label": "Shorter", onclick: () => setLen(t, tr.len - 1), onpointerdown: (e) => holdRepeat(e, () => setLen(t, trk(t).len - 1)) }, ic("minus")),
        el("output", { text: tr.len + " steps" }),
        el("button", { "aria-label": "Longer", onclick: () => setLen(t, tr.len + 1), onpointerdown: (e) => holdRepeat(e, () => setLen(t, trk(t).len + 1)) }, ic("plus"))),
      seg([[8, "8"], [16, "16"], [32, "32"], [64, "64"]], tr.len, (v) => setLen(t, v), "Length presets")));
    const names = (d.desc.DIV && d.desc.DIV.names) || [];
    body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Step size" }),
      el("div", { class: "chips" }, names.map((nm, k) => el("button", { "aria-pressed": String(tr.div === k), onclick: () => d.setDiv(t, k), text: nm })))));
  } else if (S.sub.track === "feel") {
    body.append(range("Swing", tr.swing, 0, 100, (v) => d.setSwing(t, v), (v) => v + "%"));
    body.append(range("Gate", tr.gate, 1, 127, (v) => d.setGate(t, v), String));
    if (d.qntzId != null) body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Quantize" }), seg([[1, "On"], [0, "Off"]], tr.qntz, (v) => d.setQntz(t, v), "Quantize")));
  } else if (S.sub.track === "tools") {
    body.append(el("div", { class: "toolgrid" },
      toolBtn("Shift left", () => shift(-1)), toolBtn("Shift right", () => shift(1)),
      toolBtn("Reverse", reverse), toolBtn("Double", doubleLen), toolBtn("Half", halfLen),
      el("button", { class: "btn" + (S.armClear ? " red" : ""), onclick: clearPattern }, S.armClear ? "Tap again" : "Clear")));
    const stp = (label, key, lo, hi, fmt) => el("div", { class: "stepper", "aria-label": label },
      el("button", { "aria-label": "Fewer " + label, onclick: () => { S[key] = Math.max(lo, S[key] - 1); renderDrawer(); } }, ic("minus")),
      el("output", { text: fmt(S[key]) }),
      el("button", { "aria-label": "More " + label, onclick: () => { S[key] = Math.min(hi(), S[key] + 1); renderDrawer(); } }, ic("plus")));
    S.eSteps = Math.max(1, Math.min(S.eSteps || trk(t).len, trk(t).len)); S.euclid = Math.min(S.euclid, S.eSteps); S.eRot = (S.eRot || 0) % S.eSteps;
    body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Euclid" }),
      el("div", { class: "row" }, stp("hits", "euclid", 0, () => S.eSteps, (v) => v + " hits"), stp("steps", "eSteps", 1, () => trk(t).len, (v) => v + " steps"), stp("rotation", "eRot", 0, () => S.eSteps - 1, (v) => "rot " + v)),
      toolBtn("Apply Euclid", euclid)));
  } else if (S.sub.track === "auto") {
    body.append(autoEl(t));
  } else {
    S.mood = S.mood || 0;
    body.append(el("div", { class: "chips", role: "group", "aria-label": "Mood" }, MOODS.map((nm, k) => el("button", { "aria-pressed": String(S.mood === k), onclick: () => { S.mood = k; renderDrawer(); }, text: nm }))));
    const row = [toolBtn("Roll dice", () => runTool("dice")), toolBtn("Random", () => runTool("random")), toolBtn("Cook", () => runTool("cook"))];
    if (tr.drum) row.push(toolBtn("Basic beat", () => runTool("beat")));
    body.append(el("div", { class: "toolgrid" }, row));
    if (tr.drum) body.append(el("div", { class: "field" }, el("div", { class: "lab", text: "Lane " + LANE_NAMES[S.brush[t].lane] }),
      el("div", { class: "toolgrid" }, toolBtn("Clear lane", () => runTool("laneClear")), toolBtn("Reverse lane", () => runTool("laneReverse")), toolBtn("Fill lane", () => runTool("laneFill")), toolBtn("Random lane", () => runTool("laneRandom")))));
  }
  if ((S.sub.track === "tools" || S.sub.track === "dice") && S.undo && S.undo.t === t) body.append(el("button", { class: "btn", onclick: undoTool, text: "Undo last tool" }));
  return body;
}
function toolCtx(t) {
  const d = dev(), tr = trk(t);
  return Promise.all([d.getParam(t, 25), d.getParam(t, 26)]).catch(() => [0, 0]).then(([root, sc]) => ({ drum: !!tr.drum, root: root % 12, mask: SCALE_BITS[sc] || 0xFFF, index: t, lane: S.brush[t].lane, laneOf }));
}
async function runTool(name) {
  const t = S.hand, tr = trk(t); if (!ready(t)) return;
  const c = await toolCtx(t); snapshot(t);
  const work = S.undo.steps.map((s) => structuredClone(s));
  let msg, len = tr.len;
  for (let i = work.length; i < 16; i++) work.push(emptyStep(i, work[0] ? work[0].tail : {}));
  if (name === "dice") { const r = Tools.dice(work, c, S.mood); msg = r.msg; len = r.len; }
  else msg = Tools[name](work, len, c);
  if (!msg) { S.undo = null; say("Nothing to cook yet", "error"); return; }
  if (len !== tr.len) setLen(t, len);
  writeAll(t, work.slice(0, len).map((s, i) => reindexed(s, i)));
  await unlockEmptied(t, S.undo.steps, work); say(msg); renderRows(); renderDrawer();
}
const toolBtn = (text, fn) => el("button", { class: "btn", onclick: fn, text });
function setLen(t, v) { v = Math.max(1, Math.min(64, v)); dev().setLen(t, v); trk(t).len = v; if (v > trk(t).loaded) dev().loadSteps(t, trk(t).loaded, v).catch(() => {}); clampPage(t); renderRows(); renderDrawer(); }

function snapshot(t) { const len = trk(t).len; S.undo = { t, len, steps: Array.from({ length: len }, (_, i) => structuredClone(dev().getStep(t, i))) }; }
function writeAll(t, steps) { for (const s of steps) dev().writeStep(t, s); }
function reindexed(s, i) { return { ...s, index: i }; }
function ready(t) { if (trk(t).loaded < trk(t).len) { say("Still reading the pattern. Try again in a moment.", "error"); return false; } return true; }
/* the steps' automation and locks follow their steps (ui_tools.c tl_order) */
async function order(t, src) {
  const old = S.undo.steps, len = src.length, to = [];
  src.forEach((from, j) => { to[from] = j; });
  writeAll(t, src.map((from, j) => reindexed(old[from], j)));
  try { await dev().remapMotion(t, (st) => (st < len ? to[st] : st)); } catch (e) { say(e.message, "error"); }
  S.auto = null; renderRows(); renderDrawer();
}
/* a step that held something and is empty after loses its locks */
async function unlockEmptied(t, before, after) {
  if (!dev().caps.locks) return;
  S.auto = null;
  try { for (let i = 0; i < after.length; i++) if (before[i] && before[i].time !== TIME.REST && after[i].time === TIME.REST) await dev().motionCmd(t, [6, i]); } catch (e) { say(e.message, "error"); }
}
function shift(dir) {
  const t = S.hand, len = trk(t).len; if (!ready(t)) return; snapshot(t);
  order(t, shiftSrc(len, dir > 0 ? 1 : len - 1));
}
function reverse() { const t = S.hand, len = trk(t).len; if (!ready(t)) return; snapshot(t); order(t, reverseSrc(S.undo.steps, len)); }
async function doubleLen() {
  const t = S.hand, len = trk(t).len; if (len * 2 > 64) { say("Doubling would pass 64 steps", "error"); return; } if (!ready(t)) return;
  try { const m = await dev().readMotion(t); const n = m.recs.length; if (n * 2 > m.max) { say("Automation full", "error"); return; } } catch (e) { /* no automation to copy */ }
  snapshot(t); const old = S.undo.steps;
  writeAll(t, old.map((s, i) => reindexed(s, len + i))); setLen(t, len * 2);
  try { await dev().remapMotion(t, (st) => st, (st) => (st < len ? st + len : -1)); } catch (e) { say(e.message, "error"); }
  S.auto = null;
}
async function halfLen() {
  const t = S.hand, len = trk(t).len; if (len < 2) return; snapshot(t);
  const h = Math.floor(len / 2);
  writeAll(t, S.undo.steps.slice(h).map((s, k) => reindexed(clearedStep(s, true), h + k))); setLen(t, h);
  try { await dev().remapMotion(t, (st) => (st >= h && st < len ? -1 : st)); } catch (e) { say(e.message, "error"); }
  S.auto = null;
}
function clearPattern() {
  if (!S.armClear) { S.armClear = true; renderDrawer(); setTimeout(() => { S.armClear = false; if (S.drawer && S.tab === "track") renderDrawer(); }, 3000); return; }
  S.armClear = false; runTool("clear");
}
async function euclid() {
  const t = S.hand, len = trk(t).len; if (!ready(t)) return;
  const c = await toolCtx(t); snapshot(t);
  const work = S.undo.steps.map((s) => structuredClone(s));
  const msg = Tools.euclid(work, len, c, S.euclid, S.eSteps, S.eRot);
  writeAll(t, work.map((s, i) => reindexed(s, i))); await unlockEmptied(t, S.undo.steps, work); say(msg); renderRows(); renderDrawer();
}
function undoTool() {
  const u = S.undo; if (!u) return;
  writeAll(u.t, u.steps); if (trk(u.t).len !== u.len) setLen(u.t, u.len); S.undo = null; renderDrawer();
}

/* a slider being dragged must not be rebuilt under the finger: renders wait until it is released */
document.addEventListener("pointerdown", (e) => { if (e.target.matches && e.target.matches("input[type=range]")) S.drag = true; });
const release = () => { if (!S.drag) return; S.drag = false; if (S.dirty && rowsEl) { S.dirty = false; renderRows(); if (S.drawer) renderDrawer(); renderBar(); } };
document.addEventListener("pointerup", release); document.addEventListener("pointercancel", release);

/* ------------------------------------------------------------ boot --- */
renderGate();
if (QS.get("mock") === "1") start(true);
window.__fm1 = { S };
