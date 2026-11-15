# Hardware test: KRIECHSTROM tablet-companion firmware

This build adds six editor commands (82 to 87) and one global (HISS) to KRIECHSTROM so the tablet can reach everything the machine
can do. Nothing here has run on a real FM-1 yet. Everything below was checked on the host only (see "What was verified").

Flashing is at your own risk (upstream says the same). Nothing in this project flashes anything for you.

## 0. Before flashing

1. Open `editor.html` or the tablet's Settings > Backup and take a full backup of the machine (projects, presets, samples,
   settings). Keep the file somewhere other than the tablet.
2. Note the current firmware (the machine's power-on screen, or `python3 tools/fm1_install.py --info`).
3. Have the way back ready: the official V15 or V16 `.fwsc` (the installer takes the machine back to the stock firmware), or the
   current KRIECHSTROM release `.fwsc`. If an install fails and the machine no longer starts, upstream says recovery needs
   FM-1-transporter (https://github.com/kurogedelic/FM-1-transporter).

## 1. The build

`dist/kriechstrom-tablet-dev.fwsc` (sha256 `c16e2695f9f6da3c2b4e46e8a36e789a65bb011af2b34a82d2b701952ce098fb`), built by `./build.sh` in a clean LF clone (a development build: it takes a new USB identity, so it does not replace the release's
identity). A release build is `./build.sh --release X.Y`; the version number is yours to choose.

Install with the upstream tool, from `vendor/kriechstrom`:

```
python3 tools/fm1_install.py ../../dist/kriechstrom-tablet-dev.fwsc
```

or with the local web installer described in `vendor/kriechstrom/BUILDING.md`. Rolling back: install the V15 / V16 file or the
previous release `.fwsc` the same way.

## 2. Checks, in this order

Mark each one. Anything that fails: stop, note what you did, and tell me before going on.

**Handshake**
- [ ] Tablet connects; Settings > About shows the engines and the global count 27 (the machine's list plus HISS).
- [ ] A machine with the old firmware still works with this tablet page (no Perform screen, no Slices tab, no HISS).

**Perform (cmd 82, 83)**
- [ ] Hold a pad: its effect runs and the pad's own key lights the same effect on the machine; let go: the effect stops.
- [ ] Hold a pad, then pull the USB cable: the effect stops by itself within a second (nothing stays stuck).
- [ ] Hold a pad and the machine's own key for another effect: both run.
- [ ] Latch keeps a pad on until it is tapped again; "Let go of everything" stops all.
- [ ] The four knobs (Filter, Crush, Throw, Depth) change the sound and return to off when released or after the cable is pulled.
- [ ] A pad dims when its effect cannot run at the current tempo.
- [ ] Assign keys: set a key to another effect, then check the machine's FX layer plays that effect on that key; "Put the default
      keys back" restores it. Power-cycle: the map is kept (a note says when it is only kept until power-off).
- [ ] FX KILL on the machine (menu or dialog) silences the tablet's effects too.

**Solo, Fill (cmd 82)**
- [ ] Solo n holds track n alone while pressed; releasing returns the others.
- [ ] Fill plays the steps with a FILL condition while held.

**Drum lanes (cmd 85)**
- [ ] With a DRUM track selected on Perform, each lane button mutes or unmutes that lane on the machine and the machine's quick
      actions agree with the tablet afterwards.

**Slices (cmd 84), a SLICE track with a user sample**
- [ ] Sound > Slices shows the slices of USR1..3; moving a start changes where the slice begins when played (DIV becomes MAN).
- [ ] Split, Join, "Last slice to the end", "Back to automatic slices".
- [ ] Power-cycle: manual slices are kept (flash write happens after the transport stops).
- [ ] Points closer than 64 samples are refused with a message and nothing changes.

**HISS**
- [ ] Sound > Space > Damage: HISS changes the noise floor; the value is the one the machine's GLO page shows.

**MIDI learn (cmd 87)**
- [ ] The Learn-mode switch in Settings > MIDI learn turns MIDI LEARN on and off on the machine (the same as GLO + D4).

**Tap tempo**
- [ ] TAP in the top bar sets the tablet's clock tempo.

**Clear all (cmd 86)** (do this last, on a backed-up machine)
- [ ] Settings > System > Clear all asks first, then the music is a new project; the stored projects, user sounds, samples,
      settings and MIDI learn are still there.

**USER drum kit (cmds 88-93)** (stop the sequencer before saving)
- [ ] DRUM track, EDIT 1: KIT USER shows EDIT > KIT 1..7 and KIT SLOT. KNOB 1 picks the lane, KNOB 2..4 change numbers; the sound follows.
- [ ] KIT SLOT: SAVE puts the working kit in K1..K7 (named "KIT n"), LOAD and ERASE work; a model kit LOADs all eight lanes.
- [ ] Power-cycle: the working kit and the saved kits are back. Preset slots 17..32 of older firmware are gone (user presets are 16).
- [ ] Tablet Sound > Kit: a number moved on the tablet is heard and shown on the machine; a knob turned on the machine moves the tablet's number.
- [ ] Tablet Kit > Kits: Save, Load, Erase and "Start from a model kit" do what the machine's KIT SLOT does.

## 3. What was verified (host only)

- Firmware: the editor tests on the host (plain and under AddressSanitizer), with the second core off, the fuzzer, and the full
  test suite. The host suite ran with no failure up to its ASan/UBSan block. The one thing it flagged was the target budget of `perf_begin` (28 to 36: the editor-held effects in the audio block); its entry in `tests/target_budget.txt` is raised to 36. In the ASan block editor_test and project_test pass; backup_test and the rest of the block loop on AddressSanitizer's DEADLYSIGNAL in Docker Desktop, so backup_test, robust_test, fun10_test, fm6bank_test, midi_drift_test, editor_test, project_test, fuzz_ed, fuzz_proj and fuzz_smp were rerun without ASan and all exit 0; the installer CLI test passes. Two runs crash only in Docker Desktop under AddressSanitizer
  with signals (the drum-grid stress with a song, and the Felucca-Engines run); the unmodified firmware does the same, so they were skipped
  in both.
- Tablet: protocol and mock tests (`node tablet/test.mjs`), and every screen in the browser at 1024 x 640 with no overflow or scrolling.

## 4. Not covered

- Anything involving the real audio ISR timing, the real flash writes, and the real USB cable.
- CALIBRATION: not in the tablet (see the report).
