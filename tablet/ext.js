// The commands the upstream editor's protocol layer does not know yet (EDITOR_PROTOCOL.md): MENU settings, the FM6 voice bank,
// MIDI LEARN, the CUSTOM palette and the backup list; plus the optional feature tags of INFO. Each call takes the Device.

export const XC = { BACKUP_LIST: 65, MENU_DESC: 72, MENU_SET: 73, FM6B_BEGIN: 74, FM6B_WRITE: 75, FM6B_END: 76, FM6B_LIST: 77, LEARN_GET: 78, LEARN_SET: 79, PALETTE_GET: 80, PALETTE_SET: 81, PERF: 82, KEYMAP: 83, SLICE: 84, DRUMMUTE: 85, CLEARALL: 86, MLEARN: 87, KIT_LANE: 88, KIT_SET: 89, KIT_INFO: 90, KIT_SLOT: 91, KIT_SEED: 92, KIT_CHANGED: 93 };

/* the tagged blocks of INFO's trailer: `tag 01 value`. Absent = the firmware has not got the feature. */
export function tags(trailer) {
  const at = (tag, ok) => { for (let i = 0; i + 2 < trailer.length; i++) if (trailer[i] === tag && trailer[i + 1] === 1 && ok(trailer[i + 2])) return trailer[i + 2]; return 0; };
  return {
    menu: at(0x4E, (v) => v >= 12 && v <= 80),
    learn: at(0x43, (v) => v === 16),
    palette: at(0x45, (v) => v === 5),
    bank: at(0x56, (v) => v === 32),
    sections: at(0x57, (v) => v === 4),
    backup: at(0x42, (v) => v >= 1 && v <= 3),
    krst: at(0x58, (v) => v > 0 && v <= 127),                    /* the tablet commands: bit 0 PERF, 1 KEYMAP, 2 SLICE, 3 DRUMMUTE, 4 CLEARALL, 5 HISS, 6 MLEARN */
    kit: at(0x59, (v) => v === 1),                               /* the USER drum kit: cmds 88..93 (every number of the kit tables) */
    chain: trailer[0] === 16,
  };
}

const rc = (a) => a[0];
/* the effects of the FX layer, by their number in the firmware (perform.c PF_*): the keys' map holds these */
export const FX = ["REPEAT 1/8", "REPEAT 1/16", "REPEAT 1/32", "REVERSE", "LOW PASS", "HIGH PASS", "TAPE STOP", "FREEZE", "OCT UP", "OCT DOWN", "FLANGER", "PHASER", "REV THROW", "ECHO THROW", "ROLL", "GATE 1/32", "CRUSH SWEEP", "RANDOM"];
export const FX_SHORT = ["1/8", "1/16", "1/32", "REV", "LPF", "HPF", "STOP", "FRZ", "OCT+", "OCT-", "FLNG", "PHSR", "VERB", "ECHO", "ROLL", "GATE", "CRSW", "RAND"];
export const FX_NONE = 22;
export const KRST = { PERF: 1, KEYMAP: 2, SLICE: 4, DRUMMUTE: 8, CLEARALL: 16, HISS: 32, MLEARN: 64 };
const b3 = (n) => [n & 127, (n >> 7) & 127, (n >> 14) & 127];
const r3 = (x, i) => x[i] | (x[i + 1] << 7) | (x[i + 2] << 14);
const u32 = (n) => Array.from({ length: 5 }, (_, i) => (n >>> (i * 7)) & (i === 4 ? 15 : 127));

