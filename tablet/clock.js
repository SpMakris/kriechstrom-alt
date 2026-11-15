// The tablet as MIDI clock master. Sends 24 pulses per quarter note plus Start and Stop to the FM-1's output port,
// scheduled ahead with WebMIDI timestamps so JavaScript timer jitter does not reach the pulse spacing.
// The playhead is derived from the same pulse count (an estimate: the device also applies swing and nudge).

export const PPQN = 24;
/* pulses per step for each DIV enum value of the firmware (midi_clock.c midi_clock_period):
   1/4 1/8 1/16 1/32 8T 16T 1/2 1/1 2BAR 4BAR */
export const DIV_PULSES = [24, 12, 6, 3, 8, 4, 48, 96, 192, 384];

export class MidiClock {
  /* send(bytes, timestampMs): the WebMIDI output; now(): ms on the same clock as the timestamps */
  constructor(send, now = () => performance.now(), opt = {}) {
    this.send = send;
    this.now = now;
    this.lookahead = opt.lookahead ?? 120;   /* ms of pulses scheduled ahead */
    this.every = opt.every ?? 25;            /* ms between scheduler runs */
    this.bpm = 120;
    this.running = false;
    this.pulses = [];                        /* scheduled [time, count] not yet passed (for the playhead) */
    this.count = 0;                          /* pulses scheduled since Start */
    this.next = 0;                           /* time of the next pulse to schedule */
    this.timer = null;
    this.gaps = [];                          /* spacing between consecutive scheduled pulses, ms (for the quality check) */
    this.last = 0;
    this.lastRun = 0;
    this.worst = 0;                          /* longest gap between scheduler runs, ms */
  }
  get pulseMs() { return 60000 / (this.bpm * PPQN); }
  setBpm(b) { this.bpm = Math.max(40, Math.min(240, Math.round(b))); }
  start() {
    if (this.running) return;
    this.running = true;
    this.count = 0;
    this.pulses = [];
    this.gaps = [];
    this.last = 0;
    this.lastRun = 0;
    this.worst = 0;
    this.next = this.now() + 60;             /* a short lead so Start and the first pulse arrive in order */
    this.send([0xFA], this.next);
    this.timer = setInterval(() => this.run(), this.every);
    this.run();
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    /* Stop goes out at once (no timestamp), then again after the already scheduled pulses have been delivered,
       so a pulse queued behind a future-dated Stop cannot be the last message the machine sees. */
    this.send([0xFC]);
    this.send([0xFC], this.next + 20);
    this.pulses = [];
  }
  /* false when the browser has been slow to run the scheduler (a background tab): pulses may run dry */
  health() { return this.worst < this.lookahead * 0.8; }
  run() {
    const nowMs = this.now();
    if (this.lastRun) this.worst = Math.max(this.worst * 0.98, nowMs - this.lastRun);
    this.lastRun = nowMs;
    const horizon = this.now() + this.lookahead;
    while (this.next < horizon) {
      this.send([0xF8], this.next);
      this.pulses.push([this.next, this.count]);
      if (this.last) { this.gaps.push(this.next - this.last); if (this.gaps.length > 96) this.gaps.shift(); }
      this.last = this.next;
      this.count++;
      this.next += this.pulseMs;
    }
    const t = this.now();
    while (this.pulses.length > 2 && this.pulses[1][0] <= t) this.pulses.shift();
  }
  /* pulses that have been due so far (the clock position the device has reached, to within the output latency) */
  position() {
    if (!this.running) return -1;
    const t = this.now();
    let p = -1;
    for (const [time, c] of this.pulses) if (time <= t) p = c; else break;
    return p;
  }
  /* the step a track is on: divPulses per step, len steps; -1 when stopped or not yet started */
  stepOf(divIndex, len) {
    const p = this.position();
    if (p < 0) return -1;
    const per = DIV_PULSES[divIndex] ?? 6;
    return Math.floor(p / per) % Math.max(1, len);
  }
}
