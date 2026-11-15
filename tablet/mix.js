// Mix screen: four channel strips with a level fader, pan and mute. Tap a name to edit that track's sound.

import { el } from "./ui.js";

/* a fader or pan bar that follows the finger: vertical (level) or horizontal (pan). values min..max, double tap resets. */
function bar({ vertical, min, max, value, def, label, onInput, fmt = String }) {
  const fill = el("div", { class: "fill" });
  const zero = vertical ? null : el("div", { class: "zero" });
  const box = el("div", { class: "bar" + (vertical ? " v" : " h"), role: "slider", tabindex: "0", "aria-label": label, "aria-valuemin": min, "aria-valuemax": max }, fill, zero);
  const out = el("output", { text: fmt(value) });
  let cur = value, lastTap = 0;
  const show = (v) => {
    cur = v;
    box.setAttribute("aria-valuenow", v);
    out.textContent = fmt(v);
    if (vertical) { fill.style.height = ((v - min) / (max - min)) * 100 + "%"; fill.style.left = fill.style.width = ""; }
    else {
      const z = (0 - min) / (max - min) * 100, p = (v - min) / (max - min) * 100;
      fill.style.left = Math.min(z, p) + "%"; fill.style.width = Math.abs(p - z) + "%"; fill.style.height = "";
      zero.style.left = z + "%";
    }
  };
  const at = (e) => {
    const r = box.getBoundingClientRect();
    const f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return Math.max(min, Math.min(max, Math.round(min + Math.max(0, Math.min(1, f)) * (max - min))));
  };
  box.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastTap < 350) { show(def); onInput(def); lastTap = 0; return; }
    lastTap = now;
    try { box.setPointerCapture(e.pointerId); } catch (x) { /* no active pointer */ }
    box.classList.add("hot");
    const v = at(e); show(v); onInput(v);
    const move = (ev) => { const x = at(ev); if (x !== cur) { show(x); onInput(x); } };
    const up = () => { box.classList.remove("hot"); box.removeEventListener("pointermove", move); box.removeEventListener("pointerup", up); box.removeEventListener("pointercancel", up); };
    box.addEventListener("pointermove", move); box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
  });
  box.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return; e.preventDefault();
    const v = Math.max(min, Math.min(max, cur + d * (e.shiftKey ? 10 : 1))); show(v); onInput(v);
  });
  show(value);
  return { box, out };
}

let held = false;
addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest(".mix .bar")) held = true; });
addEventListener("pointerup", () => { held = false; });
addEventListener("pointercancel", () => { held = false; });

export function MixScreen(ctx) {
  const root = el("section", { class: "mix" });
  const d = () => ctx.dev();
  let panId = null, levelDesc = null, panDesc = null, dragging = 0;

  async function open() {
    if (panId === null) {
      panId = (await d().panId()) ?? -1;
      levelDesc = await d().describe(0, 0);
      panDesc = panId >= 0 ? await d().describe(0, panId) : null;
    }
    render();
    for (let t = 0; t < d().ntrk; t++) if (panId >= 0) d().getParam(t, panId).then((v) => { d().tracks[t].pan = v; if (!dragging) render(); }).catch(() => {});
  }

  function strip(t) {
    const tr = d().tracks[t];
    const lv = bar({ vertical: true, min: 0, max: 127, value: tr.level, def: levelDesc ? levelDesc.def : 100, label: `Level, track ${t + 1}`,
      onInput: (v) => { dragging++; tr.level = v; d().setMix(t, v, tr.mute).finally(() => { dragging = Math.max(0, dragging - 1); }); strip.nodes[t].classList.toggle("quiet", tr.mute || !v); } });
    const pmin = panDesc ? panDesc.min : -64, pmax = panDesc ? panDesc.max : 63;
    const pan = panId >= 0 ? bar({ vertical: false, min: pmin, max: pmax, value: tr.pan ?? 0, def: panDesc ? panDesc.def : 0, label: `Pan, track ${t + 1}`,
      fmt: (v) => (v === 0 ? "C" : v < 0 ? "L" + -v : "R" + v), onInput: (v) => { tr.pan = v; d().setParam(t, panId, v).catch((e) => ctx.say(e.message, "error")); } }) : null;
    const node = el("div", { class: "strip" + (tr.mute || !tr.level ? " quiet" : ""), role: "group", "aria-label": `Track ${t + 1}` },
      el("button", { class: "who", "aria-label": `Edit the sound of track ${t + 1}`, onclick: () => ctx.goto("sound", t) },
        el("span", { class: "num", text: String(t + 1) }), el("span", { class: "txt" }, el("b", { text: tr.name }), el("small", { text: tr.engineName }))),
      el("div", { class: "lvrow" }, lv.box, lv.out),
      pan ? el("div", { class: "panrow" }, pan.box, pan.out) : null,
      el("button", { class: "mutebtn", "aria-pressed": String(tr.mute), onclick: () => { tr.mute = !tr.mute; d().setMix(t, tr.level, tr.mute).catch(() => {}); render(); }, text: tr.mute ? "Muted" : "Mute" }));
    strip.nodes[t] = node;
    return node;
  }
  strip.nodes = [];

  /* what the strips show: refresh() rebuilds them only when it changed (every machine report used to rebuild them, and a tap
   * that straddled a rebuild was lost) */
  const shown = () => JSON.stringify(Array.from({ length: d().ntrk }, (_, t) => { const r = d().tracks[t]; return [r.level, r.mute, r.pan, r.name, r.engineName]; }));
  let sig = "";
  function render() {
    root.replaceChildren();
    if (!d()) return;
    sig = shown();
    root.append(...Array.from({ length: d().ntrk }, (_, t) => strip(t)));
  }
  return { el: root, open, render, refresh() { if (!held && !dragging && d() && shown() !== sig) render(); }, leave() {} };
}
