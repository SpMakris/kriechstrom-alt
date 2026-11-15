// SEQ TOOLS of the firmware (vendor/kriechstrom/firmware/src/ui_tools.c and krst_dice.c), ported step for step so the tablet
// does what the machine's own tools do. Every function changes `steps` (the track's steps 1..LEN as step objects, see steps.js)
// in place and returns the machine's message. `c` = { drum, root (0..11), mask (the scale's bits), index (track 0..3), lane, laneOf }.
// The machine draws from an unseeded generator: so does this (Math.random), each press differs.

import { TIME, FLAG, stepLaneMask } from "./steps.js";

/* the machine's table, bit i = i semitones above the root: CHR MAJ MIN DOR MIX PEN MPEN HARM PHRY LYD LOC MEL BLUES WHOLE DIMHW DIMWH */
export const SCALE_BITS = [
  0xFFF,
  (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 11),
  (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 4) | (1 << 7) | (1 << 9),
  (1 << 0) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 11),
  (1 << 0) | (1 << 1) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 9) | (1 << 11),
  (1 << 0) | (1 << 1) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 8) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 11),
  (1 << 0) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 4) | (1 << 6) | (1 << 8) | (1 << 10),
  (1 << 0) | (1 << 1) | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 9) | (1 << 10),
  (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 8) | (1 << 9) | (1 << 11),
];

const DV = { KICK: 0, SNARE: 1, CLAP: 2, HATC: 3, HATO: 4, TOM: 5, RIM: 6, BELL: 7 }, NLANE = 8;
export const MOODS = ["MACHINE", "GRIND", "MARCH 7/8", "GLITCH", "SPIRAL", "GHOST", "SURGE", "HUSH"];
export const MOOD_WORDS = ["Machine", "Grind", "March", "Glitch", "Spiral", "Ghost", "Surge", "Hush"];

const rnd = (n) => (n ? Math.floor(Math.random() * n) : 0);
const rng = () => Math.floor(Math.random() * 4294967296) >>> 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bits = (s) => { let b = 0; for (let i = 0; i < 16 && i < s.length; i++) if (s[i] !== ".") b |= 1 << i; return b >>> 0; };
const ch = (p) => rnd(100) < p;
const pick = (a) => a[rnd(3)];

export function clear(s) { s.n = 0; s.notes = [0, 0, 0, 0]; s.time = TIME.REST; s.flags = 0; s.vel = 0; s.hit = 0; s.acc = 0; s.chance = 100; s.cond = 0; s.ratchet = 1; s.nudge = 0; }
const gate = (s) => s.time === TIME.NOTE && s.n > 0;
const lanes = (s, c) => stepLaneMask(s, c.laneOf);
const lane = (s, l, c) => (lanes(s, c) >> l) & 1;
const accents = (s) => s.acc | 0;

/* a hit on lane l of step s (ui.c grid_hit): notes on lanes become hits first */
function hit(s, l, on, c) {
  const b = 1 << (l % NLANE);
  if (on === 2) on = !(lanes(s, c) & b);
  if (s.time !== TIME.NOTE) { if (!on) return; clear(s); s.time = TIME.NOTE; }
  const own = lanes(s, c);
  s.notes = [0, 0, 0, 0]; s.n = 0; s.hit = own;
  if (on) s.hit |= b; else { s.hit &= ~b; s.acc &= ~b; }
  s.acc &= s.hit;
  if (!s.vel) s.vel = 100;
}
function acc(s, l, on, c) {
  const b = 1 << (l % NLANE);
  if (on && !(lanes(s, c) & b)) hit(s, l, 1, c);
  if (!(lanes(s, c) & b)) return;
  if (s.flags & FLAG.ACCENT) { s.acc |= s.hit; s.flags &= ~FLAG.ACCENT; }
  s.acc = on ? s.acc | b : s.acc & ~b;
}
/* a step that holds nothing is a REST, as the machine keeps it */
const tidy = (steps) => { for (const s of steps) if (s.time === TIME.NOTE && !s.n && !s.hit) clear(s); };

