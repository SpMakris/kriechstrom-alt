// Step model for the tablet sequencer. Wire layout per vendor/kriechstrom/web/EDITOR_PROTOCOL.md:
//   TRACK_STEP reply: track, index, n, note x4, time, flags, vel, [hit, acc, hi], [chance], [ratchet], [nudge+8], [condition]
//   STEP_GET reply:   index, n, note x4, time, flags, vel, then the same optional tail.
// Which optional bytes exist is read from the reply length, so older firmware keeps working.

export const TIME = { NOTE: 0, TIE: 1, REST: 2 };
export const FLAG = { ACCENT: 1, SLIDE: 2 };
export const CONDITIONS = ["", "1:2", "2:2", "1:3", "2:3", "3:3", "1:4", "2:4", "3:4", "4:4", "FILL", "!FILL"];

/* a: reply bytes; withTrack: TRACK_STEP carries the track first */
export function parseStep(a, withTrack = false) {
  let i = 0;
  const b = () => { if (i >= a.length) throw new Error("short step reply"); return a[i++]; };
  const o = {};
  if (withTrack) o.track = b();
  o.index = b();
  o.n = b();
  o.notes = [b(), b(), b(), b()];
  o.time = b();
  o.flags = b();
  o.vel = b();
  o.tail = { hits: false, chance: false, ratchet: false, nudge: false, cond: false };
  o.hit = 0; o.acc = 0; o.chance = 100; o.ratchet = 1; o.nudge = 0; o.cond = 0;
  if (i + 3 <= a.length) {
    const h = b(), c = b(), x = b();
    o.hit = h | (x & 1) << 7;
    o.acc = (c | (x & 2) << 6) & o.hit;
    o.tail.hits = true;
  }
  if (i < a.length) { o.chance = b(); o.tail.chance = true; }
  if (i < a.length) { o.ratchet = b(); o.tail.ratchet = true; }
  if (i < a.length) { o.nudge = b() - 8; o.tail.nudge = true; }
  if (i < a.length) { o.cond = b(); o.tail.cond = true; }
  if (o.chance > 100) throw new Error("Invalid step chance");
  if (o.ratchet < 1 || o.ratchet > 4) throw new Error("Invalid step ratchet");
  if (o.nudge < -8 || o.nudge > 7) throw new Error("Invalid step nudge");
  if (o.cond > 11) throw new Error("Invalid step condition");
  return o;
}

/* the argument bytes after the index (and track): always writes every byte the device sent, so nothing it
   holds is lost. A condition replaces the chance (the device stores one byte for both). */
export function encodeStep(s) {
  const n = Math.max(0, Math.min(4, s.n | 0));
  const out = [n, ...[0, 1, 2, 3].map((k) => (s.notes[k] | 0) & 0x7F), Math.max(0, Math.min(2, s.time | 0)), s.flags & 3, (s.vel | 0) & 0x7F];
  const t = s.tail;
  if (t.hits || t.chance || t.ratchet || t.nudge || t.cond) {
    const hit = s.hit | 0, acc = s.acc | 0;
    out.push(hit & 0x7F, acc & 0x7F, (hit >> 7 & 1) | (acc >> 7 & 1) << 1);
  }
  if (t.chance || t.ratchet || t.nudge || t.cond) out.push(s.cond ? 100 : Math.max(0, Math.min(100, s.chance | 0)));
  if (t.ratchet || t.nudge || t.cond) out.push(Math.max(1, Math.min(4, s.ratchet | 0)));
  if (t.nudge || t.cond) out.push(Math.max(-8, Math.min(7, s.nudge | 0)) + 8);
  if (t.cond) out.push(Math.max(0, Math.min(11, s.cond | 0)));
  return out;
}

export const emptyStep = (index, tail) => ({ index, n: 0, notes: [0, 0, 0, 0], time: 0, flags: 0, vel: 0, hit: 0, acc: 0,
  chance: 100, ratchet: 1, nudge: 0, cond: 0, tail: { ...tail } });

/* what a step plays on a synth track (notes) or a drum track (lanes) */
export function isOn(s, drum, laneOf) {
  if (s.time !== TIME.NOTE) return false;
  if (drum) return stepLaneMask(s, laneOf) !== 0;
  return s.n > 0 || s.hit !== 0;
}
export function stepLaneMask(s, laneOf) {
  if (s.time !== TIME.NOTE) return 0;
  let m = s.hit | 0;
  for (let k = 0; k < Math.min(4, s.n); k++) m |= 1 << laneOf(s.notes[k]);
  return m;
}

/* toggle one pitch in a step: up to 4 notes, kept sorted */
export function togglePitch(s, pitch) {
  const have = s.notes.slice(0, s.n);
  const i = have.indexOf(pitch);
  const next = i >= 0 ? have.filter((x) => x !== pitch) : have.length < 4 ? [...have, pitch].sort((a, b) => a - b) : have;
  const o = { ...s, notes: [0, 0, 0, 0], n: next.length };
  next.forEach((p, k) => { o.notes[k] = p; });
  if (next.length && o.time !== TIME.NOTE) o.time = TIME.NOTE;
  if (next.length && !o.vel) o.vel = 100;
  return o;
}

/* toggle one drum lane (hit bit) of a step */
export function toggleLane(s, lane, laneOf) {
  const bit = 1 << lane;
  const cur = stepLaneMask(s, laneOf);            /* notes on lanes become hits first, so what plays stays the same */
  const o = { ...s, notes: [0, 0, 0, 0], n: 0, time: TIME.NOTE };
  o.hit = cur & bit ? cur & ~bit : cur | bit;
  o.acc = s.acc & o.hit;
  if (!o.vel) o.vel = 100;
  return o;
}
