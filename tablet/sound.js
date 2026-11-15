// Sound screen: the parameters of one track's sound, grouped the way the machine groups them, one group per tab.
// Engine and preset are chosen from sheets. Nothing scrolls: each tab holds at most a screenful.

import { el, ic, own, repaint, idle } from "./ui.js";
import { Fm6Screen } from "./fm6.js";
import { accident } from "./tools.js";
import { Ext, KRST } from "./ext.js";

/* the machine's own short tags, spelled out where the meaning is certain; anything else keeps its tag */
const WORDS = { CUT: "Cutoff", RES: "Resonance", DRV: "Drive", KTR: "Key track", DTN: "Detune", ATK: "Attack", DEC: "Decay", SUS: "Sustain", REL: "Release", FDBK: "Feedback", NOIS: "Noise" };
const LANE_IDS = [83, 84, 85, 86, 87, 88, 89, 90];

function tabsFor(d, t) {
  const pe0 = d.info.pe0, eng = d.tracks[t].engineName, ti = (d.titles && d.titles[d.tracks[t].engine]) || [];
  const P = (ids) => ids.map((id) => [0, id]), Q = (ids) => P(ids.filter((id) => id < pe0)), G = (ids) => ids.map((id) => [1, id]);
  const tabs = [
    ...(eng === "FM6" && d.hasFm6 ? [{ k: "fm6", label: "FM6 voice", fm6: true }] : []),
    { k: "tone", label: "Tone", cards: [{ title: ti[0] || "Edit 1", ids: P([pe0, pe0 + 1, pe0 + 2, pe0 + 3]) }, { title: ti[1] || "Edit 2", ids: P([pe0 + 4, pe0 + 5, pe0 + 6, pe0 + 7]) },
      ...(pe0 >= 91 && eng === "DRUM" ? [{ title: "Lanes", ids: P(LANE_IDS.slice(0, 4)) }, { title: "Lanes 2", ids: P(LANE_IDS.slice(4)) }] : [])] },
    ...(eng === "SLICE" && (d.tags.krst & KRST.SLICE) ? [{ k: "slices", label: "Slices", slices: true }] : []),
    { k: "env", label: "Envelope", cards: [{ title: "Envelope", ids: P([1, 2, 3, 4]) }, { title: "Envelope to", ids: P([5, 6, 7, 8]) }, { title: "Filter and timing", ids: Q([101, 102]) }] },
    { k: "lfo", label: "LFO", cards: [{ title: "LFO", ids: P([9, 10, 11, 12]) }, { title: "LFO to", ids: P([13, 14, 15, 16]) }, { title: "LFO sync", ids: Q([91, 92, 93]) }] },
    { k: "voice", label: "Voice", cards: [{ title: "Level and voice", ids: P([0, 37, 38, 41, 42]) }, { title: "Voice 2", ids: P([43, 44, 39, 40]) }, { title: "Spread and timing", ids: Q([95, 94]) }, { title: "Aftertouch", ids: Q([103, 104, 105]) }] },
    { k: "fx", label: "Effects", cards: [{ title: "Effect", ids: P([33, 34, 35, 36]) }, { title: "Slicer", ids: P([45, 46, 47, 48]) }, { title: "Insert", ids: Q([96, 97, 98, 99, 100]) }] },
    { k: "space", label: "Space", cards: [{ title: "Delay", ids: G([4, 5, 6, 7]), col: 0 }, { title: "Reverb", ids: G([24, 8, 9]), col: 1 }, { title: "Chorus", ids: G([10, 11]), col: 0 }, { title: "Damage", ids: [...G([25, 26, 21]), ...((d.tags.krst & KRST.HISS) ? G([d.info.gcount]) : [])], col: 1 }] },
    { k: "scale", label: "Scale", cards: [{ title: "Scale", ids: P([25, 26, 27, 28]) }, ...(pe0 >= 83 ? [{ title: "Chord", ids: P([81, 82]) }] : [])] },
    { k: "arp", label: "Arp", cards: [{ title: "Arp", ids: P([17, 18, 19, 20]) }, { title: "Arp 2", ids: P([21, 22, 23, 24]) }] },
  ];
  if (pe0 >= 81 && eng === "DIGITAL") tabs.push({ k: "ops", label: "Operators", cards: [0, 1, 2, 3].map((k) => ({ title: "Operator " + (k + 1), ids: Q([61 + 5 * k, 62 + 5 * k, 63 + 5 * k, 64 + 5 * k, 65 + 5 * k]) })) });
  if (pe0 >= 61) tabs.push({ k: "mod", label: "Mod", mod: 49 });
  tabs.push({ k: "global", label: "Global", cards: [{ title: "Clock and tuning", ids: G([0, 1, 2, 3]) }, { title: "MIDI", ids: G([14]) }] });
  return tabs;
}

