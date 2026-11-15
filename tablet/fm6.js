// FM6 screen: the six-operator voice of an FM6 track. The algorithm is drawn, the operators are tapped, the envelopes are dragged.
// Every change goes to the machine live (a short pause after the last touch), as the shipped editor's "live" option does.

import { el, ic } from "./ui.js";

const WAVES = ["Triangle", "Saw down", "Saw up", "Square", "Sine", "Sample & hold"];
const CURVES = ["Linear down", "Exp down", "Exp up", "Linear up"];

/* ------------------------------------------------------------ the algorithm as a picture --- */
/* msfa flag bytes, the sixth operator first: bits 0-1 the bus written (0: the output), 2 add to that bus, 4-5 the bus read,
   6 feedback in, 7 feedback out. Returns where each operator sits and who modulates whom. */
export function algLayout(FM6, a) {
  const bus = [[], [], []], edges = [], carriers = [];
  let fbIn = 0, fbOut = 0;
  for (let i = 0; i < 6; i++) {
    const n = 6 - i, b = FM6.ALG[a][i], out = b & 3, inp = (b >> 4) & 3;
    if (inp) for (const s of bus[inp]) edges.push([s, n]);
    if (out) bus[out] = b & 4 ? bus[out].concat(n) : [n]; else carriers.push(n);
    if (b & 0x40) fbIn = n;
    if (b & 0x80) fbOut = n;
  }
  const target = {};
  for (const [s, t] of edges) (target[s] ||= []).push(t);
  const level = {};
  const lv = (n) => (level[n] ??= carriers.includes(n) ? 0 : 1 + Math.max(0, ...(target[n] || []).map(lv)));
  for (let n = 1; n <= 6; n++) lv(n);
  const maxL = Math.max(...Object.values(level)), x = {};
  const rows = [];
  for (let l = 0; l <= maxL; l++) rows.push([1, 2, 3, 4, 5, 6].filter((n) => level[n] === l));
  rows[0].sort((p, q) => p - q).forEach((n, k) => { x[n] = k; });
  for (let l = 1; l <= maxL; l++) {
    const want = rows[l].map((n) => [n, (target[n] || []).reduce((s, t) => s + (x[t] ?? 0), 0) / Math.max(1, (target[n] || []).length)]).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    let last = -Infinity;
    for (const [n, w] of want) { x[n] = Math.max(w, last + 1); last = x[n]; }
  }
  return { edges, carriers, level, x, maxL, fbIn, fbOut };
}

