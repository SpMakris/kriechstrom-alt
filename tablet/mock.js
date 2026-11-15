// A simulated FM-1 for developing without hardware: the upstream editor's mock device, wrapped so that it also
// answers the newer step fields (nudge, condition) and parameter locks, which the upstream mock does not simulate.
// Everything it does not handle goes to the upstream mock unchanged.

const HDR = [0x7D, 0x46, 0x4C];

export function makeMock(A) {
  const base = A.makeMockDevice();
  const bOut = [...base.access.outputs.values()][0];
  const bIn = [...base.access.inputs.values()][0];
  const { CMD } = A;

  const steps = Array.from({ length: 4 }, () => new Map());      /* track -> index -> full step arg bytes (no track byte) */
  const locks = [[], [], [], []];                                /* track -> [{step, id, value}] */
  const pend = [];                                               /* requests waiting for the upstream reply to patch */

  const port = { id: "mock", name: "KRIECHSTROM (simulated)", state: "connected", type: "output", open: async () => {} };
  const outPort = { ...port, send(data) { handle(Array.from(data)); } };
  const inPort = { ...port, type: "input", onmidimessage: null };
  const emit = (a) => inPort.onmidimessage && queueMicrotask(() => inPort.onmidimessage({ data: Uint8Array.from(a) }));
  const reply = (cmd, args) => emit([0xF0, ...HDR, cmd, ...args, 0xF7]);
  const sent = [];                                               /* realtime and other bytes the host sent (clock tests read this) */

  bIn.onmidimessage = (e) => {                                   /* upstream replies come back here */
    const d = Array.from(e.data);
    if (d[0] === 0xF0 && d[1] === HDR[0] && d[2] === HDR[1] && d[3] === HDR[2]) {
      const cmd = d[4], a = d.slice(5, -1);
      if (cmd === CMD.INFO) {                                    /* advertise the newer features this mock adds */
        const have = (t) => { for (let i = 0; i + 1 < a.length; i++) if (a[i] === t && a[i + 1] === 1) return true; return false; };
        if (!have(0x42)) { const k = a.findIndex((x, i) => x === 0x4D && a[i + 1] === 1 && a[i + 2] === 64); if (k >= 0) a.splice(k + 4, 0, 0x42, 1, 3); }   /* BACKUP caps follow the motion tag */
        emit([0xF0, ...HDR, cmd, ...a, 0x4C, 1, 1, 0x54, 1, 0x10, 0x4B, 1, 0x0B, ...(have(0x4E) ? [] : [0x4E, 1, 33]), 0x43, 1, 16, 0x45, 1, 5, ...(have(0x56) ? [] : [0x56, 1, 32]), ...(have(0x57) ? [] : [0x57, 1, 4]), 0xF7]);
        return;
      }
      if (cmd === CMD.TRACK_STEP || cmd === CMD.STEP_GET) {
        const withTrack = cmd === CMD.TRACK_STEP, t = withTrack ? a[0] : sel;
        const idx = withTrack ? a[1] : a[0];
        const mine = steps[t].get(idx);
        if (mine) { reply(cmd, withTrack ? [t, idx, ...mine] : [idx, ...mine]); return; }
        /* first read: upstream bytes + nudge (8 = none) + condition (0) */
        const head = withTrack ? a.slice(0, 2) : a.slice(0, 1);
        const body = a.slice(head.length);
        const ext = [...body.slice(0, 13), ...(body.length < 13 ? Array(13 - body.length).fill(0) : []), 8, 0];
        while (ext.length < 15) ext.push(0);
        if (body.length >= 13) ext[12] = body[12] ?? 1;          /* the ratchet byte */
        steps[t].set(idx, ext);
        reply(cmd, [...head, ...ext]);
        return;
      }
      emit(d);
      return;
    }
    emit(d);
  };

  let sel = 0;

  function handle(d) {
    if (d[0] !== 0xF0) { sent.push(d); return; }                 /* realtime and the like: record, nothing to answer */
    const cmd = d[4], a = d.slice(5, -1);
    if (cmd === CMD.TRACK && a.length === 1) sel = a[0];
    if (cmd === CMD.TRACK_STEP && a.length > 2) {                /* a write */
      const t = a[0], idx = a[1], body = a.slice(2);
      steps[t].set(idx, body);
      reply(cmd, [t, idx, ...body]);
      return;
    }
    if (cmd === CMD.STEP_SET) {
      const idx = a[0], body = a.slice(1);
      steps[sel].set(idx, body);
      reply(cmd, [idx, ...body]);
      return;
    }
    if (cmd === CMD.MOTION) { motion(a); return; }
    if (cmd >= 65 && cmd <= 67 || (bk.restoring && cmd >= 11 && cmd <= 14)) { backupOp(cmd, a); return; }
    if (cmd >= 72 && cmd <= 81) { extra(cmd, a); return; }
    if (cmd === CMD.SONG && a[0] >= 4) { songOp(a); return; }
    bOut.send(Uint8Array.from(d));
  }

  /* MENU settings, the FM6 voice bank, MIDI LEARN and the CUSTOM palette (the upstream mock has none of them) */
  const strB = (t) => [...Array.from(String(t), (c) => c.charCodeAt(0) & 127), 0];
  const E = (name, names, value, tab) => ({ name, kind: 0, names, min: 0, max: names.length - 1, value, tab });
  const menu = [E("COLOR", ["GREY", "GREEN", "AMBER", "ICE", "VIOLET", "ROSE", "PAPER", "HI-CON", "NIGHT", "MONO"], 0, 0), E("STYLE", ["FLAT", "LINE"], 0, 0),
    E("LARGE", ["OFF", "ON"], 0, 0), E("ANIM", ["ON", "OFF", "IDLE"], 0, 0), E("LEDS", ["OFF", "DIM LO", "DIM HI", "INV", "INV LO", "INV HI"], 2, 0),
    E("HOLD", ["0.3 s", "0.4 s", "0.5 s", "0.6 s"], 1, 1), E("KNOB ACCEL", ["OFF", "ON"], 0, 1), E("FX LATCH", ["OFF", "ON"], 0, 1), E("BPM LOCK", ["OFF", "ON"], 0, 1),
    E("SPEAKER EQ", ["FLAT", "LOWCUT", "BASS+"], 0, 2), E("USB LEVEL", ["MASTER", "FIXED"], 0, 2), E("USB SERIAL", ["ON", "OFF"], 0, 4),
    E("CLICK", ["OFF", "REC", "ON"], 0, 2), E("CLICK LEVEL", ["LOW", "MID", "HIGH"], 1, 2), E("COUNT-IN", ["OFF", "1 BAR", "2 BARS"], 0, 2),
    E("RESTORE LAST", ["ON", "OFF"], 0, 4), E("SCALE LEDS", ["OFF", "ON"], 0, 1), E("SCREEN OFF", ["NEVER", "5 MIN", "15 MIN", "30 MIN", "60 MIN"], 0, 0),
    E("SCOPE", ["OUT", "MIX"], 0, 0), E("STEP PREVIEW", ["OFF", "ON"], 0, 1), E("CHORD ENTRY", ["HOLD", "ADD"], 0, 1),
    E("MIDI IN", ["CH1-4", "SEL", "CH5-8", "CH9-12", "CH13-16", "TRACK"], 0, 3), { name: "TUNE", kind: 1, unit: "ct", min: -50, max: 50, value: 0, tab: 2 },
    E("HOME", ["SCOPE", "TRACKS", "LEVELS"], 0, 0), E("HELP", ["OFF", "ON"], 0, 4), E("SELECT", ["BPM", "PAGE", "MODW", "VEL"], 0, 1),
    ...[1, 2, 3, 4].map((k) => E("T" + k + " CHANNEL", [...Array.from({ length: 16 }, (_, i) => String(i + 1)), "OMNI", "OFF"], k - 1, 3)),
    E("AUTO SELECT", ["OFF", "ON"], 0, 3), E("SCREEN WAKE", ["+MIDI", "PANEL"], 0, 3), E("2ND CORE", ["OFF", "ON"], 0, 4)];
  const song = { secs: [{ slots: [0, 0, 0, 0], repeat: 2 }, { slots: [1, 1, 4, 0], repeat: 1 }], running: false, at: 0, left: 0 };
  function songOp(a) {
    let rc = 0;
    if (a[0] === 5) { const n = a[1]; if (a.length !== 2 + 5 * n || n > 16) rc = 1; else { song.secs = Array.from({ length: n }, (_, i) => ({ slots: a.slice(2 + 5 * i, 6 + 5 * i), repeat: a[6 + 5 * i] })); if (song.secs.some((x) => x.slots.some((v) => v > 4) || x.repeat < 1 || x.repeat > 16)) rc = 1; } }
    else if (a[0] === 6) { if (!song.secs.length) rc = 1; else { song.running = true; song.at = 0; song.left = song.secs[0].repeat; } }
    else if (a[0] === 7) song.running = false;
    reply(CMD.SONG, [a[0], rc, song.secs.length, song.running ? 1 : 0, song.at, song.left, ...song.secs.flatMap((x) => [...x.slots, x.repeat])]);
  }
  const tabNames = ["DISPLAY", "CONTROL", "AUDIO", "MIDI", "SYSTEM"];
  const learn = [];
  let pal = { stored: false, colors: [[1, 2, 5], [3, 20, 10], [30, 60, 30], [28, 8, 4], [10, 40, 12]] };
  const bank = { has: false, name: "", voices: Array(32).fill(null), staged: null };
  function extra(cmd, a) {
    if (cmd === 72) {
      const m = menu[a[0]];
      if (!m) return reply(72, [a[0], 127]);
      reply(72, [a[0], a[0], m.kind, ...enc14(m.value), ...enc14(m.min), ...enc14(m.max), ...strB(m.name), ...(m.kind === 0 ? m.names.flatMap(strB) : strB(m.unit)), m.tab, ...strB(tabNames[m.tab])]);
    } else if (cmd === 73) {
      const m = menu[a[0]], v = v14(a[1], a[2]);
      if (!m) return reply(73, [1, a[0], a[1], a[2]]);
      m.value = Math.max(m.min, Math.min(m.max, v));
      reply(73, [0, a[0], ...enc14(m.value)]);
    } else if (cmd === 74) { bank.staged = Array(32).fill(null); reply(74, [0]);
    } else if (cmd === 75) { if (!bank.staged || a.length !== 129) return reply(75, [a[0], bank.staged ? 1 : 5]); bank.staged[a[0]] = a.slice(1); reply(75, [a[0], 0]);
    } else if (cmd === 76) {
      if (!bank.staged) return reply(76, [5, 0]);
      bank.voices = bank.staged; bank.staged = null; bank.has = true; bank.name = String.fromCharCode(...a.slice(0, 10)).trim();
      reply(76, [0, bank.voices.filter(Boolean).length]);
    } else if (cmd === 77) {
      const nm = (p) => { const n = String.fromCharCode(...p.slice(118, 128)).replace(/[^ -~]/g, "").trim(); return n; };
      reply(77, [32, bank.has ? 1 : 0, ...(bank.has ? strB(bank.name) : []), ...(bank.has ? bank.voices.flatMap((p) => (p ? [1, ...strB(nm(p))] : [0, 0])) : [])]);
    } else if (cmd === 78 || cmd === 79) {
      let code = 0;
      if (cmd === 79) {
        if (a[0] === 0) { const i = learn.findIndex((l) => l.cc === a[1] || (l.track === a[2] && l.id === a[3])); if (i >= 0) learn.splice(i, 1); if (learn.length >= 16) code = 5; else learn.push({ cc: a[1], track: a[2], id: a[3] }); }
        else if (a[0] === 1) { const i = learn.findIndex((l) => l.cc === a[1]); if (i >= 0) learn.splice(i, 1); }
        else learn.length = 0;
      }
      reply(cmd, [...(cmd === 79 ? [code] : []), 16, ...Array.from({ length: 16 }, (_, i) => (learn[i] ? [1, learn[i].cc, learn[i].track, learn[i].id] : [0, 0, 0, 0])).flat()]);
    } else if (cmd === 80 || cmd === 81) {
      if (cmd === 81) { if (a[0] <= 1) { pal.colors = [0, 1, 2, 3, 4].map((k) => a.slice(1 + 3 * k, 4 + 3 * k)); if (a[0] === 1) pal.stored = true; } else if (a[0] === 2) pal.stored = false; }
      reply(cmd, [...(cmd === 81 ? [0] : []), (pal.stored ? 1 : 0) | (pal.stored ? 2 : 0), 5, ...pal.colors.flat()]);
    }
  }

  function v14(lo, hi) { return (lo | (hi << 7)) - 8192; }
  function enc14(v) { const u = Math.max(-8192, Math.min(8191, v)) + 8192; return [u & 0x7F, (u >> 7) & 0x7F]; }
  /* the whole-machine backup (BACKUP 65..67): 13 objects of fixed bytes; a restore stages, checks the CRC and replaces */
  const crc32 = (u) => { let c = ~0; for (const b of u) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const u32 = (n) => [n & 127, n >>> 7 & 127, n >>> 14 & 127, n >>> 21 & 127, n >>> 28 & 15];
  const r32 = (x, i) => (x[i] | x[i + 1] << 7 | x[i + 2] << 14 | x[i + 3] << 21 | x[i + 4] << 28) >>> 0;
  const BK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 32, 33, 34];
  const bk = { restoring: false, staged: null, objs: new Map(BK.map((id) => [id, id === 8 || id > 9 ? new Uint8Array(0) : Uint8Array.from({ length: 300 + id * 10 }, (_, i) => (i * 7 + id * 13) & 255)])), log: [] };
  const pack7 = (u) => { const o = []; for (let i = 0; i < u.length; i += 7) { const g = u.subarray(i, i + 7); let hi = 0; g.forEach((b, k) => { hi |= (b >> 7) << k; }); o.push(hi, ...g.map((b) => b & 127)); } return o; };
  const unpack7 = (a, n) => { const o = []; for (let i = 0; i < a.length; i += 8) { const hi = a[i]; for (let k = 1; k < 8 && i + k < a.length; k++) o.push(a[i + k] | (hi >> (k - 1) & 1) << 7); } return o.slice(0, n); };
  function backupOp(cmd, a) { try { backupOp2(cmd, a); } catch (e) { console.error("backupOp", cmd, a.slice(0, 4), e.message); } }
  function backupOp2(cmd, a) {
    if (cmd === 65) return reply(65, [1, 0, BK.length, ...BK.flatMap((id) => { const v = bk.objs.get(id); return [id, ...u32(v.length), ...u32(v.length ? crc32(v) : 0)]; })]);
    if (cmd === 66) { const id = a[0], off = r32(a, 1), n = a[6] | a[7] << 7, v = bk.objs.get(id); return reply(66, [id, 0, ...u32(off), n & 127, n >> 7, ...pack7(v.subarray(off, off + n))]); }
    if (cmd <= 14) return reply(cmd, [a[0], 0]);
    const [op, id] = a;
    if (op === 0) { bk.restoring = true; bk.staged = { id, size: r32(a, 2), crc: r32(a, 7), bytes: [] }; }
    else if (op === 1) { const off = r32(a, 2); bk.staged.bytes.push(...unpack7(a.slice(7), Math.min(256, bk.staged.size - off))); }
    else if (op === 2) { const u = Uint8Array.from(bk.staged.bytes), ok = crc32(u) === bk.staged.crc; if (!ok) return reply(67, [op, id, 2]); bk.objs.set(id, u); bk.log.push(id); if (id === 0) bk.restoring = false; }
    else if (op === 3) bk.restoring = false;
    reply(67, [op, id, 0]);
  }

  const autos = [[], [], [], []], mon = [true, true, true, true];
  function motion(a) {
    const t = a[0], op = a[1] | 0, all = () => [...autos[t].map((r) => ({ ...r, kind: 0 })), ...locks[t].map((r) => ({ ...r, kind: 1 }))];
    const total = () => autos.flat().length + locks.flat().length;
    if (op === 1) mon[t] = !!a[2];
    else if (op === 2) autos[t] = [];
    else if (op === 3 || op === 5) {
      const list = op === 3 ? autos[t] : locks[t], step = a[2], id = a[3], value = v14(a[4], a[5]);
      const i = list.findIndex((l) => l.step === step && l.id === id);
      if (i >= 0) list[i].value = value; else if (total() >= 64) return reply(CMD.MOTION, [t, 2, mon[t] ? 1 : 0, 0, 64]);
      else list.push({ step, id, value });
    } else if (op === 4) {
      autos[t] = autos[t].filter((l) => !(l.step === a[2] && l.id === a[3])); locks[t] = locks[t].filter((l) => !(l.step === a[2] && l.id === a[3]));
    } else if (op === 6) locks[t] = a[2] === 127 ? [] : locks[t].filter((l) => l.step !== a[2]);
    const recs = all(), body = recs.flatMap((l) => [l.step, l.id, ...enc14(l.value)]), on = mon[t] ? 1 : 0;
    if (op === 8) reply(CMD.MOTION, [t, 0, on, recs.length & 0x7F, recs.length >> 7, 0, 1, ...body, ...recs.map((r) => r.kind)]);
    else if (op >= 5) reply(CMD.MOTION, [t, 0, on, recs.length, 64, ...body, ...recs.map((r) => r.kind)]);
    else reply(CMD.MOTION, [t, 0, on, recs.length, 64, ...body]);
  }

  return { access: { inputs: new Map([["i", inPort]]), outputs: new Map([["o", outPort]]), onstatechange: null }, sent, steps, locks, autos, bk, base };
}