/* --- scale helpers --- */
const inScale = (c, n) => ((c.mask >> ((n - c.root + 120) % 12)) & 1) === 1;
function neigh(c, n, d) { let g = 12; do n += d; while (g-- && !inScale(c, n)); return clamp(n, 0, 127); }
const deg = (c, n, d) => { for (; d > 0; d--) n = neigh(c, n, 1); for (; d < 0; d++) n = neigh(c, n, -1); return n; };
const rootNear = (c, lo) => lo + ((c.root - (lo % 12) + 120) % 12);

/* --- drums --- */
const per = (k16, len) => (!k16 ? 0 : k16 * len < 16 ? 1 : Math.floor((k16 * len + 8) / 16));
function euclidLane(steps, len, l, k, rot, mir, c) {
  for (let i = 0; k && i < len; i++) if ((i * k) % len < k) hit(steps[(((mir ? len - i : i) + rot) % len)], l, 1, c);
}
function laneClear(steps, len, l, c) { for (let i = 0; i < len; i++) hit(steps[i], l, 0, c); }
function laneRandom(steps, len, l, any, c) {
  laneClear(steps, len, l, c);
  if (l === DV.KICK) euclidLane(steps, len, l, per(3 + rnd(3), len), 0, rnd(2), c);
  else if (l === DV.SNARE) euclidLane(steps, len, l, per(2, len), 4 % len, 0, c);
  else if (l === DV.HATC) euclidLane(steps, len, l, per(8 + rnd(5), len), rnd(2), 0, c);
  else if (!any || !rnd(l === DV.HATO ? 2 : 3)) euclidLane(steps, len, l, per(1 + rnd(2), len), l === DV.HATO ? (2 + 4 * rnd(4)) % len : rnd(len), 0, c);
  if (l === DV.SNARE && !rnd(3)) hit(steps[rnd(len)], l, 1, c);
}
function hitNth(steps, len, n, c) {
  let cnt = 0;
  for (let i = 0; i < len; i++) for (let l = 0; l < NLANE; l++) if (lane(steps[i], l, c) && (i || l !== DV.KICK) && cnt++ === n) return { i, l, count: 1 };
  return { count: cnt };
}
const laneHits = (steps, len, l, c) => { let n = 0; for (let i = 0; i < len; i++) n += lane(steps[i], l, c); return n; };
function cookHit(steps, len, c) {
  const r = rnd(4), all = hitNth(steps, len, 4294967295, c), n = all.count;
  let i = 0, l = 0, j;
  if (r === 2 || !n) {
    let used = 0;
    for (j = 0; j < len; j++) used |= lanes(steps[j], c);
    for (l = DV.HATC, j = rnd(NLANE); used && j < 2 * NLANE; j++) if ((used >> (j % NLANE)) & 1) { l = j % NLANE; break; }
    j = rnd(len);
    if (lane(steps[j], l, c)) return 0;
    hit(steps[j], l, 1, c);
    return 1;
  }
  const at = hitNth(steps, len, rnd(n), c); i = at.i; l = at.l;
  if (r === 3) { if (laneHits(steps, len, l, c) < 2) return 0; hit(steps[i], l, 0, c); return 1; }
  j = (i + (rnd(2) ? 1 : len - 1)) % len;
  if (lane(steps[j], l, c)) return 0;
  const a = (accents(steps[i]) >> l) & 1;
  hit(steps[i], l, 0, c); hit(steps[j], l, 1, c);
  if (a) acc(steps[j], l, 1, c);
  return 1;
}
const sig = (steps) => JSON.stringify(steps.map((s) => [s.n, s.notes, s.time, s.flags, s.hit, s.acc, s.chance]));
function cookDrum(steps, len, hits, c) {
  let m = Math.floor((hits * (10 + rnd(11))) / 100);
  const s0 = sig(steps);
  m = m || 1;
  for (let n = 4 * m + 64; n; n--) {
    if (cookHit(steps, len, c) && m) m--;
    if (!m && sig(steps) !== s0) break;
  }
}
function fill(steps, len, l, c) {
  const E = [1, 2, 4];
  let now = 0;
  for (let e = 0; e < 3 && !now; e++) {
    let i = 0;
    for (; i < len && lane(steps[i], l, c) === (i % E[e] === 0 ? 1 : 0); i++);
    if (i === len) now = e + 1;
  }
  const e = now === 3 ? 0 : E[now % 3];
  for (let i = 0; i < len; i++) hit(steps[i], l, e && i % e === 0, c);
  return e;
}

