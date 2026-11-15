// Compares the tablet's simulated machine (mock.js) with the firmware, byte for byte, for what the Sound screen reads: INFO, the
// preset names and edit-page titles of every engine (NAMES), the description of every track parameter for every engine
// and of every global (DESC). The firmware's answers are fw_desc.txt, made by the firmware's own host test:
//
//   KRST_DESC_DUMP=1 editor_test > tablet/fw_desc.txt     (vendor/kriechstrom/tests/editor_test.c, desc_dump)
//
// node tablet/fwcheck.mjs [--show]   exit 1 when the simulated machine says anything else than the firmware.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadProtocol } from "./proto.js";
import { makeMock } from "./mock.js";

globalThis.fetch = async (u) => ({ ok: true, status: 200, text: async () => readFileSync(fileURLToPath(u), "utf8") });
const A = await loadProtocol();
const fw = readFileSync(new URL("./fw_desc.txt", import.meta.url), "utf8").trim().split("\n").map((l) => { const [tag, a, b, hex] = l.split(" "); return { tag, a: +a, b: +b, hex: hex || "" }; });

const m = makeMock(A);
const out = [...m.access.outputs.values()][0], inp = [...m.access.inputs.values()][0];
const pending = [];
inp.onmidimessage = (e) => pending.shift()?.(Array.from(e.data));
const ask = (cmd, args) => new Promise((res) => { pending.push(res); out.send([0xF0, 0x7D, 0x46, 0x4C, cmd, ...args, 0xF7]); setTimeout(() => res(null), 400); });
const hex = (f) => (f ? f.slice(4, -1).map((b) => b.toString(16).padStart(2, "0")).join("") : "");

const { CMD } = A, bad = [];
let n = 0;
const infoKey = (h) => { const b = h.match(/../g) || []; let p = 0; while (p < b.length - 2 && !(b[p] === "53" && b[p + 1] === "01")) p += 1; const t = []; while (p + 2 < b.length) { const n = 2 + parseInt(b[p + 1], 16) + (b[p] === "41" ? 1 : 0); t.push(b.slice(p, p + n).join("")); p += n; } return t.sort().join(" "); };    /* (tag, length, value; MOTION 41 sends its 14-bit value as two bytes under length 1) */
for (let r of fw) {
  let got;
  if (r.tag === "I") got = hex(await ask(CMD.INFO, []));
  else if (r.tag === "N") { await ask(CMD.PRESET, [r.a, 0]); got = hex(await ask(CMD.NAMES, [r.a])); }
  else if (r.tag === "D0") { if (r.b === 0) await ask(CMD.PRESET, [r.a, 0]); got = hex(await ask(CMD.DESC, [0, r.b])); }
  else got = hex(await ask(CMD.DESC, [1, r.b]));
  n++;
  if (r.tag === "I") { r = { ...r, hex: infoKey(r.hex) }; got = infoKey(got); }       /* INFO: the capability tags as a set; the version text is the build's own */
  if (got !== r.hex) bad.push({ ...r, got });
}
const text = (h) => { const b = h.match(/../g)?.map((x) => parseInt(x, 16)) || []; return b.map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : c === 0 ? "|" : ".")).join(""); };
const byKind = {};
for (const b of bad) byKind[b.tag] = (byKind[b.tag] || 0) + 1;
console.log(`${n} answers compared, ${bad.length} differ`, JSON.stringify(byKind));
if (process.argv.includes("--show")) for (const b of bad.slice(0, 400)) console.log(b.tag === "I" ? `I
  firmware ${b.hex}
  mock     ${b.got}` : `${b.tag} eng ${b.a} id ${b.b}
  firmware ${text(b.hex)}
  mock     ${text(b.got)}`);
process.exit(bad.length ? 1 : 0);
