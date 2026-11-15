// Kit editor: the USER drum kit of a DRUM track, every number of its tables (firmware drum_ukit.c). Eight lanes; a lane is a voice
// (its RUN) and the numbers that voice has. Every change goes to the machine at once and the machine's answer is what is shown;
// what is turned on the machine arrives as KIT_CHANGED and is read again. Nothing scrolls: the numbers come a page at a time.

import { el, repaint, idle } from "./ui.js";
import { Ext } from "./ext.js";

const PER = 5;                                                  /* numbers on a page */
const USER = 13;                                                /* KIT value of the USER kit (eng_drum.c DK_USER) */
const RC = { 1: "That slot or name is not valid.", 2: "The machine could not write it: stop the sequencer, or the flash failed." };

export function KitScreen(ctx) {
  const root = el("section", { class: "kit" });
  const st = { t: 0, lane: 0, page: 0, info: null, lanes: [], user: false, err: "", busy: false, name: "", seed: 0, from: 0, open: false, view: "edit" };
  const d = () => ctx.dev();
  const pe0 = () => d().info.pe0;

  async function readAll() {
    st.info = await Ext.kitInfo(d());
    st.lanes = [];
    for (let l = 0; l < st.info.nlanes; l++) st.lanes[l] = await Ext.kitLane(d(), l);
    st.user = (await d().getParam(st.t, pe0())) === USER;
  }
  async function open(t) {
    st.open = true; st.t = t; st.err = "";
    render();
    try { await readAll(); } catch (e) { st.err = e.message; }
    render();
  }
  /* the machine moved a number, or saved a kit: what is shown is read again (not while this screen is closed) */
  d().on("kit", () => { if (st.open) { clearTimeout(st.again); st.again = setTimeout(async () => { try { await readAll(); idle("kit", render); } catch (e) { /* closed */ } }, 120); } });
  d().on("param", (s, t, id, v) => { if (st.open && s === 0 && t === st.t && id === pe0()) { st.user = v === USER; render(); } });
  d().on("reloaded", () => { if (st.open) open(st.t); });

  const lane = () => st.lanes[st.lane];
  const pages = () => Math.max(1, Math.ceil((lane() ? lane().fields.length : 0) / PER));

  async function set(f, v) {
    const l = st.lane;
    try { st.lanes[l] = await Ext.kitSet(d(), l, f.f, v); } catch (e) { return; }
    if (st.page >= pages()) st.page = pages() - 1;
    render();
  }
  async function seed(lane, nib, src) {
    try { await Ext.kitSeed(d(), nib, lane, src); await readAll(); } catch (e) { ctx.say(e.message, "error"); }
    render();
  }
  async function slot(op, k, name) {
    try {
      const r = await Ext.kitSlot(d(), op, k, name);
      if (r.rc === 1 || r.rc === 2) ctx.say(RC[r.rc], "error");
      else if (r.rc === 3) ctx.say("Kept until power-off: the machine has no flash to write it to.");
      await readAll();
    } catch (e) { ctx.say(e.message, "error"); }
    render();
  }
  async function useUser() {
    try { await d().setParam(st.t, pe0(), USER); st.user = true; } catch (e) { ctx.say(e.message, "error"); }
    render();
  }

  function field(f) {
    const run = f.f === 0;
    if (run) {
      return el("div", { class: "field kitrun" },
        el("div", { class: "chips", role: "group", "aria-label": "Voice" }, st.info.runs.map((n, i) =>
          el("button", { class: "chip", "aria-pressed": String(i === f.v), text: n, onclick: () => set(f, i) }))));
    }
    const out = el("input", { type: "number", class: "kitnum", min: f.lo, max: f.hi, step: 1, value: f.v, "aria-label": f.name + " value", onchange: (e) => set(f, +e.target.value) });
    const rng = el("input", { type: "range", min: f.lo, max: f.hi, step: 1, value: f.v, "aria-label": f.name,
      oninput: (e) => { out.value = e.target.value; set(f, +e.target.value); } });
    return el("div", { class: "field inline kitf" }, el("span", { class: "nm", title: f.name + " " + f.lo + " to " + f.hi, text: f.name }), rng,
      el("button", { class: "btn step", "aria-label": f.name + " down", onclick: () => set(f, f.v - 1), text: "−" }), out,
      el("button", { class: "btn step", "aria-label": f.name + " up", onclick: () => set(f, f.v + 1), text: "+" }));
  }

  function lanes() {
    return el("div", { class: "chips lanes", role: "group", "aria-label": "Lane" }, st.lanes.map((x, i) =>
      el("button", { class: "chip", "aria-pressed": String(i === st.lane), onclick: () => { st.lane = i; st.page = 0; render(); } },
        el("b", { text: String(i + 1) }), " ", st.info.runs[x.run])));
  }

  function editor() {
    const L = lane(), n = pages(), p = Math.min(st.page, n - 1), list = L.fields.slice(p * PER, p * PER + PER);
    return el("div", { class: "card" }, ...list.map(field));
  }
  function pager() {
    const n = pages(), p = Math.min(st.page, n - 1);
    return el("div", { class: "pager" },
      el("button", { "aria-label": "Previous numbers", disabled: p === 0, onclick: () => { st.page = p - 1; render(); }, text: "‹" }),
      el("output", { text: (p + 1) + " / " + n }),
      el("button", { "aria-label": "Next numbers", disabled: p === n - 1, onclick: () => { st.page = p + 1; render(); }, text: "›" }));
  }

  function kits() {
    const I = st.info, K = (i) => I.kits[i];
    const slots = Array.from({ length: I.nsaved }, (_, k) => {
      const used = (I.used >> k) & 1;
      return el("div", { class: "kitslot" }, el("b", { text: "K" + (k + 1) }), el("span", { class: used ? "" : "dim", text: used ? K(k) : "empty" }),
        el("button", { class: "btn", disabled: !used, onclick: () => slot(2, k), "aria-label": "Load K" + (k + 1), text: "Load" }),
        el("button", { class: "btn", onclick: () => slot(1, k, st.name.trim() || "KIT " + (k + 1)), "aria-label": "Save the kit as K" + (k + 1), text: "Save" }),
        el("button", { class: "btn", disabled: !used, onclick: () => slot(3, k), "aria-label": "Erase K" + (k + 1), text: "Erase" }));
    });
    const name = el("input", { type: "text", class: "nm", maxlength: 12, value: st.name, placeholder: "Name for a save (KIT n)", spellcheck: "false", "aria-label": "Kit name",
      oninput: (e) => { st.name = e.target.value.replace(/[^\x20-\x7E]/g, "").toUpperCase(); } });
    const from = el("div", { class: "card" }, el("div", { class: "lab", text: "Start from a model kit" }),
      el("div", { class: "chips seeds", role: "group", "aria-label": "Model kit" }, I.seeds.map((n, i) => el("button", { class: "chip", "aria-pressed": String(i === st.seed), text: n, onclick: () => { st.seed = i; render(); } }))),
      el("div", { class: "row" },
        el("button", { class: "btn grow", onclick: () => seed(null, st.seed + 1), text: "All lanes" }),
        el("button", { class: "btn grow", title: "This lane becomes lane " + (st.from + 1) + " of " + I.seeds[st.seed], onclick: () => seed(st.lane, st.seed + 1, st.from), text: "This lane from lane " + (st.from + 1) }),
        el("div", { class: "seg", role: "group", "aria-label": "Lane of the model kit" }, [0, 1, 2, 3, 4, 5, 6, 7].map((i) => el("button", { "aria-pressed": String(i === st.from), text: String(i + 1), onclick: () => { st.from = i; render(); } })))));
    return el("div", { class: "kitgrid" }, el("div", { class: "card" }, name, ...slots), from);
  }

  const render = () => repaint(root, () => root.append(...build()));
  function build() {
    if (!d()) return [];
    if (st.err) return [el("div", { class: "empty" }, el("p", { text: "Could not read the kit: " + st.err }))];
    if (!st.info) return [el("div", { class: "empty" }, el("p", { text: "Reading..." }))];
    const bar = el("div", { class: "kitbar" },
      el("div", { class: "seg", role: "group", "aria-label": "Kit view" }, [["edit", "Edit"], ["kits", "Kits"]].map(([v, t]) =>
        el("button", { "aria-pressed": String(st.view === v), text: t, onclick: () => { st.view = v; render(); } }))),
      st.user ? el("span") : el("button", { class: "btn red", title: "This track plays another kit: what you change here is heard when its KIT is USER.", onclick: useUser, text: "Play the USER kit" }),
      st.view === "edit" ? pager() : el("span"));
    return st.view === "edit" ? [bar, lanes(), editor()] : [bar, kits()];
  }
  return { el: root, open, render, leave() { st.open = false; } };
}
