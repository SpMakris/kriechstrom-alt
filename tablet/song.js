// Song screen: the song chain. A song is up to 16 sections; each section says which saved project (A to D, or silence) each of the
// four tracks plays and how many times it repeats. Firmware before 1.2 has rows (one project per row): shown as one lane.

import { el, ic, idle, repaint } from "./ui.js";

const SLOT = ["A", "B", "C", "D", "-"];
const RC = { 1: "The song has a section the machine cannot play.", 2: "The machine is busy. Try again.", 3: "Project A is empty. Save a project there first.", 4: "Project B is empty. Save a project there first.", 5: "Project C is empty. Save a project there first.", 6: "Project D is empty. Save a project there first." };

export function SongScreen(ctx) {
  const root = el("section", { class: "song" });
  const d = () => ctx.dev();
  const st = { secs: [], running: false, at: 0, left: 0, sel: 0, lane: 0, used: [false, false, false, false], timer: null, ready: false, busy: false };
  const wide = () => !!d().tags.sections;
  const ops = () => (wide() ? { get: 4, set: 5, start: 6, stop: 7 } : { get: 0, set: 1, start: 2, stop: 3 });
  const lanes = () => (wide() ? 4 : 1);

  function parse(a) {
    const o = { op: a[0], rc: a[1], count: a[2], running: !!a[3], at: a[4], left: a[5], secs: [] };
    const w = wide() ? 5 : 2;
    for (let i = 0; i < o.count; i++) { const b = a.slice(6 + i * w, 6 + (i + 1) * w); o.secs.push(wide() ? { slots: b.slice(0, 4), repeat: b[4] } : { slots: [b[0], b[0], b[0], b[0]], repeat: b[1] }); }
    return o;
  }
  async function ask(op, secs) {
    const args = op === ops().set ? [op, secs.length, ...secs.flatMap((s) => (wide() ? [...s.slots, s.repeat] : [s.slots[0], s.repeat]))] : [op];
    return parse(await d().rq([d().A.CMD.SONG, args], { timeout: 1500, retries: 1 }));
  }
  const take = (r) => { st.running = r.running; st.at = r.at; st.left = r.left; };

  async function open() {
    if (!d().tags.chain) { st.ready = false; render(); return; }
    try {
      const r = await ask(ops().get); st.secs = r.secs; take(r); st.sel = Math.min(st.sel, Math.max(0, st.secs.length - 1)); st.ready = true;
      for (let k = 0; k < 4; k++) d().rq(d().A.req.project(2, k)).then((a) => { st.used[k] = !!d().A.parse[d().A.CMD.PROJECT](a).used; render(); }).catch(() => {});
    } catch (e) { ctx.say(e.message, "error"); }
    clearInterval(st.timer); st.timer = setInterval(poll, 600);
    render();
  }
  const key = () => JSON.stringify([st.secs, st.running, st.at, st.left, st.used, st.sel, st.lane, st.ready, st.busy]);
  async function poll() {
    if (!d() || st.busy) return;
    /* the screen is only rebuilt when what it shows changed: a rebuild every poll replaced the button under a finger and the tap was lost */
    try { const was = key(); const r = await ask(ops().get); take(r); if (r.secs.length !== st.secs.length && !st.running) st.secs = r.secs; if (key() !== was) idle("song", render); } catch (e) { /* the status bar says */ }
  }
  async function push(next) {
    st.busy = true;
    try {
      const r = await ask(ops().set, next);
      if (r.rc) { ctx.say(RC[r.rc] || "The machine refused the song (code " + r.rc + ")", "error"); const g = await ask(ops().get); st.secs = g.secs; }
      else st.secs = next;
    } catch (e) { ctx.say(e.message, "error"); }
    st.busy = false; render();
  }
  const clone = () => st.secs.map((s) => ({ slots: [...s.slots], repeat: s.repeat }));
  const edit = (fn) => { const n = clone(); fn(n); push(n); };

  async function run(op) {
    st.busy = true;
    try { const r = await ask(op); if (r.rc) ctx.say(RC[r.rc] || "The machine refused (code " + r.rc + ")", "error"); take(r); }
    catch (e) { ctx.say(e.message, "error"); }
    st.busy = false; render();
  }

  function head() {
    const status = st.running ? `Playing section ${st.at + 1} of ${st.secs.length}, ${st.left} more ${st.left === 1 ? "time" : "times"}` : st.secs.length ? "Stopped" : "No sections yet";
    return el("div", { class: "fhead" },
      el("button", { class: "btn red", disabled: st.running || !st.secs.length, onclick: () => run(ops().start) }, ic("play"), "Play song"),
      el("button", { class: "btn", disabled: !st.running, onclick: () => run(ops().stop) }, ic("stop"), "Stop"),
      el("output", { class: "songstat", text: status }),
      el("span", { class: "hint grow", text: "A to D are the four projects saved on the machine. Each section plays them on the tracks, then moves on." }));
  }

  function grid() {
    const n = st.secs.length, cols = Math.min(16, n + 1), L = lanes();
    const cells = [el("div", { class: "g corner" })];
    for (let c = 0; c < cols; c++) cells.push(c < n
      ? el("button", { class: "g colhead" + (st.running && st.at === c ? " now" : "") + (st.sel === c ? " sel" : ""), "aria-label": "Section " + (c + 1), onclick: () => { st.sel = c; render(); }, text: String(c + 1) })
      : el("button", { class: "g colhead add", "aria-label": "Add a section", onclick: () => edit((x) => { const f = x[st.sel] || { slots: [0, 0, 0, 0], repeat: 1 }; x.push({ slots: [...f.slots], repeat: f.repeat }); st.sel = x.length - 1; }) }, ic("plus")));
    for (let t = 0; t < L; t++) {
      cells.push(el("div", { class: "g rowhead", text: wide() ? "T" + (t + 1) : "Project" }));
      for (let c = 0; c < cols; c++) cells.push(c < n
        ? el("button", { class: "g cell" + (st.sel === c && st.lane === t ? " sel" : "") + (st.secs[c].slots[t] === 4 ? " silent" : "") + (st.running && st.at === c ? " now" : ""), "aria-label": `Section ${c + 1}, ${wide() ? "track " + (t + 1) : "project"} ${SLOT[st.secs[c].slots[t]]}`,
          onclick: () => { st.sel = c; st.lane = t; render(); }, text: SLOT[st.secs[c].slots[t]] })
        : el("div", { class: "g blank" }));
    }
    cells.push(el("div", { class: "g rowhead", text: "Times" }));
    for (let c = 0; c < cols; c++) cells.push(c < n
      ? el("button", { class: "g cell rep" + (st.sel === c && st.lane === 4 ? " sel" : ""), "aria-label": `Section ${c + 1}, repeats ${st.secs[c].repeat}`, onclick: () => { st.sel = c; st.lane = 4; render(); }, text: "x" + st.secs[c].repeat })
      : el("div", { class: "g blank" }));
    return el("div", { class: "songgrid", style: `grid-template-columns: 64px repeat(${cols}, minmax(0, 1fr))`, role: "group", "aria-label": "Song" }, cells);
  }

  function panel() {
    const n = st.secs.length;
    if (!n) return el("div", { class: "songpanel" }, el("p", { class: "hint", text: "Add the first section with the plus button above. It copies the last one, so you can change just what differs." }));
    const s = st.secs[st.sel] || st.secs[0], i = st.sel;
    const pick = st.lane < 4 && lanes() > 0
      ? el("div", { class: "field" }, el("span", { class: "nm", text: wide() ? `Track ${st.lane + 1} plays` : "Plays project" }),
        el("div", { class: "seg", role: "group", "aria-label": "Project" }, SLOT.filter((_, k) => wide() || k < 4).map((c, k) => el("button", { "aria-pressed": String(s.slots[st.lane] === k),
          title: k < 4 ? (st.used[k] ? "Project " + c : "Project " + c + " is empty") : "Silence", text: k < 4 ? c + (st.used[k] ? "" : " (empty)") : "Silent",
          onclick: () => edit((x) => { if (wide()) x[i].slots[st.lane] = k; else x[i].slots = [k, k, k, k]; }) }))))
      : null;
    const rep = el("div", { class: "field" }, el("span", { class: "nm", text: "Repeats" }),
      el("div", { class: "stepper" },
        el("button", { class: "btn", "aria-label": "Fewer repeats", disabled: s.repeat <= 1, onclick: () => edit((x) => { x[i].repeat--; }) }, ic("minus")),
        el("output", { text: String(s.repeat) }),
        el("button", { class: "btn", "aria-label": "More repeats", disabled: s.repeat >= 16, onclick: () => edit((x) => { x[i].repeat++; }) }, ic("plus"))));
    return el("div", { class: "songpanel" }, el("b", { class: "lab", text: "Section " + (i + 1) }), pick, rep,
      el("div", { class: "row" },
        el("button", { class: "btn", disabled: i === 0, "aria-label": "Move earlier", onclick: () => edit((x) => { [x[i - 1], x[i]] = [x[i], x[i - 1]]; st.sel = i - 1; }) }, ic("left"), "Earlier"),
        el("button", { class: "btn", disabled: i >= n - 1, "aria-label": "Move later", onclick: () => edit((x) => { [x[i + 1], x[i]] = [x[i], x[i + 1]]; st.sel = i + 1; }) }, "Later", ic("right")),
        el("button", { class: "btn", disabled: n >= 16, onclick: () => edit((x) => { x.splice(i + 1, 0, { slots: [...x[i].slots], repeat: x[i].repeat }); st.sel = i + 1; }) }, "Copy"),
        el("button", { class: "btn", onclick: () => edit((x) => { x.splice(i, 1); st.sel = Math.max(0, Math.min(i, x.length - 1)); }) }, "Delete")));
  }

  const render = () => repaint(root, build);
  function build() {
    root.replaceChildren();
    if (!d()) return;
    if (!d().tags.chain) { root.append(el("div", { class: "empty" }, el("h2", { text: "No song on this firmware" }), el("p", { text: "This machine's firmware does not report the song chain." }))); return; }
    if (!st.ready) { root.append(el("div", { class: "empty" }, el("p", { text: "Reading the song..." }))); return; }
    root.append(head(), el("div", { class: "songbody" }, grid(), panel()));
  }
  return { el: root, open, render, leave() { clearInterval(st.timer); st.timer = null; } };
}
