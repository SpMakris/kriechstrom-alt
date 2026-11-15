// Perform screen: the FX layer of the machine under the fingers. Sixteen pads are the sixteen white keys F3..G5 and hold the
// effect each key holds; four macros are the FX knobs; SOLO and FILL are GLO's; the lane buttons are the DRUM lanes' mutes.
// The machine lets everything go 600 ms after the last frame it got, so a lost touch-up, a pulled cable or a closed page
// never leaves an effect stuck: while anything is held this screen repeats the state every 180 ms.

import { el, ic } from "./ui.js";
import { Ext, FX, FX_SHORT, FX_NONE, KRST } from "./ext.js";

const LANES = ["KICK", "SNARE", "CLAP", "HAT CL", "HAT OP", "TOM", "RIM", "BELL"];
const NOTES = ["F", "G", "A", "B", "C", "D", "E", "F", "G", "A", "B", "C", "D", "E", "F", "G"];
const octave = (p) => 3 + (p >= 4) + (p >= 11);
const MACROS = [
  { k: 0, name: "Filter", min: -100, max: 100, step: 2, fmt: (v) => (v === 0 ? "off" : v < 0 ? `LPF ${-v}` : `HPF ${v}`) },
  { k: 1, name: "Crush", min: 0, max: 100, step: 1, fmt: (v) => (v ? String(v) : "off") },
  { k: 2, name: "Throw", min: 0, max: 100, step: 1, fmt: (v) => (v ? String(v) : "off") },
  { k: 3, name: "Depth", min: 0, max: 100, step: 1, fmt: (v) => (v ? String(v) : "off") },
];
const HOLD_MS = 180;