export const Ext = {
  /* MENU: every item the device describes, by tab */
  async menu(d) {
    const { Reader } = d.A, items = [];
    const count = d.tags.menu;
    for (let i = 0; i < count; i++) {
      const r = new Reader(await d.rq([XC.MENU_DESC, [i]]));
      const index = r.b(), id = r.b();
      if (id === 127) break;
      const it = { index, id, kind: r.b(), value: r.v(), min: r.v(), max: r.v(), name: r.s(), names: [], unit: "", tab: 0, tabName: "" };
      if (it.kind === 0) for (let k = it.min; k <= it.max; k++) it.names.push(r.s()); else if (it.kind === 1) it.unit = r.s();
      try { it.tab = r.b(); it.tabName = r.s(); } catch (e) { it.tab = 0; it.tabName = ""; }
      items.push(it);
    }
    return items;
  },
  async menuSet(d, id, value) {
    const { Reader, v14enc } = d.A, r = new Reader(await d.rq([XC.MENU_SET, [id, ...v14enc(value)]]));
    return { rc: r.b(), id: r.b(), value: r.v() };
  },

  /* MIDI LEARN */
  learnParse(d, a, skipRc) {
    const { Reader } = d.A, r = new Reader(a), code = skipRc ? r.b() : 0, n = r.b(), list = [];
    for (let i = 0; i < n; i++) { const used = r.b(), cc = r.b(), track = r.b(), id = r.b(); if (used) list.push({ cc, track, id }); }
    return { rc: code, list };
  },
  async learnGet(d) { return Ext.learnParse(d, await d.rq([XC.LEARN_GET, []]), false); },
  async learnSet(d, op, cc, track, id) {
    const args = op === 0 ? [0, cc, track, id] : op === 1 ? [1, cc] : [2];
    return Ext.learnParse(d, await d.rq([XC.LEARN_SET, args]), true);
  },

  /* CUSTOM palette: five colours of RGB565 as three 7-bit bytes: r 0..31, g 0..63, b 0..31 */
  paletteParse(a, skipRc) {
    let i = 0; const code = skipRc ? a[i++] : 0, flags = a[i++], n = a[i++], colors = [];
    for (let k = 0; k < n; k++) { colors.push([a[i], a[i + 1], a[i + 2]]); i += 3; }
    return { rc: code, stored: !!(flags & 1), inUse: !!(flags & 2), colors };
  },
  async paletteGet(d) { return Ext.paletteParse(await d.rq([XC.PALETTE_GET, []]), false); },
  async paletteSet(d, op, colors) {
    const args = op <= 1 ? [op, ...colors.flat()] : [op];
    return Ext.paletteParse(await d.rq([XC.PALETTE_SET, args], { key: op === 0 ? "pal-preview" : undefined }), true);
  },

  /* FM6 voice bank (32 voices of 128 packed bytes) */
  async bankList(d) {
    const { Reader } = d.A, r = new Reader(await d.rq([XC.FM6B_LIST, []]));
    const n = r.b(), has = r.b(), name = has ? r.s() : "", voices = [];
    if (!has) return { n, has: false, name: "", voices: [] };
    for (let i = 0; i < n; i++) { const used = r.b(); voices.push({ used: !!used, name: r.s() }); }
    return { n, has: true, name, voices };
  },
  /* packed: array of up to 32 entries (Uint8Array(128) or null) */
  async bankWrite(d, packed, name, progress = () => {}) {
    const check = (code, what) => { if (code) throw new Error(({ 1: "bad arguments", 2: "checksum mismatch", 3: "playback did not stop", 4: "flash error", 5: "no transfer" })[code] ? `Voice bank ${what}: ${({ 1: "bad arguments", 2: "checksum mismatch", 3: "playback did not stop", 4: "flash error", 5: "transfer lost, start again" })[code]}` : `Voice bank ${what}: error ${code}`); };
    check(rc(await d.rq([XC.FM6B_BEGIN, []], { timeout: 3000, retries: 0 })), "begin");
    const all = [];
    for (let i = 0; i < 32; i++) {
      const p = packed[i]; if (!p) continue;
      const a = await d.rq([XC.FM6B_WRITE, [i, ...Array.from(p, (x) => x & 127)]], { timeout: 1500, retries: 0 });
      check(a[1], "write " + (i + 1)); all.push(...p); progress((i + 1) / 32);
    }
    const nm = Array.from((name || "BANK").toUpperCase().replace(/[^\x20-\x7E]/g, "").padEnd(10, " ").slice(0, 10), (c) => c.charCodeAt(0));
    const a = await d.rq([XC.FM6B_END, [...nm, ...u32(d.A.crc32(Uint8Array.from(all)))]], { timeout: 4000, retries: 0 });
    check(a[0], "end");
    return a[1];
  },

  /* PERF: what the FX layer holds with a key (the effects as a bit mask), the four macros (FILTER -100..100, CRUSH, THROW,
   * DEPTH 0..100), SOLO (a bit per track), FILL. The machine lets everything go 600 ms after the last frame: send it again
   * while a finger is down. No state: only the answer. */
  perfParse(a) {
    return { mask: r3(a, 0), k: [a[3] * 2 - 100, a[4], a[5], a[6]], solo: a[7], fill: a[8], avail: r3(a, 9), act: r3(a, 12), device: r3(a, 15), latch: !!a[18], kill: !!a[19] };
  },
  async perf(d, s) {
    const args = s ? [...b3(s.mask), Math.round((s.k[0] + 100) / 2), s.k[1], s.k[2], s.k[3], s.solo, s.fill ? 1 : 0] : [];
    return Ext.perfParse(await d.rq([XC.PERF, args], { key: "perf", timeout: 400, retries: 0, quiet: true }));
  },

  /* the keys' map of the FX layer: 16 white keys F3..G5, each an effect (FX) or FX_NONE */
  async keymap(d, op) {
    const a = await d.rq([XC.KEYMAP, op ? (op.reset ? [127] : [op.key, op.fx]) : []]);
    return { rc: a[0], map: a.slice(1, 17) };
  },

  /* MAN slices of a user slot 0..2: starts and end in samples; man false: the AUTO slices are shown */
  sliceParse(a) {
    const o = { slot: a[0], rc: a[1], man: !!a[2], len: r3(a, 3), n: a[6], end: r3(a, 7), pos: [] };
    for (let i = 0; i < o.n; i++) o.pos.push(r3(a, 10 + 3 * i));
    return o;
  },
  async slice(d, slot, set) {
    const args = set ? [slot, set.pos.length, ...b3(set.end || 0), ...set.pos.flatMap(b3)] : [slot];
    return Ext.sliceParse(await d.rq([XC.SLICE, args], { timeout: 1000 }));
  },

  /* DRUM lane mutes of a track: bit l = lane l muted */
  async drumMute(d, track, mask) {
    const a = await d.rq([XC.DRUMMUTE, mask == null ? [track] : [track, mask & 127, (mask >> 7) & 1]]);
    return a[1] | (a[2] << 7);
  },

  /* CLEAR ALL: the music as a new project; stored projects, user presets, samples, settings and MIDI LEARN stay */
  async clearAll(d) { return (await d.rq([XC.CLEARALL, [0x59]], { timeout: 3000, retries: 0 }))[0]; },

  /* MIDI LEARN on / off (GLO + D4 on the machine); no argument reads it */
  async mlearn(d, on) { return !!(await d.rq([XC.MLEARN, on == null ? [] : [on ? 1 : 0]]))[0]; },

  /* the USER drum kit (editor_kit.c): 8 lanes of fields, each with its name and range, in the order the machine pages them. A lane
   * answers as {lane, run, fields: [{f, v, lo, hi, name}]} (values 3 x 7 bit, offset 1024) */
  kitLaneParse(d, a) {
    const { Reader } = d.A, r = new Reader(a), num = () => r.b() | (r.b() << 7) | (r.b() << 14), o = { lane: r.b(), run: r.b(), fields: [] }, n = r.b();
    for (let i = 0; i < n; i++) o.fields.push({ f: r.b(), v: num() - 1024, lo: num() - 1024, hi: num() - 1024, name: r.s() });
    return o;
  },
  async kitInfo(d) {
    const { Reader } = d.A, r = new Reader(await d.rq([XC.KIT_INFO, []])), nr = r.b(), nl = r.b(), ns = r.b(), used = r.b(), working = r.b(), nseed = r.b();
    const list = (n) => Array.from({ length: n }, () => r.s());
    return { nlanes: nl, nsaved: ns, used, working: !!working, runs: list(nr), seeds: list(nseed), kits: list(ns) };
  },
  async kitLane(d, lane) { return Ext.kitLaneParse(d, await d.rq([XC.KIT_LANE, [lane]], { timeout: 600 })); },
  /* one number; the answer is the whole lane (the value in its range, a paired number given way, a RUN change: the fields of the new run) */
  async kitSet(d, lane, f, v) { return Ext.kitLaneParse(d, await d.rq([XC.KIT_SET, [lane, f, ...b3(v + 1024)]], { key: "kit-" + lane + "-" + f, timeout: 600, retries: 0 })); },
  /* op 1 SAVE (k, name), 2 LOAD, 3 ERASE: {rc: 0 done, 1 bad slot, name or empty kit, 2 flash error or the transport runs, 3 kept in RAM only, used} */
  async kitSlot(d, op, k, name) {
    const args = op === 1 ? [1, k, ...Array.from(name, (c) => c.charCodeAt(0) & 127)] : [op, k], a = await d.rq([XC.KIT_SLOT, args], { timeout: 3000, retries: 0 });
    return { rc: a[2], used: a[3] };
  },
  /* a model kit (1..8 of KIT.seeds) into every lane, or into one lane from a lane of it */
  async kitSeed(d, nib, lane, src) { return (await d.rq([XC.KIT_SEED, lane == null ? [127, nib] : [lane, nib, src]], { timeout: 1000 }))[0]; },

  /* backup list (the manifest is parsed by fm1backup.js when a backup is taken) */
  async backupList(d) { return d.rq([XC.BACKUP_LIST, []], { timeout: 3000, retries: 0 }); },
};