/* --- melodic --- */
function randomNotes(steps, len, c) {
  const deg0 = [];
  let mid = 0, g = 0;
  for (let i = 0; i < len; i++) if (gate(steps[i])) { mid += steps[i].notes[0]; g++; }
  if (g) mid = Math.trunc(mid / g);
  else {
    mid = 60 + (c.root % 12); mid -= mid > 66 ? 12 : 0;
    for (let i = 0; i < len; i++) {
      clear(steps[i]);
      if (i % 2 === 0 && (!i || rnd(4))) { steps[i].time = TIME.NOTE; steps[i].n = 1; steps[i].vel = 96; }
    }
  }
  const lo = clamp(mid - 9, 12, 100);
  for (let x = lo; x <= lo + 18 && deg0.length < 20; x++) if (inScale(c, x)) deg0.push(x);
  const nd = deg0.length;
  if (!nd) return;
  let at = Math.floor(nd / 2) + rnd(5);
  at = at >= 2 ? at - 2 : 0;
  for (let i = 0; i < len; i++) {
    const s = steps[i];
    if (!gate(s)) continue;
    at = at >= nd ? nd - 1 : at;
    const d = deg0[at] - s.notes[0];
    s.notes[0] = deg0[at];
    for (let k = 1; k < s.n && k < 4; k++) {
      let x = clamp(s.notes[k] + d, 1, 127);
      while (!inScale(c, x) && x > 1) x--;
      s.notes[k] = x;
    }
    if (!rnd(6)) at = rnd(nd);
    else { const x = at + rnd(5) - 2; at = x < 0 ? -x : x >= nd ? 2 * (nd - 1) - x : x; }
  }
}
function cookNotes(steps, len, g, c) {
  let m = Math.floor((g * (15 + rnd(11))) / 100), tries = 64;
  const s0 = sig(steps);
  m = m || 1;
  for (; tries-- && (m || sig(steps) === s0); m -= m !== 0 ? 1 : 0) {
    let n = rnd(g), i = 0;
    for (; i < len && (!gate(steps[i]) || n--); i++);
    const s = steps[i % steps.length], r = rnd(8);
    if (r === 6) s.flags ^= FLAG.ACCENT;
    else if (r === 7) { if (!s.cond) s.chance = s.chance < 100 ? 100 : rnd(2) ? 75 : 50; }
    else {
      const d = rnd(2) ? 1 : -1;
      let o = r === 5 ? d * 12 : 0;
      for (let k = 0; k < s.n && k < 4; k++) if (s.notes[k] + o < 24 || s.notes[k] + o > 108) o = 0;
      for (let k = 0; k < s.n && k < 4; k++) s.notes[k] = o ? s.notes[k] + o : neigh(c, s.notes[k], d);
    }
  }
}