export function PerformScreen(ctx) {
  const root = el("section", { class: "perform" });
  const d = () => ctx.dev();
  const st = { map: null, h: { mask: 0, k: [0, 0, 0, 0], solo: 0, fill: 0 }, latch: false, assign: false, sheet: null, reply: null, timer: null, was: false, lanes: 0, lane: null, busy: false, pads: [], solo: [], fillBtn: null };

  const active = () => !!(st.h.mask || st.h.solo || st.h.fill || st.h.k.some(Boolean));
  const caps = () => d().tags.krst || 0;

  async function open() {
    st.sheet = null; st.assign = false;
    if (!(caps() & KRST.PERF)) { render(); return; }
    try {
      if (caps() & KRST.KEYMAP) st.map = (await Ext.keymap(d())).map;
      await laneLoad();
      st.reply = await Ext.perf(d());
    } catch (e) { ctx.say(e.message, "error"); }
    clearInterval(st.timer); st.timer = setInterval(tick, HOLD_MS);
    render();
  }
  async function laneLoad() {
    const t = ctx.hand();
    st.lane = d().tracks[t] && d().tracks[t].drum && (caps() & KRST.DRUMMUTE) ? t : null;
    st.lanes = st.lane != null ? await Ext.drumMute(d(), st.lane) : 0;
  }
  function release() {
    st.h = { mask: 0, k: [0, 0, 0, 0], solo: 0, fill: 0 };
    if (d() && st.was) { st.was = false; Ext.perf(d(), st.h).catch(() => {}); }
  }
  /* send what is held (and, once, the release); the answer says what runs and what can */
  async function tick() {
    if (!d() || st.busy) return;
    const on = active();
    if (!on && !st.was) return;
    st.was = on;
    st.busy = true;
    try { st.reply = await Ext.perf(d(), st.h); paint(); } catch (e) { /* the status bar says */ }
    st.busy = false;
  }
  const kick = () => { st.busy = false; tick(); paint(); };

  /* press and hold, or toggle when LATCH is on; setBit(on) changes what is held */
  function hold(node, get, set) {
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (st.assign && node.dataset.pad != null) { st.sheet = { key: +node.dataset.pad }; render(); return; }
      if (st.latch) { set(!get()); kick(); return; }
      try { node.setPointerCapture(e.pointerId); } catch (x) { /* no active pointer */ }
      set(true); kick();
      const up = () => { node.removeEventListener("pointerup", up); node.removeEventListener("pointercancel", up); set(false); kick(); };
      node.addEventListener("pointerup", up); node.addEventListener("pointercancel", up);
    });
    node.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); set(!get()); kick(); } });
  }

  const effectOf = (p) => (st.map ? st.map[p] : p);
  function pads() {
    st.pads = [];
    return el("div", { class: "pads", role: "group", "aria-label": "Effects" }, Array.from({ length: 16 }, (_, p) => {
      const fx = effectOf(p), none = fx === FX_NONE || fx == null || fx >= FX.length;
      const b = el("button", { class: "pad" + (none ? " none" : ""), "data-pad": String(p), "aria-label": `${NOTES[p]}${octave(p)} ${none ? "no effect" : FX[fx]}`, "aria-pressed": "false" },
        el("b", { text: none ? "-" : FX_SHORT[fx] }), el("small", { text: `${NOTES[p]}${octave(p)}` }));
      if (!none || st.assign) hold(b, () => !!(st.h.mask & (1 << fx)), (on) => { if (none) return; st.h.mask = on ? st.h.mask | (1 << fx) : st.h.mask & ~(1 << fx); });
      st.pads.push({ b, fx });
      return b;
    }));
  }
  /* what the machine says: held (by us or the device) lit, an effect that cannot run at this tempo dim */
  function paint() {
    const r = st.reply;
    for (const { b, fx } of st.pads) {
      if (fx === FX_NONE || fx == null || fx >= FX.length) continue;
      const lit = !!(((r ? r.mask | r.device : st.h.mask) >> fx) & 1) || !!((st.h.mask >> fx) & 1);
      b.classList.toggle("lit", lit); b.setAttribute("aria-pressed", String(lit));
      b.classList.toggle("dim", !!r && !((r.avail >> fx) & 1));
    }
    st.solo.forEach((b, t) => { const on = !!((st.h.solo >> t) & 1); b.setAttribute("aria-pressed", String(on)); });
    if (st.fillBtn) st.fillBtn.setAttribute("aria-pressed", String(!!st.h.fill));
  }

  function macros() {
    return el("div", { class: "card" }, el("div", { class: "lab", text: "Knobs" }), ...MACROS.map((m) => {
      const out = el("output", { text: m.fmt(st.h.k[m.k]) });
      const inp = el("input", { type: "range", min: m.min, max: m.max, step: m.step, value: st.h.k[m.k], "aria-label": m.name,
        oninput: (e) => { st.h.k[m.k] = +e.target.value; out.textContent = m.fmt(st.h.k[m.k]); kick(); },
        ondblclick: () => { inp.value = 0; st.h.k[m.k] = 0; out.textContent = m.fmt(0); kick(); } });
      return el("div", { class: "field inline" }, el("span", { class: "nm", text: m.name }), inp, out);
    }));
  }

  function side() {
    st.solo = []; st.fillBtn = null;
    const soloRow = el("div", { class: "seg", role: "group", "aria-label": "Solo" }, Array.from({ length: d().ntrk }, (_, t) => {
      const b = el("button", { "aria-pressed": String(!!((st.h.solo >> t) & 1)), "aria-label": "Solo track " + (t + 1), text: "Solo " + (t + 1) });
      hold(b, () => !!((st.h.solo >> t) & 1), (on) => { st.h.solo = on ? st.h.solo | (1 << t) : st.h.solo & ~(1 << t); });
      st.solo.push(b);
      return b;
    }));
    st.fillBtn = el("button", { class: "btn fill", "aria-pressed": String(!!st.h.fill), title: "The steps with a FILL condition play while this is held" , text: "Fill" });
    hold(st.fillBtn, () => !!st.h.fill, (on) => { st.h.fill = on ? 1 : 0; });
    const lanes = st.lane != null ? el("div", { class: "card" }, el("div", { class: "lab" }, el("span", { text: "Drum lanes" }), el("output", { text: "Track " + (st.lane + 1) })),
      el("div", { class: "lanes", role: "group", "aria-label": "Lane mutes" }, LANES.map((n, l) => el("button", { class: "btn", "aria-pressed": String(!((st.lanes >> l) & 1)), title: ((st.lanes >> l) & 1) ? n + " is muted" : n + " plays", text: n,
        onclick: async () => { try { st.lanes = await Ext.drumMute(d(), st.lane, st.lanes ^ (1 << l)); } catch (e) { ctx.say(e.message, "error"); } render(); } })))) : null;
    return el("div", { class: "pside" }, macros(), el("div", { class: "row" }, soloRow, st.fillBtn), lanes);
  }

  async function setKey(p, fx) {
    try { const r = await Ext.keymap(d(), { key: p, fx }); st.map = r.map; if (r.rc === 3) ctx.say("Kept until power-off: the machine could not save the key map."); else if (r.rc === 4) ctx.say("The key map is saved when the transport stops."); else if (r.rc === 1) ctx.say("The machine refused that key", "error"); }
    catch (e) { ctx.say(e.message, "error"); }
    st.sheet = null; render();
  }
  async function resetKeys() {
    try { const r = await Ext.keymap(d(), { reset: true }); st.map = r.map; ctx.say("The default key map is back"); } catch (e) { ctx.say(e.message, "error"); }
    st.sheet = null; render();
  }
  function sheet() {
    if (!st.sheet) return null;
    const close = () => { st.sheet = null; render(); };
    const p = st.sheet.key, cur = effectOf(p);
    return el("div", { class: "sheet", role: "dialog", "aria-label": "Effect for key " + NOTES[p] + octave(p) },
      el("div", { class: "sheethead" }, el("b", { text: `Key ${NOTES[p]}${octave(p)} holds` }), el("button", { class: "btn", "aria-label": "Close", onclick: close }, ic("close"))),
      el("div", { class: "plist three" }, [...FX.map((n, i) => el("button", { class: "btn", "aria-pressed": String(cur === i), text: n, onclick: () => setKey(p, i) })),
        el("button", { class: "btn", "aria-pressed": String(cur === FX_NONE), text: "None", onclick: () => setKey(p, FX_NONE) })]),
      el("button", { class: "btn", onclick: resetKeys, text: "Put the default keys back" }));
  }

  function render() {
    root.replaceChildren();
    if (!d()) return;
    if (!(caps() & KRST.PERF)) {
      root.append(el("div", { class: "empty" }, el("h2", { text: "No perform controls on this firmware" }), el("p", { text: "This machine's firmware does not report the perform commands. Flash the KRIECHSTROM tablet build to get them." })));
      return;
    }
    const head = el("div", { class: "fhead" },
      el("button", { class: "btn", "aria-pressed": String(st.latch), title: "A pad stays on until it is tapped again", onclick: () => { st.latch = !st.latch; if (!st.latch) { release(); } render(); }, text: "Latch" }),
      (caps() & KRST.KEYMAP) ? el("button", { class: "btn", "aria-pressed": String(st.assign), title: "Tap a pad to choose its effect", onclick: () => { st.assign = !st.assign; if (st.assign) release(); render(); }, text: "Assign keys" }) : null,
      el("button", { class: "btn", onclick: () => { release(); st.reply = null; render(); }, text: "Let go of everything" }),
      el("span", { class: "hint grow", text: st.assign ? "Tap a pad, then choose what its key holds." : "Hold a pad to play the effect. The machine's own keys work at the same time." }));
    root.append(head, el("div", { class: "pbody" }, pads(), side()), sheet());
    paint();
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
  return { el: root, open, render, leave() { clearInterval(st.timer); st.timer = null; release(); st.sheet = null; } };
}
