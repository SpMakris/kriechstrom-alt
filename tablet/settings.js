// Settings screen: everything the machine's own menu holds (the machine describes it, so the list follows the firmware), the CUSTOM colour
// palette, MIDI learn, a full backup and restore, and facts about the firmware. Nothing scrolls: each group is a tab.

import { el, ic, askSheet, own, repaint } from "./ui.js";
import { Ext, KRST } from "./ext.js";

const RC_SAVE = { 3: "Applied, but not saved: the machine has no flash or the write failed.", 4: "Applied. It is saved when the transport stops." };
const ROLES = [["Background", "color1"], ["Identity", "color2"], ["Text", "color3"], ["Record and warnings", "primary"], ["Active", "secondary"]];
const css = ([r, g, b]) => `rgb(${Math.round((r * 255) / 31)} ${Math.round((g * 255) / 63)} ${Math.round((b * 255) / 31)})`;
const luma = ([r, g, b]) => (54 * ((r * 255) / 31) + 183 * ((g * 255) / 63) + 19 * ((b * 255) / 31)) / 256;
/* the editor warns where the device would let colours nobody can read through: color3 vs color1 128, color2 80, secondary 64, primary 64 */
const NEED = [null, 80, 128, 64, 64];

export function SettingsScreen(ctx) {
  const root = el("section", { class: "settings" });
  const d = () => ctx.dev();
  const st = { tab: null, items: null, pal: null, role: 0, learn: null, add: { cc: 74, track: 0, id: 0 }, sheet: null, page: 0, busy: "", prog: 0, labels: {}, pending: 0, timer: null };
  const say = (m, k) => ctx.say(m, k);

  const tabList = () => {
    const names = [];
    for (const it of st.items || []) if (!names.some((n) => n.tab === it.tab) && it.kind <= 1) names.push({ k: "m" + it.tab, tab: it.tab, label: it.tabName || "Settings" });
    names.sort((a, b) => a.tab - b.tab);
    return [...names, ...(d().tags.palette ? [{ k: "pal", label: "Colours" }] : []), ...(d().tags.learn ? [{ k: "learn", label: "MIDI learn" }] : []), ...((d().tags.krst & KRST.CLEARALL) ? [{ k: "system", label: "System" }] : []), { k: "backup", label: "Backup" }, { k: "about", label: "About" }];
  };

  async function open() {
    st.sheet = null; render();
    try { if (d().tags.menu) st.items = await Ext.menu(d()); } catch (e) { say(e.message, "error"); }
    st.items ||= [];
    const all = tabList();
    if (!st.tab || !all.some((x) => x.k === st.tab)) st.tab = all[0].k;
    await show(st.tab);
  }
  async function show(k) {
    st.tab = k; st.sheet = null; st.page = 0; render();
    try {
      if (k === "pal") st.pal = await Ext.paletteGet(d());
      else if (k === "learn") { st.learn = (await Ext.learnGet(d())).list; if (d().tags.krst & KRST.MLEARN) st.mlearn = await Ext.mlearn(d()); labels().then(() => { if (st.tab === "learn") render(); }); }
    } catch (e) { say(e.message, "error"); }
    render();
  }
  async function labels() {
    for (let id = 0; id < d().info.pcount; id++) { if (st.labels[id] != null) continue; try { const x = await d().describe(0, id, ctx.hand()); st.labels[id] = x.max > x.min && x.label !== "-" ? x.label : null; } catch (e) { st.labels[id] = null; } }
  }

  /* -------------------------------------------------------------- menu --- */
  async function setItem(it, v) {
    it.value = v; render();
    try {
      const r = await Ext.menuSet(d(), it.id, v);
      if (r.rc === 1) throw new Error("The machine does not know that setting");
      it.value = r.value;
      if (RC_SAVE[r.rc]) say(RC_SAVE[r.rc]);
    } catch (e) { say(e.message, "error"); }
    render();
  }
  function itemRow(it) {
    const label = it.name.charAt(0) + it.name.slice(1).toLowerCase();
    if (it.kind === 1) {
      const out = el("output", { text: `${it.value} ${it.unit}` });
      const inp = el("input", { type: "range", min: it.min, max: it.max, step: 1, value: it.value, "aria-label": label, oninput: (e) => { out.textContent = `${e.target.value} ${it.unit}`; it.value = +e.target.value; clearTimeout(st.timer); st.timer = setTimeout(() => setItem(it, it.value), 150); } });
      return el("div", { class: "field inline" }, el("span", { class: "nm", title: it.name, text: label }), inp, out);
    }
    if (it.kind !== 0) return null;
    if (it.names.length <= 4 && it.names.join("").length <= 28) {
      const sel = (k) => it.value - it.min === k;
      return el("div", { class: "field inline" }, el("span", { class: "nm", title: it.name, text: label }),
        el("div", { class: "seg", role: "group", "aria-label": label }, it.names.map((n, k) => el("button", { "aria-pressed": String(sel(k)), text: n, onclick: () => ask(it, it.min + k) }))));
    }
    return el("div", { class: "field inline" }, el("span", { class: "nm", title: it.name, text: label }),
      el("button", { class: "pickbtn", "aria-label": `${label}: ${it.names[it.value - it.min] || it.value}`, onclick: () => { st.sheet = { pick: it }; st.page = Math.floor((it.value - it.min) / 18); render(); } }, el("span", { text: it.names[it.value - it.min] ?? String(it.value) }), ic("down")));
  }
  /* USB SERIAL makes the machine drop off the bus and come back: ask first */
  function ask(it, v) { if (it.id === 11 && v !== it.value) { st.sheet = { usb: it, v }; render(); } else setItem(it, v); }
  function menuTab(tab) {
    const rows = (st.items || []).filter((it) => it.tab === tab).map(itemRow).filter(Boolean);
    return el("div", { class: "setgrid" }, rows.length ? rows : el("p", { class: "hint", text: "Nothing here for this firmware." }));
  }

  /* ----------------------------------------------------------- palette --- */
  function previewSoon() { clearTimeout(st.timer); st.timer = setTimeout(async () => { try { st.pal = { ...st.pal, ...(await Ext.paletteSet(d(), 0, st.pal.colors)) }; } catch (e) { say(e.message, "error"); } }, 60); }
  function palTab() {
    if (!st.pal) return el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    const P = st.pal, c = P.colors[st.role];
    const sw = P.colors.map(([r, g, b], i) => el("button", { class: "sw" + (i === st.role ? " sel" : ""), "aria-pressed": String(i === st.role), onclick: () => { st.role = i; render(); } },
      el("i", { style: `background:${css(P.colors[i])}` }), el("span", { text: ROLES[i][0] })));
    const slider = (label, k, max) => { const out = el("output", { text: String(c[k]) }); return el("div", { class: "field inline" }, el("span", { class: "nm", text: label }),
      el("input", { type: "range", min: 0, max, step: 1, value: c[k], "aria-label": label + " of " + ROLES[st.role][0], oninput: (e) => { c[k] = +e.target.value; out.textContent = String(c[k]); document.querySelector(".sw.sel i").style.background = css(c); previewSoon(); } }), out); };
    const warn = P.colors.map((x, i) => (NEED[i] && Math.abs(luma(x) - luma(P.colors[0])) < NEED[i] ? ROLES[i][0] : null)).filter(Boolean);
    return el("div", { class: "palbody" },
      el("div", { class: "swatches", role: "group", "aria-label": "Colours" }, sw),
      el("div", { class: "card" }, el("div", { class: "lab" }, el("span", { text: ROLES[st.role][0] }), el("output", { text: css(c) })),
        slider("Red", 0, 31), slider("Green", 1, 63), slider("Blue", 2, 31),
        warn.length ? el("p", { class: "hint warn", text: `Hard to read against the background: ${warn.join(", ")}. The machine accepts it anyway.` }) : null),
      el("div", { class: "row" },
        el("button", { class: "btn red", onclick: async () => { try { st.pal = { ...st.pal, ...(await Ext.paletteSet(d(), 1, P.colors)) }; say("Custom palette stored"); } catch (e) { say(e.message, "error"); } render(); }, text: "Keep this palette" }),
        el("button", { class: "btn", onclick: async () => { try { st.pal = { ...st.pal, ...(await Ext.paletteSet(d(), 3)) }; say("Preview dropped"); } catch (e) { say(e.message, "error"); } render(); }, text: "Drop the preview" }),
        el("button", { class: "btn", disabled: !P.stored, onclick: async () => { try { st.pal = { ...st.pal, ...(await Ext.paletteSet(d(), 2)) }; say("Custom palette removed"); } catch (e) { say(e.message, "error"); } render(); }, text: "Remove it" })),
      el("p", { class: "hint", text: P.stored ? "Your palette is stored on the machine." : "Moving a slider shows the colours on the machine at once. Keep this palette stores it as the COLOR choice CUSTOM." }));
  }

  /* -------------------------------------------------------- MIDI learn --- */
  const ILLEGAL = new Set([0, 1, 6, 11, 32, 38, 64, ...Array.from({ length: 6 }, (_, i) => 96 + i), ...Array.from({ length: 8 }, (_, i) => 120 + i)]);
  const pname = (id, track) => { const pe0 = d().info.pe0; if (id >= pe0) return `Engine ${id - pe0 + 1}`; return st.labels[id] || "Parameter " + id; };
  async function learn(op, a) {
    try { const r = await Ext.learnSet(d(), op, a && a.cc, a && a.track, a && a.id); st.learn = r.list; if (r.rc === 5) say("The map is full: clear one first", "error"); else if (r.rc === 1) say("The machine refused that CC or parameter", "error"); else if (r.rc === 3) say(RC_SAVE[3]); }
    catch (e) { say(e.message, "error"); }
    render();
  }
  async function toggleLearn() {
    try { st.mlearn = await Ext.mlearn(d(), !st.mlearn); say(st.mlearn ? "MIDI learn is on: turn a knob on the machine, then send the CC" : "MIDI learn is off"); } catch (e) { say(e.message, "error"); }
    render();
  }
  function learnTab() {
    if (!st.learn) return el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    const a = st.add, list = st.learn;
    const rows = list.map((l) => el("div", { class: "lrow" }, el("b", { text: "CC " + l.cc }), el("span", { text: `Track ${l.track + 1}` }), el("span", { class: "grow", text: pname(l.id, l.track) }),
      el("button", { class: "btn", "aria-label": `Forget CC ${l.cc}`, onclick: () => learn(1, { cc: l.cc }) }, ic("close"))));
    const valid = !ILLEGAL.has(a.cc);
    return el("div", { class: "learnbody" },
      el("div", { class: "card" }, el("div", { class: "lab" }, el("span", { text: "Learned controllers" }), el("output", { text: `${list.length} of 16` })),
        list.length ? el("div", { class: "lrows" }, rows) : el("p", { class: "hint", text: "No controller is mapped. Add one on the right, or turn on MIDI LEARN on the machine (GLO and D4)." }),
        el("div", { class: "row" },
          (d().tags.krst & KRST.MLEARN) ? el("button", { class: "btn grow", "aria-pressed": String(!!st.mlearn), title: "The machine's own MIDI LEARN: turn a knob, then send the CC", onclick: toggleLearn, text: st.mlearn ? "Learn mode: on" : "Learn mode: off" }) : null,
          el("button", { class: "btn grow", disabled: !list.length, onclick: () => { st.sheet = { learnall: true }; render(); }, text: "Forget all" }))),
      el("div", { class: "card" }, el("div", { class: "lab", text: "Map a controller" }),
        el("div", { class: "field" }, el("span", { class: "nm", text: "CC number" }), el("div", { class: "stepper" },
          el("button", { "aria-label": "Previous CC", onclick: () => { a.cc = (a.cc + 126) % 128; render(); } }, ic("minus")), el("output", { text: String(a.cc) }), el("button", { "aria-label": "Next CC", onclick: () => { a.cc = (a.cc + 1) % 128; render(); } }, ic("plus")))),
        el("div", { class: "field" }, el("span", { class: "nm", text: "Track" }), el("div", { class: "seg", role: "group", "aria-label": "Track" }, Array.from({ length: d().ntrk }, (_, t) => el("button", { "aria-pressed": String(a.track === t), text: String(t + 1), onclick: () => { a.track = t; render(); } })))),
        el("div", { class: "field" }, el("span", { class: "nm", text: "Parameter" }), el("button", { class: "pickbtn", onclick: () => { st.sheet = { param: true }; st.page = Math.floor(Math.max(0, paramIds().indexOf(a.id)) / 18); render(); } }, el("span", { text: pname(a.id, a.track) }), ic("down"))),
        valid ? null : el("p", { class: "hint warn", text: "The machine never learns this CC (bank select, mod wheel, pedal, data entry, channel mode)." }),
        el("button", { class: "btn red", disabled: !valid, onclick: () => learn(0, a), text: "Map it" })));
  }
  const paramIds = () => Array.from({ length: d().info.pcount }, (_, i) => i).filter((i) => i >= d().info.pe0 || st.labels[i]);

  /* ------------------------------------------------------------ backup --- */
  const bk = () => import("../vendor/kriechstrom/web/fm1backup.js");
  const download = (name, text) => { const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  async function backup() {
    st.busy = "Reading everything from the machine"; st.prog = 0; render();
    try {
      const { captureBackup } = await bk();
      const file = await captureBackup((r, o) => d().rq(r, o), d().info.version, (a, b) => { st.prog = a / b; render(); });
      download(`fm1-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(file));
      say("Backup saved to your downloads");
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  async function restore(text) {
    st.busy = "Writing the backup to the machine"; st.prog = 0; render();
    try {
      const { restoreBackup } = await bk();
      await restoreBackup((r, o) => d().rq(r, o), text, (a, b) => { st.prog = a / b; render(); });
      await d().reload(); say("Backup restored");
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  const backFile = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  own(backFile).addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; st.sheet = { restore: await f.text(), name: f.name }; render(); });
  function backupTab() {
    const can = (d().info.backupCaps || 0) & 1, put = (d().info.backupCaps || 0) & 2;
    return el("div", { class: "palbody" },
      el("div", { class: "card" }, el("div", { class: "lab", text: "Back up the whole machine" }),
        el("p", { class: "hint", text: "Saves the music playing now, the settings, the four projects, the 32 user sounds and the three sample slots to one file. The transport stops while it reads." }),
        el("button", { class: "btn red", disabled: !can, onclick: backup, text: can ? "Save a backup file" : "Not on this firmware" })),
      el("div", { class: "card" }, el("div", { class: "lab", text: "Restore from a backup" }),
        el("p", { class: "hint", text: "Writes a backup file back. Everything it holds replaces what the machine has now." }),
        el("button", { class: "btn", disabled: !put, onclick: () => backFile.click(), text: put ? "Choose a backup file" : "Not on this firmware" })), backFile);
  }

  /* ------------------------------------------------------------- system --- */
  function systemTab() {
    return el("div", { class: "palbody" },
      el("div", { class: "card" }, el("div", { class: "lab", text: "Start over" }),
        el("p", { class: "hint", text: "CLEAR ALL makes the music a new project: every track back to its power-on sound with no steps or automation, the song order, tempo and the rest of the project at their defaults. The stored projects A to D, user sounds, samples, settings and MIDI learn stay. Take a backup first if the music matters." }),
        el("button", { class: "btn red", onclick: () => { st.sheet = { clearall: true }; render(); }, text: "Clear all" })));
  }
  async function clearAll() {
    try { const rc = await Ext.clearAll(d()); if (rc) say("The machine refused to clear", "error"); else { say("All cleared: the machine is a new project"); await d().reload(); } } catch (e) { say(e.message, "error"); }
    render();
  }

  /* ------------------------------------------------------------- about --- */
  function aboutTab() {
    const i = d().info, t = d().tags;
    const feat = [["Song sections", t.sections], ["Song chain", t.chain], ["Menu settings", t.menu], ["MIDI learn", t.learn], ["Custom palette", t.palette], ["FM6 engine", d().hasFm6], ["FM6 voice bank", t.bank], ["Backup", i.backupCaps & 1], ["Restore", i.backupCaps & 2], ["Parameter locks", d().caps.locks], ["Conditions", d().caps.cond], ["Nudge", d().caps.nudge], ["Perform and key map", t.krst & KRST.PERF], ["Slice points", t.krst & KRST.SLICE], ["Clear all", t.krst & KRST.CLEARALL]];
    return el("div", { class: "palbody" },
      el("div", { class: "card" }, el("div", { class: "lab" }, el("span", { text: "Firmware" }), el("output", { text: i.version })),
        el("p", { class: "hint", text: `${i.nengines} engines, ${i.pcount} track parameters, ${i.gcount} global parameters, ${i.nstep} steps, ${d().ntrk} tracks.` }),
        el("p", { class: "hint", text: "Engines: " + i.engines.filter((n) => n && n !== "-").join(", ") })),
      el("div", { class: "card" }, el("div", { class: "lab", text: "What this firmware offers" }), el("div", { class: "caps" }, feat.map(([n, on]) => el("span", { class: on ? "on" : "off", text: (on ? "Yes  " : "No  ") + n })))));
  }

  /* ------------------------------------------------------------- sheets --- */
  function sheet() {
    const s = st.sheet; if (!s) return null;
    const no = () => { st.sheet = null; render(); };
    if (s.usb) return askSheet({ title: "Change USB SERIAL?", text: "The machine disconnects from USB and comes back about a second later. The tablet has to connect again.", yes: "Change", danger: true, onNo: no, onYes: () => { st.sheet = null; setItem(s.usb, s.v); } });
    if (s.restore) return askSheet({ title: "Restore " + s.name + "?", text: "Everything in the file replaces what the machine has: the music playing now, the settings, the projects, the user sounds and the samples.", yes: "Restore", danger: true, onNo: no, onYes: () => { const t = s.restore; st.sheet = null; restore(t); } });
    if (s.clearall) return askSheet({ title: "Clear all?", text: "The music on the machine becomes a new project. Stored projects, user sounds, samples and settings stay. This cannot be undone.", yes: "Clear all", danger: true, onNo: no, onYes: () => { st.sheet = null; clearAll(); } });
    if (s.learnall) return askSheet({ title: "Forget every controller?", text: "All learned CC mappings are removed.", yes: "Forget all", danger: true, onNo: no, onYes: () => { st.sheet = null; learn(2); } });
    const grid = (title, items, cur, onPick) => {
      const per = 18, pages = Math.max(1, Math.ceil(items.length / per)), p = Math.min(st.page, pages - 1);
      return el("div", { class: "sheet", role: "dialog", "aria-label": title },
        el("div", { class: "sheethead" }, el("b", { text: title }), el("button", { class: "btn", "aria-label": "Close", onclick: no }, ic("close"))),
        el("div", { class: "plist" }, items.slice(p * per, p * per + per).map((x) => el("button", { class: "btn", "aria-pressed": String(x.v === cur), onclick: () => onPick(x.v), text: x.text }))),
        pages > 1 ? el("div", { class: "pager" }, el("button", { "aria-label": "Previous page", onclick: () => { st.page = Math.max(0, p - 1); render(); } }, ic("left")), el("output", { text: `${p + 1} / ${pages}` }), el("button", { "aria-label": "Next page", onclick: () => { st.page = Math.min(pages - 1, p + 1); render(); } }, ic("right"))) : null);
    };
    if (s.pick) return grid(s.pick.name, s.pick.names.map((n, k) => ({ v: s.pick.min + k, text: n })), s.pick.value, (v) => { const it = s.pick; st.sheet = null; setItem(it, v); });
    if (s.param) return grid("Parameter", paramIds().map((id) => ({ v: id, text: pname(id, st.add.track) })), st.add.id, (v) => { st.add.id = v; st.sheet = null; render(); });
    return null;
  }

  const render = () => repaint(root, build);
  function build() {
    root.replaceChildren();
    if (!d()) return;
    const all = st.items ? tabList() : [];
    const rail = el("div", { class: "rail", role: "tablist", "aria-label": "Settings" }, all.map((x) => el("button", { role: "tab", "aria-selected": String(x.k === st.tab), "aria-pressed": String(x.k === st.tab), text: x.label, onclick: () => show(x.k) })));
    let content;
    if (!st.items) content = el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    else if (st.tab && st.tab[0] === "m") content = menuTab(+st.tab.slice(1));
    else content = { pal: palTab, learn: learnTab, system: systemTab, backup: backupTab, about: aboutTab }[st.tab]?.() || el("div", { class: "empty" });
    const busy = st.busy ? el("div", { class: "busy", role: "status" }, el("b", { text: st.busy }), el("progress", { max: "1", value: String(st.prog || 0) })) : null;
    root.append(...[el("div", { class: "sbody" }, rail, content), sheet(), busy].filter(Boolean));
  }
  /* a setting turned on the machine's own menu */
  d().on("menu", (id, v) => { const it = (st.items || []).find((x) => x.id === id); if (it && it.value !== v) { it.value = v; render(); } });
  return { el: root, open, render, leave() { clearTimeout(st.timer); } };
}
