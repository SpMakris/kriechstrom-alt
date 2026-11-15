// The commands the upstream editor's protocol layer does not know yet (EDITOR_PROTOCOL.md): MENU settings, the FM6 voice bank,
// MIDI LEARN, the CUSTOM palette and the backup list; plus the optional feature tags of INFO. Each call takes the Device.

export const XC = { BACKUP_LIST: 65, MENU_DESC: 72, MENU_SET: 73, FM6B_BEGIN: 74, FM6B_WRITE: 75, FM6B_END: 76, FM6B_LIST: 77, LEARN_GET: 78, LEARN_SET: 79, PALETTE_GET: 80, PALETTE_SET: 81 };

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
    chain: trailer[0] === 16,
  };
}

const rc = (a) => a[0];
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

  /* backup list (the manifest is parsed by fm1backup.js when a backup is taken) */
  async backupList(d) { return d.rq([XC.BACKUP_LIST, []], { timeout: 3000, retries: 0 }); },
};
