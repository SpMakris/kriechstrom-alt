---
version: 1
slug: "tablet-index-html"
primary_target: "tablet/index.html"
related_targets: []
---

# Surface brief: FM-1 tablet sequencer (tablet/index.html)

Mode: Operate. Platform: web, landscape 8-9 inch tablet, touch first. Audience, job and constraints: see PRODUCT.md.

## Scope
The sequencer only. Four tracks always on screen as rows of 16-step pages, one track "in hand" that grows (drum lanes or a one-octave pitch roll) with a step drawer on demand (basic tier: note, loudness, accent, slide, tie, repeats, chance or condition; more tier: nudge, locks). Pattern menu: LEN, DIV, SWING, GATE, QNTZ and editor tools. The tablet is the MIDI clock master and derives the playhead from its own pulses.

## Open decisions (not for the builder to invent)
Machine PLAY button behaviour with clock source USB; real-time bytes between SysEx frames; WebMIDI clock timing on the tablet; playhead accuracy with swing, nudge, odd lengths and song chains; tablet OS; wake lock and scale snap are proposals.

## Direction contract
THESIS: A jam board, not a form: all four tracks stay reachable under the thumb and exactly one is opened up at a time. It refuses the spreadsheet of text boxes and the control-room dashboard.
OWN-WORLD: black ground, white type, one red (#ff2018) carrying every active step; white marks the track in hand and the playhead. Inter Tight, tabular numerals. Square-cornered cells, 1px hairlines, no gradients, no glow, no decorative icons.
STORY: Sit down, see the whole machine, tap steps on any track while it plays, open one track for pitch, lanes and per-step detail, close it again. Nothing is hidden, only folded.
FIRST VIEWPORT: Top bar with transport, tempo, clock toggle and connection. Below it four stacked track rows (name, mute, level, 16 big cells each); the track in hand grows to fill the height with its roll or lanes, the other three stay thin and live. Drawer slides in from the right.
FORM: Four-track board with a track in hand (proposal confirmed by the owner after several re-rolls). Seed key 93d38f9e.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