/* --- the machine's tools --- */
export const Tools = {
  clear(steps, len) { for (let i = 0; i < len; i++) clear(steps[i]); return "Sequence cleared"; },
  random(steps, len, c) {
    if (c.drum) { for (let i = 0; i < len; i++) clear(steps[i]); for (let l = 0; l < NLANE; l++) laneRandom(steps, len, l, 1, c); tidy(steps); return "Random beat"; }
    randomNotes(steps, len, c); tidy(steps); return "Random notes";
  },
  cook(steps, len, c) {
    let n = 0;
    for (let i = 0; i < len; i++) n += c.drum ? popcount(lanes(steps[i], c)) : gate(steps[i]) ? 1 : 0;
    if (!n) return null;
    if (c.drum) cookDrum(steps, len, n, c); else cookNotes(steps, len, n, c);
    tidy(steps); return "Cooked";
  },
  beat(steps, len, c) {
    for (let i = 0; i < len; i++) { clear(steps[i]); if (i % 4 === 0) hit(steps[i], DV.KICK, 1, c); if (i % 8 === 4) hit(steps[i], DV.SNARE, 1, c); if (i % 2 === 0) hit(steps[i], DV.HATC, 1, c); }
    return "Basic beat";
  },
  laneClear(steps, len, c) { laneClear(steps, len, c.lane, c); tidy(steps); return "Lane cleared"; },
  laneReverse(steps, len, c) {
    const old = steps.slice(0, len).map((s) => ({ ...s, notes: [...s.notes] }));
    for (let i = 0; i < len; i++) { const s = old[len - 1 - i]; hit(steps[i], c.lane, lane(s, c.lane, c), c); if (lane(s, c.lane, c)) acc(steps[i], c.lane, (accents(s) >> c.lane) & 1, c); }
    tidy(steps); return "Lane reversed";
  },
  laneFill(steps, len, c) { const n = fill(steps, len, c.lane, c); tidy(steps); return n === 1 ? "Lane on every step" : n === 2 ? "Lane on every 2nd" : n ? "Lane on every 4th" : "Lane cleared"; },
  laneRandom(steps, len, c) { laneRandom(steps, len, c.lane, 0, c); tidy(steps); return "Lane random"; },

  /* EUCLID: `hits` spread over a cycle of `cycle` steps, turned by `rot`, repeated through 1..LEN. The steps come in as they were. */
  euclid(steps, len, c, hits, cycle, rot) {
    const n = cycle || 1, on = (i) => { const p = (i + n - (rot % n)) % n; return (p * hits) % n < hits; };
    const from = steps.slice(0, len).map((s) => ({ ...s, notes: [...s.notes], tail: s.tail }));
    const src = (i) => { let j = i; while (j && from[j].time === TIME.TIE) j--; return from[j].time === TIME.NOTE && from[j].n && (j === i || from[i].time === TIME.TIE) ? from[j] : null; };
    for (let i = 0; i < len; i++) {
      const s = steps[i];
      if (c.drum) { hit(s, c.lane, on(i), c); continue; }
      const o = src(i);
      if (on(i)) {
        if (o !== from[i]) {
          const r = 60 + (c.root % 12);
          clear(s); s.time = TIME.NOTE;
          if (o) { s.notes = [...o.notes]; s.n = o.n; } else { s.notes = [r > 66 ? r - 12 : r, 0, 0, 0]; s.n = 1; }
          s.vel = s.vel || 100;
        }
      } else if (!(s.time === TIME.TIE && i && (steps[i - 1].time === TIME.TIE || (steps[i - 1].time === TIME.NOTE && steps[i - 1].n)))) clear(s);
    }
    tidy(steps);
    return `Euclid ${hits}/${n}${rot ? " +" + rot : ""}`;
  },

  /* DICE: a new part in the MOOD, LEN 16 (MARCH 14), by the track's kind and number. Returns { msg, len }. */
  dice(steps, c, mood) {
    const m = mood % 8, len = m === 2 ? 14 : 16;
    if (c.drum) drums(steps, len, m, c); else if (c.index === 0) bass(steps, len, m, c); else if (c.index === 1) keys(steps, len, m, c); else line(steps, len, m, c);
    tidy(steps);
    return { msg: "Dice: " + MOOD_WORDS[m], len };
  },
};
const popcount = (x) => { let n = 0; for (; x; x &= x - 1) n++; return n; };