export function SoundScreen(ctx) {
  const root = el("section", { class: "sound" });
  const st = { t: 0, tab: "tone", vals: {}, sheet: null, page: 0, loading: false, pend: {}, token: 0, favs: {}, favOnly: false };
  const d = () => ctx.dev();
  const A = () => d().A;
  const fm6 = Fm6Screen(ctx);   /* the FM6 engine's own editor: it is the first tab of an FM6 track */
  const first = () => { st.tab = tabsFor(d(), st.t)[0].k; };
  const vkey = (s, id) => (s ? "g" : st.t + ":") + id;
  const visible = (x) => x && x.max > x.min && x.label !== "-";

  /* a knob turned on the machine: the control shows it (the push says the track's engine parameter or the global that changed) */
  let shown = false;
  function onParam(s, t, id, v) {
    if (!shown || (s === 0 && t !== st.t)) return;
    if (st.loading) { st.pend[vkey(s, id)] = v; return; }          /* (still reading: it may have read the old value; applied when the read ends) */
    if (!((vkey(s, id)) in st.vals) || st.vals[vkey(s, id)] === v) return;
    st.vals[vkey(s, id)] = v;
    idle("sound", render);
  }
  d().on("param", onParam);
  /* the machine loaded another preset or project (RELOAD), or its engine changed: read this track again */
  d().on("reloaded", () => { if (shown && !st.loading) idle("sound-reload", () => { if (shown && !st.loading) pick(Math.min(st.t, d().ntrk - 1)); }); });

  async function open(t) {
    shown = true;
    if (t != null) st.t = t;
    st.t = Math.min(st.t, d().ntrk - 1);
    await d().readNames(d().tracks[st.t].engine);
    first(); st.vals = {}; await showTab();
  }
  async function pick(t) { fm6.leave(); st.t = t; st.sheet = null; st.vals = {}; await d().readNames(d().tracks[t].engine); first(); await showTab(); }

  function ids() {
    const tab = tabsFor(d(), st.t).find((x) => x.k === st.tab) || tabsFor(d(), st.t)[0];
    st.tab = tab.k;
    return { tab, list: tab.mod != null ? Array.from({ length: 12 }, (_, i) => [0, tab.mod + i]).concat(Array.from({ length: 8 }, (_, i) => [0, d().info.pe0 + i])) : (tab.cards || []).flatMap((c) => c.ids) };
  }
  async function showTab() {
    const token = ++st.token;
    fm6.leave();
    const { tab, list } = ids();
    if (tab.fm6) { st.loading = false; render(); fm6.open(st.t); return; }
    if (tab.slices) { st.loading = false; render(); await loadSlices(token); return; }
    st.loading = true; st.pend = {}; render();
    try {
      await Promise.all(list.map(([s, id]) => d().describe(s, id, st.t)));
      for (const [s, id] of list) {
        const x = await d().describe(s, id, st.t);
        if (!visible(x) || vkey(s, id) in st.vals) continue;
        st.vals[vkey(s, id)] = s ? await d().getGlobal(id) : await d().getParam(st.t, id);
        if (token !== st.token) return;
      }
    } catch (e) { ctx.say(e.message, "error"); }
    if (token !== st.token) return;
    for (const k in st.pend) if (k in st.vals) st.vals[k] = st.pend[k];
    st.pend = {};
    st.loading = false; render();
  }

  const cached = (s, id) => d().cachedDesc(s, id, st.t);
  const text = (x, v) => { const [txt, unit] = A().fmtValue(x, v); return modName(x, txt) + (unit ? " " + unit : ""); };
  /* a matrix destination E1..E8 by the engine's own label of that parameter */
  function modName(x, txt) {
    const m = x && /^DST\d$/.test(x.label) && /^E([1-8])$/.exec(txt);
    const e = m && cached(0, d().info.pe0 + +m[1] - 1);
    return e && visible(e) ? e.label : txt;
  }
  function setVal(s, id, v) {
    st.vals[vkey(s, id)] = v;
    (s ? d().setGlobal(id, v) : d().setParam(st.t, id, v)).then((r) => { if (r != null) st.vals[vkey(s, id)] = r; }).catch((e) => ctx.say(e.message, "error"));
  }
  const options = (x) => A().enumShown(x);

  function row(s, id, compact) {
    const x = cached(s, id);
    if (!visible(x)) return null;
    const v = st.vals[vkey(s, id)] ?? x.def;
    if (x.fmt === A().F.ENUM || x.fmt === A().F.NOTE || x.fmt === A().F.ONOFF) {
      const opts = options(x);
      if (opts.length <= 3) return el("div", { class: "field inline" }, el("span", { class: "nm", title: x.label, text: WORDS[x.label] || x.label }),
        el("div", { class: "seg", role: "group", "aria-label": x.label }, opts.map((o) => el("button", { "aria-pressed": String(v === o), text: text(x, o), onclick: () => { setVal(s, id, o); render(); } }))));
      return el("div", { class: "field inline" }, el("span", { class: "nm", title: x.label, text: WORDS[x.label] || x.label }),
        el("button", { class: "pickbtn", "aria-label": `${x.label}: ${text(x, v)}`, onclick: () => { st.sheet = { s, id }; render(); } }, el("span", { text: text(x, v) }), ic("down")));
    }
    const out = el("output", { text: text(x, v) });
    const inp = el("input", { type: "range", min: x.min, max: x.max, step: 1, value: v, "aria-label": WORDS[x.label] || x.label,
      oninput: (e) => { out.textContent = text(x, +e.target.value); setVal(s, id, +e.target.value); },
      ondblclick: () => { inp.value = x.def; out.textContent = text(x, x.def); setVal(s, id, x.def); } });
    return el("div", { class: "field inline" + (compact ? " compact" : ""), }, el("span", { class: "nm", title: x.label, text: WORDS[x.label] || x.label }), inp, out);
  }

  /* favourites (FAV_GET / FAV_SET) and the machine's preset filter (UI_SET 3) */
  const canFav = () => !!(d().info.uiCaps & 8);
  async function loadFavs(engine) {
    if (!canFav()) return;
    const { CMD, req, parse } = A(), n = (d().names[engine] || []).length, out = [];
    try {
      for (let s0 = 0; s0 < n; s0 += 32) { const r = parse[CMD.FAV_GET](await d().rq(req.favGet(engine, s0, Math.min(32, n - s0)))); if (r.rc) break; out.push(...r.values); }
      st.favs[engine] = out; render();
    } catch (e) { /* favourites are optional */ }
  }
  async function toggleFav(engine, preset) {
    const { CMD, req, parse } = A(), cur = !!(st.favs[engine] || [])[preset];
    try {
      const r = parse[CMD.FAV_SET](await d().rq(req.favSet(engine, preset, !cur)));
      if (r.rc === 0 || r.rc === 3 || r.rc === 4) { (st.favs[engine] ||= [])[preset] = r.on; if (r.rc === 3) ctx.say("Favourite kept until power-off: the machine could not save it."); }
      else ctx.say("The machine did not take the favourite (code " + r.rc + ")", "error");
    } catch (e) { ctx.say(e.message, "error"); }
    render();
  }
  async function setFilter(on) {
    st.favOnly = on; st.page = 0; render();
    try { if (canFav()) await d().rq(A().req.uiSet(3, on ? 1 : 0)); } catch (e) { /* the filter is local too */ }
  }

  function head() {
    const tr = d().tracks[st.t];
    return el("div", { class: "fhead" },
      el("div", { class: "seg", role: "group", "aria-label": "Track" }, Array.from({ length: d().ntrk }, (_, t) =>
        el("button", { "aria-pressed": String(t === st.t), onclick: () => pick(t) }, el("b", { text: String(t + 1) }), " ", d().tracks[t].name))),
      el("button", { class: "btn", onclick: () => { st.sheet = { engine: true }; st.page = 0; render(); } }, el("span", { class: "dim", text: "Engine" }), el("b", { text: tr.engineName || "-" })),
      el("button", { class: "btn", onclick: () => { st.sheet = { presets: true }; st.page = Math.floor(tr.preset / 12); render(); loadFavs(tr.engine); } }, el("span", { class: "dim", text: "Sound" }), el("b", { text: tr.name })),
      el("button", { class: "btn", title: "Happy accident: moves two or three engine values a little", onclick: oops }, "Oops"));
  }

  /* the machine's happy accident (EDIT held + G5): a few of the engine's eight values nudged, now and then an FX send */
  async function oops() {
    const t = st.t, pe0 = d().info.pe0;
    try {
      const get = async (id) => { const x = await d().describe(0, id, st.t); return visible(x) ? { id, min: x.min, max: x.max, label: x.label, choice: x.fmt === A().F.ENUM || !!(x.names && x.names.length), value: await d().getParam(t, id) } : null; };
      const eng = []; for (let k = 0; k < 8; k++) eng.push(await get(pe0 + k));
      const sends = []; for (const id of [33, 34, 35, 36]) sends.push(await get(id));
      const r = accident(eng, sends.map((s) => s || { id: 0, min: 0, max: 0, value: 0, label: "" }).filter((s) => s.max > s.min));
      for (const c of r.changes) { await d().setParam(t, c.id, c.to); st.vals[vkey(0, c.id)] = c.to; }
      ctx.say(r.msg); render();
    } catch (e) { ctx.say(e.message, "error"); }
  }

  /* ---- SLICE: the slice starts by hand (the machine's SLICES page): a table of starts, in samples, of a user sample ---- */
  const SLC_MIN = 64, SLC_AUTO = 32, SLC_DIV_MAN = 5;
  async function loadSlices(token) {
    const sl = (st.sl = { slot: null, data: null, sel: 0, step: 512, err: "" });
    try {
      const src = await d().getParam(st.t, d().info.pe0);
      if (token !== st.token) return;
      if (src >= 1 && src <= 3) { sl.slot = src - 1; sl.data = await Ext.slice(d(), sl.slot); sl.sel = 0; }
    } catch (e) { sl.err = e.message; ctx.say(e.message, "error"); }
    if (token === st.token) render();
  }
  async function putSlices(pos, end) {
    const sl = st.sl;
    try {
      const r = await Ext.slice(d(), sl.slot, { pos, end });
      if (r.rc === 2) { ctx.say("Those slice starts do not fit the sample: each slice needs at least " + SLC_MIN + " samples.", "error"); return; }
      sl.data = r;
      const e = d().info.pe0 + 1;                                   /* the slices only play with DIV set to MAN */
      if ((await d().getParam(st.t, e)) !== SLC_DIV_MAN) { await d().setParam(st.t, e, SLC_DIV_MAN); st.vals[vkey(0, e)] = SLC_DIV_MAN; ctx.say("DIV is now MAN: the machine plays your slices"); }
    } catch (x) { ctx.say(x.message, "error"); }
    render();
  }
  function slicesEl() {
    const sl = st.sl;
    if (!sl) return el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    if (sl.err) return el("div", { class: "empty" }, el("p", { text: "Could not read the slices: " + sl.err }));
    if (sl.slot == null) return el("div", { class: "empty" }, el("h2", { text: "Pick a user sample" }), el("p", { text: "Slice points are set on a sample you uploaded. Choose USR1, USR2 or USR3 as the SRC of this sound (Tone group)." }));
    const D = sl.data;
    if (D.rc === 1) return el("div", { class: "empty" }, el("h2", { text: "USR" + (sl.slot + 1) + " is empty" }), el("p", { text: "Upload a sample to this slot first." }));
    const n = D.pos.length, j = Math.min(sl.sel, n - 1), e = D.end || D.len, pos = D.pos;
    const lo = j ? pos[j - 1] + SLC_MIN : 0, hi = (j + 1 < n ? pos[j + 1] : e) - SLC_MIN;
    const len = (k) => (k + 1 < n ? pos[k + 1] : e) - pos[k];
    const set = (v) => { const p = [...pos]; p[j] = Math.max(lo, Math.min(hi, v)); putSlices(p, D.end); };
    const chips = el("div", { class: "chips", role: "group", "aria-label": "Slices" }, pos.map((_, k) => el("button", { class: "chip", "aria-pressed": String(k === j), text: String(k + 1), onclick: () => { sl.sel = k; render(); } })));
    const bar = el("div", { class: "slbar", role: "img", "aria-label": n + " slices over " + D.len + " samples" },
      pos.map((p, k) => el("button", { class: "seg-slice" + (k === j ? " on" : ""), style: "left:" + (p / D.len) * 100 + "%;width:" + (len(k) / D.len) * 100 + "%", "aria-label": "Slice " + (k + 1), onclick: () => { sl.sel = k; render(); } })));
    const stepSeg = el("div", { class: "seg", role: "group", "aria-label": "Step size" }, [64, 512, 4096].map((s) => el("button", { "aria-pressed": String(sl.step === s), text: s + " samples", onclick: () => { sl.step = s; render(); } })));
    const slider = el("input", { type: "range", min: lo, max: Math.max(lo, hi), step: 1, value: pos[j], "aria-label": "Start of slice " + (j + 1), disabled: hi < lo, onchange: (ev) => set(+ev.target.value) });
    const out = el("output", { text: pos[j] + " (" + Math.round((pos[j] / D.len) * 100) + "%)" });
    own(slider).addEventListener("input", () => { out.textContent = slider.value + " (" + Math.round((slider.value / D.len) * 100) + "%)"; });
    return el("div", { class: "slices" },
      el("div", { class: "card" }, el("div", { class: "lab" }, el("span", { text: "USR" + (sl.slot + 1) + ": " + n + " slices" + (D.man ? " (yours)" : " (automatic)") }), el("output", { text: D.len + " samples" })), chips, bar),
      el("div", { class: "card" }, el("div", { class: "lab" }, el("span", { text: "Slice " + (j + 1) + " starts at" }), out), slider,
        el("div", { class: "row" }, el("button", { class: "btn", disabled: pos[j] - sl.step < lo, onclick: () => set(pos[j] - sl.step), "aria-label": "Start earlier" }, ic("left"), "Earlier"), stepSeg,
          el("button", { class: "btn", disabled: pos[j] + sl.step > hi, onclick: () => set(pos[j] + sl.step), "aria-label": "Start later" }, "Later", ic("right"))),
        el("div", { class: "row" },
          el("button", { class: "btn grow", disabled: n >= SLC_AUTO || len(j) < 2 * SLC_MIN, onclick: () => { const p = [...pos]; p.splice(j + 1, 0, pos[j] + Math.floor(len(j) / 2)); sl.sel = j + 1; putSlices(p, D.end); }, text: "Split in two" }),
          el("button", { class: "btn grow", disabled: j === 0, onclick: () => { const p = [...pos]; p.splice(j, 1); sl.sel = j - 1; putSlices(p, D.end); }, text: "Join with the one before" }),
          el("button", { class: "btn grow", disabled: !D.end, onclick: () => putSlices(pos, 0), text: "Last slice to the end", title: "The last slice plays to the end of the sample" })),
        el("div", { class: "row" }, el("button", { class: "btn grow", disabled: !D.man, onclick: () => { sl.sel = 0; putSlices([], 0); }, text: "Back to automatic slices" }))));
  }

  function body() {
    const { tab } = ids(), all = tabsFor(d(), st.t);
    const rail = el("div", { class: "rail", role: "tablist", "aria-label": "Sound groups" }, all.map((x) =>
      el("button", { role: "tab", "aria-selected": String(x.k === st.tab), "aria-pressed": String(x.k === st.tab), text: x.label, onclick: () => { st.tab = x.k; showTab(); } })));
    let content;
    if (tab.fm6) content = own(fm6.el);
    else if (st.loading) content = el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    else if (tab.slices) content = slicesEl();
    else if (tab.mod != null) {
      const rows = Array.from({ length: 4 }, (_, k) => {
        const [a, b, c] = [0, 1, 2].map((j) => row(0, tab.mod + 3 * k + j));
        if (!a && !b && !c) return null;
        return el("div", { class: "modrow" }, el("span", { class: "slot", text: String(k + 1) }), a, b, c);
      }).filter(Boolean);
      content = el("div", { class: "modgrid" }, el("p", { class: "hint", text: "Each slot sends a source to a destination, by an amount." }), ...rows);
    } else {
      const cards = tab.cards.map((c) => ({ c, rows: c.ids.map(([s, id]) => row(s, id)).filter(Boolean) })).filter((x) => x.rows.length);
      content = cards.length ? el("div", { class: "sgrid" }, cards.map(({ c, rows }) => el("div", { class: "card" }, el("div", { class: "lab", text: c.title }), ...rows)))
        : el("div", { class: "empty" }, el("p", { text: "This group has nothing for this engine." }));
    }
    return el("div", { class: "sbody" }, rail, content);
  }

  function sheet() {
    if (!st.sheet) return null;
    const close = () => { st.sheet = null; render(); };
    const head = (title) => el("div", { class: "sheethead" }, el("b", { text: title }), el("button", { class: "btn", "aria-label": "Close", onclick: close }, ic("close")));
    const grid = (items, cur, onPick, per) => {
      const pages = Math.max(1, Math.ceil(items.length / per)), p = Math.min(st.page, pages - 1);
      return [el("div", { class: "plist" }, items.slice(p * per, p * per + per).map((it) => el("button", { class: "btn", "aria-pressed": String(it.v === cur), onclick: () => onPick(it.v), text: it.text }))),
        pages > 1 ? el("div", { class: "pager" }, el("button", { "aria-label": "Previous page", onclick: () => { st.page = Math.max(0, p - 1); render(); } }, ic("left")),
          el("output", { text: `${p + 1} / ${pages}` }), el("button", { "aria-label": "Next page", onclick: () => { st.page = Math.min(pages - 1, p + 1); render(); } }, ic("right"))) : null];
    };
    if (st.sheet.engine) {
      const engines = d().info.engines.map((n, i) => ({ v: i, text: n })).filter((e) => e.text && e.text !== "-");
      return el("div", { class: "sheet", role: "dialog", "aria-label": "Engine" }, head("Engine"),
        ...grid(engines, d().tracks[st.t].engine, async (e) => { st.sheet = null; try { await d().setPreset(st.t, e, 0); await d().readNames(e); } catch (x) { ctx.say(x.message, "error"); } st.vals = {}; first(); showTab(); }, 15));
    }
    if (st.sheet.presets) {
      const tr = d().tracks[st.t], names = d().names[tr.engine] || [];
      const fav = st.favs[tr.engine] || [];
      const items = names.map((n, i) => ({ v: i, text: (fav[i] ? "★ " : "") + n })).filter((it) => A().aliasOf(names, it.v) === it.v && (!st.favOnly || fav[it.v]));
      const bar = canFav() ? el("div", { class: "row" },
        el("button", { class: "btn grow", "aria-pressed": String(!!fav[tr.preset]), onclick: () => toggleFav(tr.engine, tr.preset), text: fav[tr.preset] ? "★ Favourite: remove" : "☆ Make " + tr.name + " a favourite" }),
        el("button", { class: "btn", "aria-pressed": String(st.favOnly), onclick: () => setFilter(!st.favOnly), text: "Favourites only" })) : null;
      return el("div", { class: "sheet", role: "dialog", "aria-label": "Sounds" }, head(`${tr.engineName} sounds`), bar,
        ...grid(items, tr.preset, async (p) => { st.sheet = null; try { await d().setPreset(st.t, tr.engine, p); } catch (x) { ctx.say(x.message, "error"); } st.vals = {}; showTab(); }, 12));
    }
    const { s, id } = st.sheet, x = cached(s, id), v = st.vals[vkey(s, id)];
    return el("div", { class: "sheet", role: "dialog", "aria-label": x.label }, head(x.label),
      ...grid(options(x).map((o) => ({ v: o, text: text(x, o) })), v, (o) => { setVal(s, id, o); st.sheet = null; render(); }, 18));
  }

  const render = () => repaint(root, build);
  function build() {
    root.replaceChildren();
    if (!d()) return;
    root.append(...[head(), body(), sheet()].filter(Boolean));
  }
  return { el: root, open, render, leave() { shown = false; fm6.leave(); } };
}
