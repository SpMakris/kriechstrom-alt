// Library screen: what the machine stores. Sounds (32 user presets), Projects (4 slots), Voices (the FM6 voice bank), Samples (3 user slots).
// Nothing scrolls: lists are paged.

import { el, ic, askSheet, textSheet, own, repaint } from "./ui.js";

const CATS = ["None", "Bass", "Lead", "Pad", "Pluck", "Keys", "Drum", "FX", "Other"];
const kib = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0);

export function LibraryScreen(ctx) {
  const root = el("section", { class: "lib" });
  const d = () => ctx.dev();
  const A = () => d().A;
  const st = { tab: "sounds", t: 0, sheet: null, page: 0, busy: "", sel: 0,
    ups: null, proj: null, bank: null, smp: null, draft: { name: "", zones: [] }, tgt: 0 };
  const say = (m, k) => ctx.say(m, k);
  const fail = (e) => { say(e.message || String(e), "error"); st.busy = ""; render(); };

  const tabs = () => [["sounds", "Sounds"], ["projects", "Projects"], ...(d().tags.bank && d().hasFm6 ? [["voices", "Voices"]] : []), ["samples", "Samples"]];
  async function open() { st.t = Math.min(ctx.hand(), d().ntrk - 1); st.sheet = null; await show(st.tab); }
  async function show(tab) {
    st.tab = tab; st.page = 0; st.sel = 0; st.sheet = null; render();
    try {
      if (tab === "sounds") await loadUps();
      else if (tab === "projects") await loadProj();
      else if (tab === "voices") st.bank = await ExtBank();
      else if (tab === "samples") await loadSmp();
    } catch (e) { say(e.message, "error"); }
    render();
  }
  const ExtBank = async () => (await import("./ext.js")).Ext.bankList(d());

  /* ------------------------------------------------------------ sounds --- */
  async function loadUps() {
    const { Reader, CMD, req } = A(), slots = [];
    for (let s = 0; s < 32; s += 16) {
      const r = new Reader(await d().rq(req.upList(s, 16), { timeout: 1000 }));
      const start = r.b(), count = r.b(); r.b();
      const part = [];
      for (let i = 0; i < count; i++) part.push({ slot: start + i, used: !!r.b(), engine: r.b(), name: r.s(), cat: 0 });
      for (let i = 0; i < count && r.i < r.a.length; i++) part[i].cat = r.b();
      slots.push(...part);
    }
    st.ups = slots;
  }
  const engName = (e) => (d().info.engines[e] || "?");
  async function upGet(slot) {
    const { Reader, parse, CMD, req } = A();
    const a = await d().rq(req.upGet(slot), { timeout: 1500 });
    const o = parse[CMD.UP_GET](a, d().info);
    const r = new Reader(a); r.b(); r.b(); r.b(); r.s();
    let pos = r.i + d().info.pcount * 2 + 32;
    let cat = 0;
    if (pos < a.length) { const kind = a[pos]; pos += kind === 1 ? 17 : 1; cat = a[pos] || 0; }
    return { ...o, cat };
  }
  function upArgs(slot, o, name, cat) {
    const [cmd, args] = A().req.upPut(slot, { engine: o.engine, name, p: o.p, pattern: o.pattern, grid: o.grid });
    if (!o.grid) args.push(0, ...Array(16).fill(0));
    args.push(cat);
    return [cmd, args];
  }
  const withFm6 = () => d().info.fm6 && d().info.fm6.caps & 2;
  async function upEdit(slot, name, cat) {
    st.busy = "Saving"; render();
    try {
      const o = await upGet(slot);
      let patch = null;
      if (withFm6() && engName(o.engine) === "FM6") patch = await d().rq(A().req.fm6Get(3, slot)).then((a) => A().parse[A().CMD.FM6_GET](a)).catch(() => null);
      const a = await d().rq(upArgs(slot, o, name, cat), { timeout: 3000, retries: 0 });
      if (a[1]) throw new Error("The machine could not store the sound (code " + a[1] + ")");
      if (patch && !patch.rc) await d().rq(A().req.fm6Put(3, slot, patch.packed), { timeout: 3000, retries: 0 }).catch(() => {});
      await loadUps(); say("Saved " + name);
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  async function upLoad(slot) {
    st.busy = "Loading"; render();
    try {
      await d().selectTrack(st.t);
      const a = A().parse[A().CMD.UP_LOAD](await d().rq(A().req.upLoad(slot), { timeout: 3000, retries: 0 }));
      if (a.rc) throw new Error("That slot is empty");
      await d().reload(); say(`Loaded onto track ${st.t + 1}`);
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  async function upStore(slot, name) {
    st.busy = "Storing"; render();
    try {
      await d().selectTrack(st.t);
      const a = A().parse[A().CMD.UP_STORE](await d().rq(A().req.upStore(slot, name), { timeout: 3500, retries: 0 }));
      if (a.rc) throw new Error("The machine could not store it (code " + a.rc + ")");
      await loadUps(); say(`Stored track ${st.t + 1} in U${String(slot + 1).padStart(2, "0")}`);
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  async function upErase(slot) {
    st.busy = "Erasing"; render();
    try { const a = A().parse[A().CMD.UP_ERASE](await d().rq(A().req.upErase(slot), { timeout: 3000, retries: 0 })); if (a.rc) throw new Error("Could not erase (code " + a.rc + ")"); await loadUps(); say("Erased"); }
    catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }

  /* sound files: the editor's library format (felucca-library), so a file made by the shipped editor loads here and the other way round */
  const saveFile = (name, obj) => {
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const slug = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sound";
  async function exportSounds(slots) {
    st.busy = "Reading the sounds"; render();
    try {
      const info = d().info, now = new Date().toISOString(), patches = [];
      for (const slot of slots) {
        const o = await upGet(slot); if (!o.used) continue;
        const pt = { name: o.name, engine: o.engine, engineName: engName(o.engine), params: o.p, pattern: o.pattern, tags: ["device"], created: now, modified: now, slot };
        if (o.grid) { pt.grid = o.grid; pt.pattern = null; }
        if (withFm6() && engName(o.engine) === "FM6") { const g = await d().rq(A().req.fm6Get(3, slot)).then((a) => A().parse[A().CMD.FM6_GET](a)).catch(() => null); if (g && !g.rc) pt.fm6 = [...g.packed]; }
        patches.push(pt);
      }
      if (!patches.length) throw new Error("Nothing stored there to export");
      saveFile(slots.length === 1 ? `felucca-patch-${slug(patches[0].name)}.json` : `felucca-bank-${now.slice(0, 10)}.json`,
        { format: "felucca-library", version: 1, kind: slots.length === 1 ? "patch" : "bank", firmware: info.version || "", pCount: info.pcount, pE0: info.pe0, paramLabels: [], engines: info.engines, exported: now, patches });
      say(`Exported ${patches.length} sound${patches.length === 1 ? "" : "s"}`);
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  /* a file's sounds -> what this machine can store (same parameter layout, an engine it has) */
  function readSoundFile(obj) {
    const info = d().info, out = []; let skipped = 0;
    const list = obj && obj.format === "felucca-library" && Array.isArray(obj.patches) ? obj.patches
      : obj && obj.format === "felucca-patch" && Array.isArray(obj.p) ? [{ name: obj.presetName || obj.engineName, engineName: obj.engineName, engine: obj.engine, params: obj.p }] : null;
    if (!list) throw new Error("This is not a sound file from the editor");
    for (const x of list) {
      const nm = x.engineName || (obj.engines || [])[x.engine | 0], e = nm ? info.engines.indexOf(nm) : -1, p = x.params || x.p;
      if (e < 0 || !Array.isArray(p) || p.length !== info.pcount) { skipped++; continue; }
      out.push({ name: String(x.name || "SOUND").slice(0, 12), engine: e, p: p.map((v) => (Number.isFinite(v) ? Math.round(v) : 0)), pattern: x.pattern || null, grid: x.grid || null, fm6: Array.isArray(x.fm6) && x.fm6.length === 128 ? x.fm6 : null });
    }
    return { patches: out, skipped };
  }
  async function importSounds(patches, first) {
    st.busy = "Writing the sounds"; render();
    try {
      let n = 0;
      for (let i = 0; i < patches.length && first + i < 32; i++) {
        const pt = patches[i], slot = first + i;
        const a = await d().rq(A().req.upPut(slot, { engine: pt.engine, name: pt.name, p: pt.p, pattern: pt.pattern, grid: pt.grid }), { timeout: 3500, retries: 0 });
        if (a[1]) throw new Error("The machine refused " + pt.name + " (code " + a[1] + ")");
        if (pt.fm6 && withFm6() && engName(pt.engine) === "FM6") await d().rq(A().req.fm6Put(3, slot, Uint8Array.from(pt.fm6)), { timeout: 3500, retries: 0 }).catch(() => {});
        n++;
      }
      await loadUps(); say(`Wrote ${n} sound${n === 1 ? "" : "s"} from U${String(first + 1).padStart(2, "0")}`);
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  const soundFile = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  own(soundFile).addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const r = readSoundFile(JSON.parse(await f.text())); if (!r.patches.length) throw new Error("None of the sounds in " + f.name + " fit this machine" + (r.skipped ? " (" + r.skipped + " skipped)" : "")); st.sheet = { kind: "soundimport", ...r, first: st.sel, file: f.name }; render(); }
    catch (x) { say(x.message, "error"); }
  });

  function trackSeg(label = "Track") {
    return el("div", { class: "seg", role: "group", "aria-label": label }, Array.from({ length: d().ntrk }, (_, t) =>
      el("button", { "aria-pressed": String(t === st.t), "aria-label": `Track ${t + 1}, ${d().tracks[t].name}`, title: d().tracks[t].name, onclick: () => { st.t = t; render(); }, text: String(t + 1) })));
  }
  function pager(n, per) {
    const pages = Math.max(1, Math.ceil(n / per)), p = Math.min(st.page, pages - 1);
    return pages > 1 ? el("div", { class: "pager" }, el("button", { "aria-label": "Previous page", onclick: () => { st.page = Math.max(0, p - 1); render(); } }, ic("left")),
      el("output", { text: `${p + 1} / ${pages}` }), el("button", { "aria-label": "Next page", onclick: () => { st.page = Math.min(pages - 1, p + 1); render(); } }, ic("right"))) : null;
  }

  function soundsTab() {
    if (!st.ups) return el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    const per = 8, p = Math.min(st.page, Math.ceil(32 / per) - 1);
    const list = st.ups.slice(p * per, p * per + per);
    const cur = st.ups[st.sel] || st.ups[0];
    const tiles = el("div", { class: "tiles" }, list.map((u) => el("button", { class: "tile" + (u.used ? "" : " free") + (st.sel === u.slot ? " sel" : ""), "aria-pressed": String(st.sel === u.slot),
      onclick: () => { st.sel = u.slot; render(); } }, el("b", { text: "U" + String(u.slot + 1).padStart(2, "0") }), el("span", { text: u.used ? u.name : "Empty" }), el("small", { text: u.used ? engName(u.engine) + (u.cat ? " · " + CATS[u.cat] : "") : "" }))));
    const name = el("input", { type: "text", class: "nm", maxlength: 12, value: cur.used ? cur.name : "", placeholder: "Name", "aria-label": "Name", spellcheck: "false" });
    const cat = el("select", { class: "pickbtn", "aria-label": "Category" }, CATS.map((c, i) => el("option", { value: String(i), text: c, selected: i === cur.cat ? "" : null })));
    const id = "U" + String(cur.slot + 1).padStart(2, "0");
    const side = el("div", { class: "card side" },
      el("div", { class: "lab" }, el("span", { text: id }), el("output", { text: cur.used ? engName(cur.engine) : "Empty" })),
      cur.used ? el("div", { class: "field" }, el("span", { class: "nm", text: "Name" }), name) : null,
      cur.used ? el("div", { class: "field" }, el("span", { class: "nm", text: "Category" }), cat) : null,
      cur.used ? el("button", { class: "btn", onclick: () => upEdit(cur.slot, (name.value.trim() || cur.name).slice(0, 12), +cat.value), text: "Save name and category" }) : null,
      el("div", { class: "field" }, el("span", { class: "nm", text: "Track" }), trackSeg()),
      el("div", { class: "row" },
        cur.used ? el("button", { class: "btn grow red", onclick: () => upLoad(cur.slot), text: "Load" }) : null,
        el("button", { class: "btn grow", onclick: () => { st.sheet = { kind: "store", slot: cur.slot, used: cur.used }; render(); }, text: "Store here" }),
        cur.used ? el("button", { class: "btn", "aria-label": "Erase " + id, onclick: () => { st.sheet = { kind: "erase", slot: cur.slot, name: cur.name }; render(); } }, "Erase") : null),
      el("div", { class: "row" },
        el("button", { class: "btn grow", disabled: !cur.used, onclick: () => exportSounds([cur.slot]), text: "Export" }),
        el("button", { class: "btn grow", disabled: !st.ups.some((u) => u.used), onclick: () => exportSounds(st.ups.filter((u) => u.used).map((u) => u.slot)), text: "Export all" }),
        el("button", { class: "btn grow", onclick: () => soundFile.click(), text: "Import" })));
    return el("div", { class: "libbody" }, el("div", { class: "libmain" }, tiles, pager(32, per)), side, soundFile);
  }

  /* ---------------------------------------------------------- projects --- */
  async function loadProj() {
    const { parse, CMD, req } = A(), out = [];
    for (let k = 0; k < 4; k++) out.push(!!parse[CMD.PROJECT](await d().rq(req.project(2, k))).used);
    st.proj = out;
  }
  async function projOp(op, k) {
    st.busy = op === 1 ? "Saving (about 2 seconds)" : "Loading"; render();
    try {
      const r = A().parse[A().CMD.PROJECT](await d().rq(A().req.project(op, k), { timeout: 5000, retries: 0 }));
      if (op === 0) { await d().reload(); say(`Loaded project ${"ABCD"[k]}`); } else say(`Saved project ${"ABCD"[k]}`);
      await loadProj();
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  function projectsTab() {
    if (!st.proj) return el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    const k = Math.min(st.sel, 3), used = st.proj[k];
    return el("div", { class: "libbody" }, el("div", { class: "libmain" },
      el("div", { class: "tiles four" }, st.proj.map((u, i) => el("button", { class: "tile big" + (u ? "" : " free") + (k === i ? " sel" : ""), "aria-pressed": String(k === i), onclick: () => { st.sel = i; render(); } },
        el("b", { text: "ABCD"[i] }), el("span", { text: u ? "Saved" : "Empty" })))),
      el("p", { class: "hint", text: "A project holds all four tracks: sounds, steps, motion, the song and the mix. The songs on the Song screen play these four." })),
      el("div", { class: "card side" }, el("div", { class: "lab" }, el("span", { text: "Project " + "ABCD"[k] }), el("output", { text: used ? "Saved" : "Empty" })),
        el("button", { class: "btn red", disabled: !used, onclick: () => { st.sheet = { kind: "projload", k }; render(); }, text: "Load" }),
        el("button", { class: "btn", onclick: () => { if (used) { st.sheet = { kind: "projsave", k }; render(); } else projOp(1, k); }, text: "Save what is playing here" }),
        el("p", { class: "hint", text: "Saving writes the machine's flash and stops the transport for a moment." })));
  }

  /* ------------------------------------------------------------ voices --- */
  async function sendBank(packed, name) {
    st.busy = "Sending the voices"; st.prog = 0; render();
    try {
      const n = await (await import("./ext.js")).Ext.bankWrite(d(), packed, name, (f) => { st.prog = f; });
      say(`The machine's voice bank now holds ${n} voices`);
      st.bank = await ExtBank();
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  const bankFile = el("input", { type: "file", accept: ".syx,.SYX,.bin,application/octet-stream", hidden: true });
  own(bankFile).addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const FM6 = A().FM6, r = FM6.parseSysex(new Uint8Array(await f.arrayBuffer()));
      if (!r.voices.length) throw new Error("No six-operator voice in " + f.name);
      st.sheet = { kind: "bankload", file: f.name, voices: r.voices.slice(0, 32).map((v) => FM6.pack(Uint8Array.from(v.v))), name: f.name.replace(/\.[^.]*$/, "").slice(0, 10) }; render();
    } catch (x) { say(x.message, "error"); }
  });
  function voicesTab() {
    if (!st.bank) return el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    const b = st.bank, per = 12, p = Math.min(st.page, 2);
    const fm6 = d().tracks.map((t, i) => [t, i]).filter(([t]) => t.engineName === "FM6");
    const k = st.sel;
    const v = b.voices[k];
    const tiles = el("div", { class: "tiles three" }, Array.from({ length: per }, (_, i) => p * per + i).filter((i) => i < 32).map((i) => {
      const u = b.voices[i];
      return el("button", { class: "tile" + (u && u.used ? "" : " free") + (k === i ? " sel" : ""), "aria-pressed": String(k === i), onclick: () => { st.sel = i; render(); } },
        el("b", { text: "B" + (i + 1) }), el("span", { text: u && u.used ? u.name || "Voice" : "Empty" }));
    }));
    const side = el("div", { class: "card side" },
      el("div", { class: "lab" }, el("span", { text: b.has ? b.name || "Bank" : "No bank" }), el("output", { text: b.has ? b.voices.filter((x) => x.used).length + " voices" : "" })),
      v && v.used ? el("div", { class: "field" }, el("span", { class: "nm", text: "Play B" + (k + 1) + " on" }),
        el("div", { class: "seg", role: "group", "aria-label": "FM6 track" }, fm6.length ? fm6.map(([t, i]) => el("button", { "aria-pressed": "false", onclick: async () => { try { await d().setParam(i, d().info.pe0 + 7, 9 + k); say(`Track ${i + 1} plays B${k + 1}`); } catch (e) { say(e.message, "error"); } } }, el("b", { text: String(i + 1) }), " ", t.name)) : [el("button", { disabled: true, text: "No FM6 track" })]))
        : el("p", { class: "hint", text: "Pick a filled voice to play it on an FM6 track." }),
      el("button", { class: "btn red", onclick: () => bankFile.click(), text: "Replace the bank from a file" }),
      el("button", { class: "btn", disabled: !b.has, onclick: () => { st.sheet = { kind: "bankclear" }; render(); }, text: "Empty the bank" }),
      el("p", { class: "hint", text: "The bank takes up to 32 voices from a .syx file. The machine cannot send its voices back, so keep the file." }));
    return el("div", { class: "libbody" }, el("div", { class: "libmain" }, tiles, pager(32, per)), side, bankFile);
  }

  /* ----------------------------------------------------------- samples --- */
  async function loadSmp() { const { parse, CMD, req } = A(); st.smp = parse[CMD.SMP_INFO](await d().rq(req.smpInfo(), { timeout: 1000 })); }
  async function decode(file) {
    const buf = await file.arrayBuffer(), S = A().SMP;
    let sr, x;
    try { ({ sr, x } = A().parseWav(buf)); }
    catch (e) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const ab = await ac.decodeAudioData(buf.slice(0)); ac.close();
      sr = ab.sampleRate; x = new Float32Array(ab.length);
      for (let c = 0; c < ab.numberOfChannels; c++) { const ch = ab.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] += ch[i] / ab.numberOfChannels; }
    }
    const raw = A().resample(x, sr, S.RATE);
    return { file: file.name, raw, root: A().rootFromName(file.name), trim: true };
  }
  const zoneSamples = (z) => { if (!z.trim) return A().takeSample(z.raw, 0, z.raw.length); const [a, b] = A().autoTrim(z.raw); return A().takeSample(z.raw, a, b); };
  const draftBytes = () => st.draft.zones.reduce((n, z) => n + Math.ceil(zoneSamples(z).length / 2), 0);
  const smpFile = el("input", { type: "file", accept: "audio/*,.wav", multiple: true, hidden: true });
  own(smpFile).addEventListener("change", async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    for (const f of files) {
      if (st.draft.zones.length >= A().SMP.MAX_ZONES) { say("A slot holds 16 sounds at most", "error"); break; }
      try { const z = await decode(f); st.draft.zones.push(z); if (!st.draft.name) st.draft.name = f.name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 8).toUpperCase(); }
      catch (x) { say(`${f.name}: ${x.message}`, "error"); }
    }
    render();
  });
  async function upload(k) {
    st.busy = "Sending"; st.prog = 0; render();
    try {
      const { parse, CMD, req, SMP } = A();
      const { hdr, data } = A().buildSlot(st.draft.name || "SAMPLE", st.draft.zones.map((z) => ({ s: zoneSamples(z), root: z.root })));
      let r = parse[CMD.SMP_BEGIN](await d().rq(req.smpBegin(k), { timeout: 2000, retries: 0 }));
      if (r.rc) throw new Error("The machine refused to start (code " + r.rc + ")");
      for (let off = 0; off < data.length; off += 256) {
        const w = parse[CMD.SMP_WRITE](await d().rq(req.smpWrite(k, SMP.DATA_OFF + off, data.subarray(off, off + 256)), { timeout: 1500, retries: 1 }));
        if (w.rc) throw new Error("Write failed (code " + w.rc + ")");
        st.prog = Math.min(1, (off + 256) / data.length); render();
      }
      r = parse[CMD.SMP_END](await d().rq(req.smpEnd(k, hdr), { timeout: 3000, retries: 0 }));
      if (r.rc) throw new Error("The machine rejected the sample (code " + r.rc + ")");
      st.draft = { name: "", zones: [] }; await loadSmp(); say(`Sample slot ${k + 1} written`);
    } catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  async function smpErase(k) {
    st.busy = "Erasing"; render();
    try { const r = A().parse[A().CMD.SMP_ERASE](await d().rq(A().req.smpErase(k), { timeout: 4000, retries: 0 })); if (r.rc) throw new Error("Could not erase (code " + r.rc + ")"); await loadSmp(); say("Slot erased"); }
    catch (e) { say(e.message, "error"); }
    st.busy = ""; render();
  }
  function samplesTab() {
    if (!st.smp) return el("div", { class: "empty" }, el("p", { text: "Reading..." }));
    const k = Math.min(st.sel, st.smp.nslots - 1), S = A().SMP, cap = S.SLOT_SIZE - S.DATA_OFF, used = draftBytes();
    const slots = el("div", { class: "tiles three" }, st.smp.slots.map((s, i) => el("button", { class: "tile big" + (s.zones ? "" : " free") + (k === i ? " sel" : ""), "aria-pressed": String(k === i), onclick: () => { st.sel = i; render(); } },
      el("b", { text: "USR" + (i + 1) }), el("span", { text: s.zones ? s.name || "Sample" : "Empty" }), el("small", { text: s.zones ? `${s.zones} ${s.zones === 1 ? "sound" : "sounds"}, ${s.kib} KiB` : "" }))));
    const zones = st.draft.zones.map((z, i) => el("div", { class: "zone" },
      el("span", { class: "zname", title: z.file, text: z.file }),
      el("div", { class: "stepper small" }, el("button", { "aria-label": "Root note down", onclick: () => { z.root = Math.max(0, z.root - 1); render(); } }, ic("minus")),
        el("output", { text: A().noteName(z.root) }), el("button", { "aria-label": "Root note up", onclick: () => { z.root = Math.min(127, z.root + 1); render(); } }, ic("plus"))),
      el("button", { class: "btn", "aria-pressed": String(z.trim), onclick: () => { z.trim = !z.trim; render(); }, text: z.trim ? "Trimmed" : "Whole" }),
      el("button", { class: "btn", "aria-label": "Remove " + z.file, onclick: () => { st.draft.zones.splice(i, 1); render(); } }, ic("close"))));
    const name = el("input", { type: "text", class: "nm", maxlength: 8, value: st.draft.name, placeholder: "Name", "aria-label": "Sample name", spellcheck: "false", oninput: (e) => { st.draft.name = e.target.value.toUpperCase(); } });
    return el("div", { class: "libbody" }, el("div", { class: "libmain" }, slots,
      el("div", { class: "card draft" }, el("div", { class: "lab" }, el("span", { text: "New sample for USR" + (k + 1) }), el("output", { text: `${kib(used)} of ${kib(cap)} KiB` })),
        zones.length ? el("div", { class: "zones" }, zones) : el("p", { class: "hint", text: "Add audio files. Each becomes a sound spread across the keys by its root note; a file named like piano_C4 takes C4. Audio is converted to the machine's 22 kHz format." }),
        el("div", { class: "row" }, name, el("button", { class: "btn", disabled: st.draft.zones.length >= S.MAX_ZONES, onclick: () => smpFile.click(), text: "Add audio" })))),
      el("div", { class: "card side" }, el("div", { class: "lab" }, el("span", { text: "USR" + (k + 1) }), el("output", { text: st.smp.slots[k].zones ? "In use" : "Empty" })),
        el("button", { class: "btn red", disabled: !st.draft.zones.length || used > cap, onclick: () => { st.sheet = { kind: "smpsend", k }; render(); }, text: used > cap ? "Too big" : "Send to the machine" }),
        el("button", { class: "btn", disabled: !st.smp.slots[k].zones, onclick: () => { st.sheet = { kind: "smperase", k }; render(); }, text: "Erase the slot" }),
        el("p", { class: "hint", text: `A slot holds ${st.smp.slotKiB} KiB and up to 16 sounds. The SAMPLE engine plays them as USR1 to USR3.` })), smpFile);
  }

  /* ------------------------------------------------------------- sheets --- */
  function sheet() {
    const s = st.sheet; if (!s) return null;
    const no = () => { st.sheet = null; render(); };
    const go = (fn) => () => { st.sheet = null; fn(); };
    if (s.kind === "store") return textSheet({ title: "Store track " + (st.t + 1) + " in U" + String(s.slot + 1).padStart(2, "0"), text: (s.used ? "This replaces the sound stored there. " : "") + "Leave the name empty and the machine names it.", yes: "Store", max: 12, onNo: no, onYes: (v) => { st.sheet = null; upStore(s.slot, v.trim()); } });
    if (s.kind === "soundimport") return askSheet({ title: `Write ${s.patches.length} sound${s.patches.length === 1 ? "" : "s"} from U${String(s.first + 1).padStart(2, "0")}?`, text: `${s.file}: ${s.patches.map((p) => p.name).slice(0, 4).join(", ")}${s.patches.length > 4 ? ", ..." : ""}. This replaces what is stored there.${s.skipped ? " " + s.skipped + " sound" + (s.skipped === 1 ? "" : "s") + " do not fit this machine and are left out." : ""}`, yes: "Write", danger: true, onNo: no, onYes: go(() => importSounds(s.patches, s.first)) });
    if (s.kind === "erase") return askSheet({ title: "Erase " + s.name + "?", text: "This removes the stored sound from the machine. It cannot be undone.", yes: "Erase", danger: true, onNo: no, onYes: go(() => upErase(s.slot)) });
    if (s.kind === "projload") return askSheet({ title: "Load project " + "ABCD"[s.k] + "?", text: "This replaces everything playing now: the sounds, steps, motion and mix of all four tracks.", yes: "Load", danger: true, onNo: no, onYes: go(() => projOp(0, s.k)) });
    if (s.kind === "projsave") return askSheet({ title: "Replace project " + "ABCD"[s.k] + "?", text: "What is saved there is overwritten by what is playing now.", yes: "Replace", danger: true, onNo: no, onYes: go(() => projOp(1, s.k)) });
    if (s.kind === "bankload") return textSheet({ title: `${s.voices.length} voices from ${s.file}`, text: "These replace the whole voice bank. Name the bank (10 letters).", value: s.name, max: 10, yes: "Send", onNo: no, onYes: (v) => { st.sheet = null; sendBank(s.voices, v); } });
    if (s.kind === "bankclear") return askSheet({ title: "Empty the voice bank?", text: "All 32 slots become empty. Tracks that play a bank voice keep it as their own patch.", yes: "Empty it", danger: true, onNo: no, onYes: go(() => sendBank([], "BANK")) });
    if (s.kind === "smpsend") return askSheet({ title: "Write USR" + (s.k + 1) + "?", text: st.smp.slots[s.k].zones ? "This replaces the sample stored there." : "This takes a few seconds.", yes: "Send", danger: !!st.smp.slots[s.k].zones, onNo: no, onYes: go(() => upload(s.k)) });
    if (s.kind === "smperase") return askSheet({ title: "Erase USR" + (s.k + 1) + "?", text: "The sample is removed from the machine. It cannot be undone.", yes: "Erase", danger: true, onNo: no, onYes: go(() => smpErase(s.k)) });
    return null;
  }

  const render = () => repaint(root, build);
  function build() {
    root.replaceChildren();
    if (!d()) return;
    const all = tabs();
    const rail = el("div", { class: "rail", role: "tablist", "aria-label": "Library" }, all.map(([k, label]) => el("button", { role: "tab", "aria-selected": String(k === st.tab), "aria-pressed": String(k === st.tab), text: label, onclick: () => show(k) })));
    const content = { sounds: soundsTab, projects: projectsTab, voices: voicesTab, samples: samplesTab }[st.tab]();
    const busy = st.busy ? el("div", { class: "busy", role: "status" }, el("b", { text: st.busy }), st.prog != null && /Send/.test(st.busy) ? el("progress", { max: "1", value: String(st.prog || 0) }) : null) : null;
    root.append(...[el("div", { class: "sbody" }, rail, content), sheet(), busy].filter(Boolean));
  }
  return { el: root, open, render, leave() {} };
}