/* --- DICE (krst_dice.c) --- */
function note(s, n, f = 0) { clear(s); s.time = TIME.NOTE; s.n = 1; s.notes = [clamp(n, 12, 115), 0, 0, 0]; s.vel = f & FLAG.ACCENT ? 120 : 92; s.flags = f & 3; }
function chord(s, c, n, kind, f = 0) {
  note(s, n, f);
  if (kind === 1) { s.notes[1] = clamp(n + 7, 12, 115); s.n = 2; }
  else if (kind >= 2) { s.notes[1] = deg(c, n, 2); s.notes[2] = deg(c, n, 4); s.n = 3; if (kind === 3) { s.notes[3] = deg(c, n, 6); s.n = 4; } }
}
const tie = (s) => { clear(s); s.time = TIME.TIE; };
const hold = (steps, a, b) => { for (let i = a + 1; i < b; i++) tie(steps[i]); };
const A = FLAG.ACCENT, SL = FLAG.SLIDE;

function drums(steps, len, m, c) {
  const KICK = [["x...x...x...x...", "x...x...x...x..x", "x...x...x..xx..."], ["x......x..x.....", "x.........x.....", "x..x......x..x.."], ["x.x...x.x.x...", "x.x...x.xx.x..", "x.x..xx.x.x..."], ["x..x.....x..x...", "x....x.x..x....x", "xx.....x..x..x.."],
    ["x.......x.......", "x......x..x.....", "x.......x.....x."], ["x...............", "................", "x.......x......."], ["x...x...x...x...", "x..xx...x..xx...", "x.x.x...x.x.x..x"], ["x.......x.......", "x.......x...x...", "x.........x....."]];
  const SNARE = [["....x.......x...", "....x.......x...", "....x.......x..x"], ["........x.......", "........x.......", "........x.....x."], ["....x.....x...", "....x.....x..x", "....x...x.x..."], ["...x.....x....x.", ".....x..x...x...", "....x..x...x.x.."],
    ["....x.......x...", "........x.......", "....x.......x.x."], ["................", "................", "................"], ["....x.......x...", "....x..x....x...", "....x.......xxxx"], ["................", "............x...", "................"]];
  const TOMS = ["..........x.x.x.", "...x......x.....", "............xxx."];
  const ln = Array(NLANE).fill(0), all = len >= 32 ? 0xFFFFFFFF : (1 << len) - 1;
  ln[DV.KICK] = bits(KICK[m][rnd(3)]); ln[DV.SNARE] = bits(SNARE[m][rnd(3)]);
  switch (m) {
    case 0: ln[DV.HATC] = bits("..x...x...x...x."); if (ch(50)) ln[DV.CLAP] = ln[DV.SNARE]; break;
    case 1: ln[DV.HATC] = (bits("x.x.x.x.x.x.x.x.") & (rng() | bits("x...x...x...x..."))) >>> 0; if (ch(50)) ln[DV.HATO] = bits("......x.......x."); break;
    case 2: ln[DV.HATC] = all; if (ch(50)) ln[DV.TOM] = bits("...........xxx"); break;
    case 3: ln[DV.HATC] = (rng() & rng() & all) >>> 0; ln[DV.RIM] = (rng() & rng() & rng() & all) >>> 0; ln[DV.CLAP] = (1 << rnd(16)) >>> 0; break;
    case 4: ln[DV.HATC] = bits("..x...x...x...x."); ln[DV.TOM] = bits(pick(TOMS)); break;
    case 5: ln[DV.BELL] = (1 << (4 + rnd(3) * 4)) >>> 0; break;
    case 6: ln[DV.HATC] = all; ln[DV.HATO] = bits("..x...x...x...x."); ln[DV.CLAP] = ln[DV.SNARE]; ln[DV.RIM] = bits("x..............."); break;
    default: ln[DV.HATC] = bits(ch(50) ? "....x.......x..." : "..x.......x....."); break;
  }
  if (m !== 5 && m !== 7) for (let i = 0; i < len; i++) if (!(((ln[DV.KICK] | ln[DV.SNARE]) >>> i) & 1) && ch(m === 3 || m === 2 ? 18 : 10)) ln[DV.BELL] |= 1 << i;
  const accm = ((ln[DV.KICK] | ln[DV.SNARE]) & (bits("x...x...x...x...") | rng())) >>> 0;
  for (let i = 0; i < len; i++) {
    clear(steps[i]);
    for (let l = 0; l < NLANE; l++) if (((ln[l] & all) >>> i) & 1) { hit(steps[i], l, 1, c); if ((l === DV.KICK || l === DV.SNARE) && ((accm >>> i) & 1)) acc(steps[i], l, 1, c); }
  }
}
function bass(steps, len, m, c) {
  const r = rootNear(c, 36);
  for (let i = 0; i < len; i++) clear(steps[i]);
  switch (m) {
    case 0: { const a = bits(pick(["...x...x..x....x", ".x.....x.x.....x", "...x..x....x..x."])), other = ch(50) ? r + 1 : r + 7;
      for (let i = 0; i < len; i++) note(steps[i], (a >>> i) & 1 ? (ch(60) ? r + 12 : other) : r, i % 4 === 0 ? A : 0); break; }
    case 1: { const w = bits(pick(["x..x..x...x.x...", "x.....x.x..x....", "x..x....x.x..x.."]));
      for (let i = 0; i < len; i++) if ((w >>> i) & 1) note(steps[i], r + (i >= 8 && ch(50) ? 1 : 0) + (ch(15) ? 12 : 0), (ch(30) ? SL : 0) | (i === 0 ? A : 0)); break; }
    case 2: for (let i = 0; i < len; i++) if (i % 2 === 0 || ch(35)) note(steps[i], r + (ch(20) ? 12 : 0) + (i >= 10 && ch(40) ? 1 : 0), A); break;
    case 3: for (let i = 0; i < len; i++) if (ch(45)) note(steps[i], deg(c, r, rnd(3) * 2) + (ch(20) ? 12 : 0), ch(40) ? A : 0); break;
    case 4: for (let i = 0; i < len; i++) if (i % 2 === 0 || ch(30)) note(steps[i], r + 12 - Math.floor(i / 4), (i % 4 === 0 ? A : 0) | (i % 4 === 3 ? SL : 0)); break;
    case 5: note(steps[0], r, 0); hold(steps, 0, len); break;
    case 6: for (let i = 0; i < len; i++) if (i % 4 !== 0 || ch(30)) note(steps[i], r + (ch(20) ? 7 : 0) + (ch(20) ? 12 : 0), i % 2 ? A : 0); break;
    default: for (let i = 0; i < len; i += 2) note(steps[i], i >= 8 ? deg(c, r, 5) - 12 : r, 0);
  }
}
function keys(steps, len, m, c) {
  const r = rootNear(c, 55);
  for (let i = 0; i < len; i++) clear(steps[i]);
  switch (m) {
    case 0: case 6: { const w = bits(pick(["......x.......x.", "...x......x.....", "..x.....x.....x."]));
      for (let i = 0; i < len; i++) if ((w >>> i) & 1) chord(steps[i], c, r + (ch(30) ? 1 : 0), m === 6 ? 1 : 2, ch(50) ? A : 0); break; }
    case 1: case 7: { const second = m === 7 ? deg(c, r, 5) - 12 : r + 1, h = Math.floor(len / 2);
      chord(steps[0], c, r - (m === 1 ? 12 : 0), 2, 0); hold(steps, 0, h); chord(steps[h], c, second - (m === 1 ? 12 : 0), 2, 0); hold(steps, h, len); break; }
    case 2: for (let i = 0; i < len; i++) if (ch(40)) chord(steps[i], c, r + 12 + (ch(40) ? 1 : 0), 1, ch(40) ? A : 0); break;
    case 3: for (let i = 0; i < len; i++) if (ch(30)) note(steps[i], deg(c, r, rnd(7)) + (ch(30) ? 12 : 0), ch(30) ? A : 0); break;
    case 4: for (let i = 0; i < len; i += 2) note(steps[i], r + 12 - Math.floor(i / 2), ch(30) ? A : 0); break;
    default: { const ARP = [0, 2, 4, 7];
      for (let i = 0; i < len; i++) if (i % 2 === 0 ? ch(80) : ch(15)) note(steps[i], deg(c, r, ARP[(Math.floor(i / 2) + (i >= 8 ? 1 : 0)) % 4]) - (i >= 8 ? 2 : 0), i % 4 === 0 ? A : 0); }
  }
}
function line(steps, len, m, c) {
  const r = rootNear(c, 67);
  for (let i = 0; i < len; i++) clear(steps[i]);
  switch (m) {
    case 5: case 7: note(steps[0], r, 0); hold(steps, 0, len); break;
    case 3: for (let i = 0; i < len; i++) if (ch(50)) note(steps[i], r + rnd(24) - 12, ch(30) ? A : 0); break;
    case 2: case 6: for (let i = 0; i + 4 < len; i += 4) note(steps[i], r, A); for (let i = len - 4; i < len - 1; i++) note(steps[i], r + (i - (len - 4)) * 5, SL); break;
    default: { const w = bits(pick(["..x...x...x...x.", "......x.......x.", "...x.......x...."]));
      for (let i = 0; i < len; i++) if ((w >>> i) & 1) note(steps[i], r, 0);
      if (ch(35) && len >= 16) { note(steps[12], r, 0); hold(steps, 12, 16); } }
  }
}