function algSvg(FM6, a, { size = 40, selected = 0, onPick = null, mini = false } = {}) {
  const L = algLayout(FM6, a), gx = size * 1.45, gy = size * 1.5, pad = size * 0.8;
  const xs = Object.values(L.x), minX = Math.min(...xs), maxX = Math.max(...xs);
  const W = (maxX - minX) * gx + size + pad * 2, H = (L.maxL + 1) * gy + (mini ? size * .3 : size * .9) + pad * .5;
  const px = (n) => pad + size / 2 + (L.x[n] - minX) * gx, py = (n) => pad * .4 + size / 2 + (L.maxL - L.level[n]) * gy;
  const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", `0 0 ${W} ${H}`); s.setAttribute("class", "alg" + (mini ? " mini" : ""));
  const add = (tag, at, text) => { const e = document.createElementNS(ns, tag); for (const k in at) e.setAttribute(k, at[k]); if (text != null) e.textContent = text; s.append(e); return e; };
  for (const [from, to] of L.edges) add("line", { x1: px(from), y1: py(from) + size / 2, x2: px(to), y2: py(to) - size / 2, class: "edge" });
  const outY = H - (mini ? size * .25 : size * .55);
  for (const n of L.carriers) add("line", { x1: px(n), y1: py(n) + size / 2, x2: px(n), y2: outY, class: "edge out" });
  if (!mini) add("text", { x: W / 2, y: H - 3, class: "outlab", "text-anchor": "middle" }, "OUT");
  add("line", { x1: Math.min(...L.carriers.map(px)) - size * .4, x2: Math.max(...L.carriers.map(px)) + size * .4, y1: outY, y2: outY, class: "edge out bar" });
  if (L.fbOut) {
    const a1 = L.fbOut, b1 = L.fbIn || L.fbOut;
    if (a1 === b1) add("path", { d: `M${px(a1) + size / 2} ${py(a1) - size * .2} h${size * .35} v${-size * .55} h${-size * .85} v${size * .35}`, class: "fb" });
    else add("path", { d: `M${px(a1) + size / 2} ${py(a1)} h${size * .4} V${py(b1) - size * .8} H${px(b1)} V${py(b1) - size / 2}`, class: "fb" });
  }
  for (let n = 1; n <= 6; n++) {
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "node" + (L.carriers.includes(n) ? " car" : "") + (n === selected ? " sel" : ""));
    if (onPick) { g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); g.setAttribute("aria-label", `Operator ${n}${L.carriers.includes(n) ? ", sounds directly" : ", shapes another operator"}`); g.addEventListener("click", () => onPick(n)); g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(n); } }); }
    const r = document.createElementNS(ns, "rect");
    for (const [k, v] of Object.entries({ x: px(n) - size / 2, y: py(n) - size / 2, width: size, height: size })) r.setAttribute(k, v);
    const t = document.createElementNS(ns, "text");
    for (const [k, v] of Object.entries({ x: px(n), y: py(n) + size * .16, "text-anchor": "middle" })) t.setAttribute(k, v);
    t.textContent = String(n);
    g.append(r, t); s.append(g);
  }
  return s;
}

/* ------------------------------------------------------------ an envelope you drag --- */
/* rates (speed, 99 fastest) and levels of four points; the voice's pitch envelope is the same shape around level 50.
   Dots 1-3 are where the sound goes after the key goes down, the last is where it goes after release. */
function envGraph({ V, rIdx, lIdx, set, center = false, label }) {
  const W = 380, H = 140, T = 12, B = 12, X0 = 12, hold = 34;
  const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", `0 0 ${W} ${H}`); s.setAttribute("class", "env"); s.setAttribute("role", "group"); s.setAttribute("aria-label", label);
  const yOf = (l) => T + (99 - l) / 99 * (H - T - B), lOf = (y) => Math.max(0, Math.min(99, Math.round((H - B - y) / (H - T - B) * 99)));
  const wOf = (r) => 14 + (99 - r) * 0.6, rOf = (w) => Math.max(0, Math.min(99, Math.round(99 - (w - 14) / 0.6)));
  const dot = [];
  function pts() {
    const p = [{ x: X0, y: yOf(V[lIdx + 3]) }];
    let x = X0;
    for (let k = 0; k < 3; k++) { x += wOf(V[rIdx + k]); p.push({ x, y: yOf(V[lIdx + k]) }); }
    p.push({ x: x + hold, y: p[3].y });
    x += hold + wOf(V[rIdx + 3]);
    p.push({ x, y: yOf(V[lIdx + 3]) });
    return p;
  }
  function draw() {
    s.replaceChildren(); dot.length = 0;
    const add = (tag, at) => { const e = document.createElementNS(ns, tag); for (const k in at) e.setAttribute(k, at[k]); s.append(e); return e; };
    if (center) add("line", { x1: 0, x2: W, y1: yOf(50), y2: yOf(50), class: "mid" });
    const p = pts();
    add("polyline", { points: p.map((q) => `${q.x},${q.y}`).join(" "), class: "curve" });
    add("line", { x1: p[3].x, x2: p[4].x, y1: p[3].y, y2: p[3].y, class: "curve hold" });
    for (const k of [1, 2, 3, 5]) {
      const idx = k === 5 ? 3 : k - 1, q = p[k];
      const g = add("circle", { cx: q.x, cy: q.y, r: 13, class: "dot", tabindex: 0, role: "slider", "aria-label": `${label}, point ${idx + 1}: level ${V[lIdx + idx]}, speed ${V[rIdx + idx]}`, "aria-valuenow": V[lIdx + idx] });
      g.addEventListener("keydown", (e) => {
        const d = { ArrowUp: [0, 3], ArrowDown: [0, -3], ArrowLeft: [-3, 0], ArrowRight: [3, 0] }[e.key];
        if (!d) return; e.preventDefault();
        set(lIdx + idx, V[lIdx + idx] + d[1]); set(rIdx + idx, V[rIdx + idx] + d[0]); draw(); s.querySelectorAll(".dot")[[1, 2, 3, 5].indexOf(k)].focus();
      });
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault(); g.setPointerCapture(e.pointerId);
        const prevX = () => (k === 5 ? pts()[4].x : pts()[k - 1].x);
        const px0 = prevX();
        const move = (ev) => {
          const m = s.getScreenCTM().inverse(), pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
          set(lIdx + idx, lOf(pt.y));
          set(rIdx + idx, rOf(Math.max(0, pt.x - px0)));
          const cur = s.querySelector(".dot.hot"); const q = pts()[k];
          draw(); s.querySelectorAll(".dot")[[1, 2, 3, 5].indexOf(k)].classList.add("hot");
        };
        const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up); };
        g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
      });
    }
  }
  draw();
  return s;
}