/* HAPPY ACCIDENT (EDIT held + G5): 2 or 3 of the sound's eight engine values (not its choices) moved 15..45 % of their range up or down,
   half the time one FX send up too. `eng` = [{ id, min, max, value, label, choice }] for the engine's values, `sends` = [{ id, min, max, value, label }]
   for DIST CHO DLY REV. Returns { msg, changes: [{ id, from, to }] }. */
export function accident(eng, sends) {
  const want = 2 + rnd(2), changes = [], used = new Set(), names = [];
  for (let k = 0; changes.length < want && k < 32; k++) {
    const i = rnd(8), d = eng[i];
    if (used.has(i) || !d || d.choice || d.max - d.min < 8) continue;
    const span = d.max - d.min;
    let dv = Math.max(1, Math.floor((span * (15 + rnd(31))) / 100));
    if (rnd(2)) dv = -dv;
    let v = d.value + dv;
    if (v > d.max || v < d.min) v = d.value - dv;
    v = clamp(v, d.min, d.max);
    if (v === d.value) continue;
    used.add(i); changes.push({ id: d.id, from: d.value, to: v }); names.push(d.label);
  }
  if (rnd(2)) {
    const s = sends[rnd(4)];
    if (s) { const v = clamp(s.value + 15 + rnd(30), s.min, s.max); changes.push({ id: s.id, from: s.value, to: v }); names.push(s.label); }
  }
  return { msg: names.length ? "Oops: " + names.join(", ") : "Nothing to move", changes };
}

/* REVERSE and SHIFT as an order: step j becomes the old step src[j] (ui_tools.c tl_reverse, tl_shift). A note's ties come after it, so a mirrored run
   of ties keeps its note first. */
export function reverseSrc(steps, len) {
  const src = Array.from({ length: len }, (_, j) => len - 1 - j);
  for (let j = 0; j < len; j++) {
    let e = j;
    while (e < len && steps[src[e]].time === TIME.TIE) e++;
    if (e === j) continue;
    if (e < len && steps[src[e]].time === TIME.NOTE) { const h = src[e]; for (let x = e; x > j; x--) src[x] = src[x - 1]; src[j] = h; }
    j = e;
  }
  return src;
}
export const shiftSrc = (len, d) => Array.from({ length: len }, (_, j) => (j + len - d) % len);