/* ------------------------------------------------------------ the screen --- */
export function Fm6Screen(ctx) {
  const root = el("section", { class: "fm6" });
  const st = { t: -1, V: null, op: 1, tab: "op", more: false, sheet: null, imported: [], ipage: 0, names: null, timer: null, live: true, state: "idle" };
  const d = () => ctx.dev();
  const FM6 = () => d().A.FM6;

  /* the engine editor of an FM6 track: Sound hosts it and says which track */
  async function open(t) {
    if (t != null) st.t = t;
    if (!d().hasFm6 || d().tracks[st.t]?.engineName !== "FM6") { st.t = -1; render(); return; }
    st.V = null;
    await load(st.t);
  }
  async function load(t) {
    st.t = t; st.state = "reading"; render();
    try {
      st.V = await d().fm6Read(FM6().TARGET.TRACK, t); st.state = "idle";
      d().fm6Names().then((n) => { st.names = n; if (st.sheet === "patches") render(); }).catch(() => {});
    } catch (e) { st.state = "error"; ctx.say(e.message, "error"); }
    render();
  }
  function set(i, v) {
    st.V[i] = Math.max(0, Math.min(FM6().max(i), Math.round(+v || 0)));
    if (!st.live) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(send, 120);
  }
  async function send() {
    try { await d().fm6Write(st.t, st.V); } catch (e) { ctx.say(e.message, "error"); }
  }
  const slider = (label, i, { min = 0, fmt = String, hint } = {}) => {
    const out = el("output", { text: fmt(st.V[i]) });
    const inp = el("input", { type: "range", min, max: FM6().max(i), value: st.V[i], "aria-label": label,
      oninput: (e) => { set(i, +e.target.value); out.textContent = fmt(st.V[i]); } });
    return el("div", { class: "field inline", title: hint || null }, el("span", { class: "nm", text: label }), inp, out);
  };
  const seg = (label, items, i, after) => el("div", { class: "field " + (items.length <= 4 ? "inline" : "") },
    el("span", { class: "nm", text: label }),
    el("div", { class: "seg", role: "group", "aria-label": label }, items.map((text, k) =>
      el("button", { "aria-pressed": String(st.V[i] === k), text, onclick: () => { set(i, k); (after || render)(); } }))));
  const toggle = (label, i, hint) => el("button", { class: "switch", role: "switch", title: hint || null, "aria-checked": String(!!st.V[i]), onclick: () => { set(i, st.V[i] ? 0 : 1); render(); } },
    el("span", { class: "tr" }), el("span", { text: label }));

  function head() {
    const V = st.V;
    const name = el("input", { type: "text", class: "nm", maxlength: 10, value: FM6().name(V), "aria-label": "Patch name", spellcheck: "false",
      onchange: (e) => { FM6().setName(V, e.target.value); set(0, V[0]); e.target.value = FM6().name(V); } });
    return el("div", { class: "fhead" },
      name,
      el("button", { class: "btn", onclick: () => { st.sheet = st.sheet === "patches" ? null : "patches"; render(); } }, "Patches"),
      el("button", { class: "btn", "aria-label": "Import SysEx file", onclick: () => file.click() }, "Import"),
      el("button", { class: "btn", onclick: exportSyx }, "Export"),
      el("button", { class: "switch", role: "switch", "aria-checked": String(st.live), onclick: () => { st.live = !st.live; if (st.live) send(); render(); } },
        el("span", { class: "tr" }), el("span", {}, "Live", el("small", { class: "sub", text: st.live ? "sounds as you edit" : "tap Send" }))),
      st.live ? null : el("button", { class: "btn red", onclick: send }, "Send"));
  }

  function algCard() {
    const V = st.V, vi = FM6().VI, a = V[vi.ALG], L = algLayout(FM6(), a);
    const card = el("div", { class: "card alg-card" },
      el("div", { class: "lab" }, el("span", { text: "Algorithm" }), el("output", { text: `${a + 1} of 32` })),
      algSvg(FM6(), a, { size: 40, selected: st.op, onPick: (n) => { st.op = n; st.tab = "op"; render(); } }),
      el("p", { class: "hint", text: "Operators on the bottom row make the sound. The ones above shape them. Tap one to edit it." }),
      el("div", { class: "row" },
        el("button", { class: "btn", "aria-label": "Previous algorithm", onclick: () => { set(vi.ALG, (a + 31) % 32); render(); } }, ic("left")),
        el("button", { class: "btn grow", "aria-expanded": String(st.sheet === "algs"), onclick: () => { st.sheet = st.sheet === "algs" ? null : "algs"; render(); } }, "Choose a shape"),
        el("button", { class: "btn", "aria-label": "Next algorithm", onclick: () => { set(vi.ALG, (a + 1) % 32); render(); } }, ic("right"))));
    return card;
  }

  function opTabs() {
    const car = algLayout(FM6(), st.V[FM6().VI.ALG]).carriers;
    return el("div", { class: "seg optabs", role: "tablist" },
      [1, 2, 3, 4, 5, 6].map((n) => el("button", { role: "tab", "aria-selected": String(st.tab === "op" && st.op === n), "aria-pressed": String(st.tab === "op" && st.op === n),
        onclick: () => { st.tab = "op"; st.op = n; render(); } }, `Op ${n}`, car.includes(n) ? el("i", { class: "dotmark", title: "sounds directly" }) : null)),
      el("button", { role: "tab", "aria-selected": String(st.tab === "voice"), "aria-pressed": String(st.tab === "voice"), onclick: () => { st.tab = "voice"; render(); } }, "Voice"));
  }

  function opPanel() {
    const V = st.V, n = st.op, at = (f) => FM6().at(n, f), fixed = !!V[at("MODE")];
    const car = algLayout(FM6(), V[FM6().VI.ALG]).carriers.includes(n);
    const detFmt = (v) => (v === 7 ? "0" : v > 7 ? "+" + (v - 7) : String(v - 7));
    return el("div", { class: "opgrid" },
      el("div", { class: "col" },
        el("div", { class: "card" },
          el("div", { class: "lab" }, el("span", { text: "Pitch" }), el("output", { text: FM6().freqText(V, n) })),
          seg("Mode", ["Keys", "Fixed"], at("MODE")),
          fixed ? seg("Range", ["1 Hz", "10 Hz", "100 Hz", "1 kHz"], at("FC"), () => { V[at("FC")] &= 3; render(); }) : slider("Multiple", at("FC"), { fmt: (v) => (v ? "x" + v : "x0.5") }),
          slider("Fine", at("FF")), slider("Detune", at("DET"), { fmt: detFmt })),
        el("div", { class: "card" },
          el("div", { class: "lab", text: "Touch" }),
          slider("Velocity", at("KVS"), { hint: "How much key velocity changes the level." }),
          slider("Key rate", at("RS"), { hint: "High notes: envelope speed rises with the pitch." }),
          seg("Tremolo", ["Off", "Lo", "Mid", "Hi"], at("AMS")),
          )),
      el("div", { class: "card" },
        el("div", { class: "lab" }, el("span", { text: car ? `Operator ${n}: heard directly` : `Operator ${n}: shapes others` })),
        slider("Level", at("OL"), { hint: car ? "How loud this operator is." : "How strongly it bends the operators it feeds." }),
        el("div", { class: "lab", text: "Level over time" }),
        envGraph({ V, rIdx: at("R1"), lIdx: at("L1"), set, label: `Operator ${n} envelope` }),
        el("p", { class: "hint", text: "Drag a dot: up and down sets the level, left and right sets the speed. The last dot is where it fades after you let go." }),
        el("button", { class: "more", onclick: () => { st.sheet = "scaling"; render(); } }, el("span", { text: "Keyboard level scaling" }), ic("right"))));
  }

  function voicePanel() {
    const V = st.V, vi = FM6().VI, fbOp = FM6().feedbackOp(V[vi.ALG]);
    return el("div", { class: "opgrid" },
      el("div", { class: "col" },
        el("div", { class: "card" },
          el("div", { class: "lab", text: "Body" }),
          slider("Feedback", vi.FB, { hint: fbOp ? `Operator ${fbOp} feeds itself: more is brighter and buzzier.` : "" }),
          slider("Transpose", vi.TRNSP, { fmt: (v) => (v - 24 > 0 ? "+" : "") + (v - 24) }),
          toggle("Restart oscillators on each key", vi.OKS, "Off lets the phase run free")),
        el("div", { class: "card" },
          el("div", { class: "lab", text: "Pitch over time" }),
          envGraph({ V, rIdx: vi.PR1, lIdx: vi.PL1, set, center: true, label: "Pitch envelope" }),
          el("p", { class: "hint", text: "The middle line is the note you play. Above it bends sharp, below flat." }))),
      el("div", { class: "card" },
        el("div", { class: "lab", text: "Vibrato and tremolo (LFO)" }),
        seg("Shape", ["Tri", "Saw-", "Saw+", "Sqr", "Sin", "S&H"], vi.LFW),
        slider("Speed", vi.LFS), slider("Delay", vi.LFD, { hint: "Time before the LFO starts." }),
        slider("Vibrato", vi.LPMD, { hint: "Pitch wobble depth." }), slider("Vib. range", vi.LPMS, { hint: "Pitch sensitivity." }),
        slider("Tremolo", vi.LAMD, { hint: "Volume wobble depth; each operator chooses how much to follow it." }),
        toggle("Restart on each key", vi.LKS)));
  }

  const sheetHead = (title) => el("div", { class: "sheethead" }, el("b", { text: title }), el("button", { class: "btn", "aria-label": "Close", onclick: () => { st.sheet = null; render(); } }, ic("close")));
  function sheet() {
    if (st.sheet === "algs") {
      const a = st.V[FM6().VI.ALG];
      return el("div", { class: "sheet", role: "dialog", "aria-label": "Choose an algorithm" }, sheetHead("Algorithms"),
        el("div", { class: "algs" }, Array.from({ length: 32 }, (_, k) => el("button", { class: "algbtn", "aria-pressed": String(k === a), "aria-label": `Algorithm ${k + 1}`,
          onclick: () => { set(FM6().VI.ALG, k); st.sheet = null; render(); } }, algSvg(FM6(), k, { size: 20, mini: true }), el("span", { text: String(k + 1) })))));
    }
    if (st.sheet === "scaling") {
      const n = st.op, at = (f) => FM6().at(n, f);
      return el("div", { class: "sheet", role: "dialog", "aria-label": "Keyboard level scaling" }, sheetHead(`Operator ${n}: keyboard level scaling`),
        slider("Split note", at("BP"), { fmt: (v) => d().A.noteName(v + 21) }),
        slider("Left depth", at("LD")), seg("Left curve", CURVES, at("LC")),
        slider("Right depth", at("RD")), seg("Right curve", CURVES, at("RC")),
        el("p", { class: "hint", text: "Makes this operator quieter or louder away from the split note." }));
    }
    if (st.sheet === "patches") {
      const n = d().info.fm6.factory, per = 12, pages = Math.max(1, Math.ceil(st.imported.length / per)), ip = Math.min(st.ipage, pages - 1);
      return el("div", { class: "sheet", role: "dialog", "aria-label": "Patches" }, sheetHead("Patches"),
        el("div", { class: "plist" }, Array.from({ length: n }, (_, k) => {
          const x = st.names && st.names.slots && st.names.slots[k];
          return el("button", { class: "btn", onclick: async () => { try { st.V = await d().fm6Read(FM6().TARGET.FACTORY, k); if (st.live) send(); st.sheet = null; render(); } catch (e) { ctx.say(e.message, "error"); } } },
            el("b", { text: "F" + (k + 1) }), x && x.used ? x.name : "");
        }), el("button", { class: "btn", onclick: () => { st.V = FM6().init(); if (st.live) send(); st.sheet = null; render(); } }, "Plain voice")),
        st.imported.length ? el("div", { class: "plist" }, st.imported.slice(ip * per, ip * per + per).map((x, k) => el("button", { class: "btn", onclick: () => { st.V = Uint8Array.from(x.v); if (st.live) send(); st.sheet = null; render(); } }, el("b", { text: String(ip * per + k + 1) }), x.name || "(no name)"))) : null,
        pages > 1 ? el("div", { class: "pager" },
          el("button", { "aria-label": "Previous voices", onclick: () => { st.ipage = Math.max(0, ip - 1); render(); } }, ic("left")),
          el("output", { text: `File voices ${ip + 1} / ${pages}` }),
          el("button", { "aria-label": "Next voices", onclick: () => { st.ipage = Math.min(pages - 1, ip + 1); render(); } }, ic("right"))) : null);
    }
    return null;
  }

  const file = el("input", { type: "file", accept: ".syx,.SYX,.bin,application/octet-stream", hidden: true });
  file.addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const r = FM6().parseSysex(new Uint8Array(await f.arrayBuffer()));
    if (!r.voices.length) { ctx.say("No six-operator voice in " + f.name, "error"); return; }
    st.imported = r.voices;
    if (r.voices.length === 1) { st.V = Uint8Array.from(r.voices[0].v); if (st.live) send(); st.sheet = null; ctx.say("Imported " + r.voices[0].name); } else { st.sheet = "patches"; ctx.say(`${r.voices.length} voices in ${f.name}: pick one`); }
    render();
  });
  function exportSyx() {
    const bytes = FM6().singleSysex(st.V), a = el("a", { href: URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" })), download: (FM6().name(st.V) || "patch").trim().replace(/\s+/g, "-") + ".syx" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function render() {
    root.replaceChildren();
    if (!d()) return;
    if (!d().hasFm6) { root.append(el("div", { class: "empty" }, el("h2", { text: "No FM6 on this firmware" }), el("p", { text: "This machine's firmware does not report the FM6 engine." }))); return; }
    if (st.t < 0) { root.append(el("div", { class: "empty" }, el("p", { text: "This track does not use the FM6 engine." }))); return; }
    if (!st.V) { root.append(el("div", { class: "empty" }, el("p", { text: st.state === "error" ? "Could not read the patch." : "Reading the patch..." }))); return; }
    root.append(...[head(), el("div", { class: "fbody" }, el("div", { class: "fleft" }, algCard()), el("div", { class: "fright" }, opTabs(), st.tab === "op" ? opPanel() : voicePanel())), sheet(), file].filter(Boolean));
  }
  return { el: root, open, render, leave() { clearTimeout(st.timer); if (st.live && st.timer) send(); } };
}
