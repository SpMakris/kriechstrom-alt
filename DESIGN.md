---
name: KRIECHSTROM FM-1 Jam Board
description: Black ground, white type, one red that marks every active step; a four-track board with one track in hand.
colors:
  ground: "#000000"
  ink: "#f2f2f2"
  mute: "#c4c4cc"
  red: "#ff2018"
  on-red: "#000000"
  hairline: "#707070"
  cell: "#191919"
  cell-off: "#0d0d0d"
  raise: "#222222"
  white: "#ffffff"
typography:
  body:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.25
    fontFeature: "tabular-nums"
  gate-title:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  tempo:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1
  drawer-title:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
  stepper-value:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
  label:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.06em"
  cell:
    fontFamily: "Inter Tight, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
rounded:
  none: "0px"
spacing:
  hair: "3px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  hit: "44px"
components:
  button:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  button-red:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-red}"
  play:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-red}"
    width: "64px"
    height: "48px"
  play-running:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  step-cell-off:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.mute}"
    rounded: "{rounded.none}"
  step-cell-on:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-red}"
    rounded: "{rounded.none}"
  step-cell-rest:
    backgroundColor: "{colors.cell-off}"
  track-head:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  chip-selected:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-red}"
    height: "44px"
---

# Design System: KRIECHSTROM FM-1 Jam Board

Scope: the sequencer jam board (`tablet/index.html`, `style.css`, `app.js`). The other screens (Mix, Sound with the FM6 editor inside it, Song, Library, Settings) reuse its tokens and the no-scroll rule but are not documented here.

## Overview

**Creative North Star: "The Jam Board"**

Black ground, white type, one red. Four tracks stay on screen as rows of 16 step cells; exactly one track is "in hand" and grows to fill the height with its roll or lanes, while the other three stay thin and live. A drawer slides in from the right for per-step detail. Nothing is hidden, only folded.

The build is flat and hard-edged: square corners, 1px hairlines, no shadows, no blur. Red means active; white means selection, the track in hand, and the playhead. Touch is the primary input, so every control is at least 44px.

**Key Characteristics:**
- Red marks every active step, mute-on, play, and the connection-level warning; it is never decoration.
- White (and the pale ink fill) marks "where you are": track in hand, playhead, selected step, pressed toggle.
- Square cells separated by 3px gaps, with a 6px extra gap at each beat.
- Tabular numerals throughout.
- Depth is a change of fill and border colour, never a shadow.

## Colors

A two-value neutral ladder on black, one red, white for position.

### Primary
- **Signal Red** (`red`, #ff2018): active step fill, tie hatch, play button, mute-on, selected chip, "on" switch track, brand word, note tags, range thumb on `.red` sliders, error status fill. Text on red is always black (`on-red`).

### Neutral
- **Black Ground** (`ground`, #000000): page background.
- **Ink** (`ink`, #f2f2f2): body text, pressed-button fill, selected tab and segment fill, default range thumb.
- **Mute** (`mute`, #c4c4cc): secondary labels, step numbers, status text, off-state switch knob.
- **Hairline** (`hairline`, #707070): every border and divider, and the range track. Commented in source as 3.9:1 on black, the edge of every touch target.
- **Cell** (`cell`, #191919): button, step-cell and track-head fill at rest.
- **Cell Off** (`cell-off`, #0d0d0d): rest steps, non-scale keys in the roll.
- **Raise** (`raise`, #222222): `:active` button fill.
- **White** (`white`, #ffffff): playhead bar, accent bar, lock dot, selection outline, focus ring, track-in-hand border. Written as a literal in the CSS, not a custom property.

### Named Rules
**The One Red Rule.** Red appears only where something is active, armed, or needs attention. A new surface does not get a second accent.

**The White Is Position Rule.** White marks the track in hand, the playhead, the selected step and the focus ring. It never marks "on"; that is red.

## Typography

**Display, Body and Label Font:** Inter Tight (variable, weights 100-900, loaded from the vendored `InterTight[wght].ttf`), with `system-ui, sans-serif` fallback.

**Character:** One family, weight carries hierarchy: 500 for running text, 700 for controls, 800 for names, values and titles. Numerals are tabular so tempo and step values do not jitter.

### Hierarchy
- **Gate title** (800, 44px, 1, -0.02em): connect screen heading only.
- **Stepper value** (800, 26px): drawer steppers.
- **Tempo** (800, 24px, 1): BPM readout with an 11px / 600 / 0.08em caption under it.
- **Drawer title** (800, 22px): step heading in the drawer.
- **Track name** (800, 15px; 17px when in hand): sound name, with a 12px engine line in mute.
- **Body** (500, 15px, 1.25): default.
- **Label** (700, 13px, 0.06em, uppercase): drawer field labels; the tools group label is 12px / 0.08em uppercase.
- **Cell text** (700, 12px): step numbers every 4th step, and step marks (ratchet, chance or condition, slide) at 14px / 800.

### Named Rules
**The Weight Not Size Rule.** Distinguish roles with weight 500/700/800 first; sizes stay in a narrow 11-26px band for controls.

## Layout

The page is a two-row grid at 100dvh with no page scroll: top bar (min 64px, 56px under 640px height) over the board. The board is `1fr` plus a drawer column that animates from 0 to 340px (310px under 1100px width).

Each track is a grid of a head column (232px; 214px with drawer open; 208px under 1100px width) and the step area. Resting track rows take `clamp(46px, 8vh, 72px)`; the track in hand takes the remaining height. Gaps: 6px between rows, 8px between head and cells, 3px between cells, plus 6px at every beat. Row padding 8px 10px 10px. Pages are 16 steps.

The roll for the track in hand is a 54px label column plus 16 columns, with a 40px header row of step numbers. The minimum touch target is 44px (`--hit`).

Spacing rhythm in use: 3, 6, 8, 10, 14px, with 44px as the target size.

## Elevation & Depth

Flat. There are no box-shadows or blurs in the build apart from one inset 7px white bar under the playhead header in the roll. Hierarchy comes from fill (cell, raise, ink, red) and from a 1px hairline versus a white border on the track in hand. The drawer is separated from the board by a hairline, not a shadow.

### Named Rules
**The Flat Rule.** Depth is fill and border only. State changes swap fill colour; nothing lifts.

## Shapes

All corners are square (0px radius), including range thumbs, switch tracks and knobs. Every control is outlined with a 1px hairline. The selected step gets a 3px white outline with 1px offset; the focus ring is 2px white with 2px offset. The playhead is a 6px white bar across the top of a cell. Accent is a 5px white bar along the bottom of a cell. A parameter lock is a 7px white square at top left.

## Components

### Buttons
- **Shape:** square, 1px hairline border, 44px minimum height and width, 0 16px padding, weight 700.
- **Default:** Cell fill, ink text. `:active` goes to Raise.
- **Pressed / on:** Ink fill, black text, ink border.
- **Red:** red fill, black text, red border.
- **Disabled:** 40% opacity, no pointer events.
- **Play:** 64 x 48px, red fill; while running it switches to the ink fill.

### Step cell
- **Off:** Cell fill, hairline border, mute text (step number on every 4th cell).
- **On:** red fill and border, black text. Marks sit top right (ratchet "x2", chance "50%" or condition, slide "~"); accent is a white bar at the bottom; lock is a white square top left.
- **Tie:** red and black vertical hatch (6px red, 3px black).
- **Rest:** Cell Off fill.
- **Playhead:** 6px white bar across the top. In the roll the playhead is shown by a header bar and a #232323 column tint instead.
- **Selected:** 3px white outline.

### Track row
- **Head:** Cell fill, hairline border; track-in-hand gets a white border and a taller head with a tools area. Contains a red square number badge (28px), sound name, engine name, a mute toggle (44px, red when on), and a level slider (76px, 64px under 1100px, 40px when the drawer is open).
- **Muted:** name drops to 50% opacity.

### Roll (track in hand)
- **Pitch roll or drum lanes:** cells in a 16-column grid; non-scale keys use Cell Off; labels right-aligned in mute, root in ink; header cells outlined, selected header is ink-filled.

### Top bar
- Brand word in red 800 uppercase 0.08em, play button, BPM stepper (44px buttons around a 24px readout), a clock switch (52 x 30px track, red when on, black knob), a status line right-aligned in mute (error state is a red block with black text), and 1px hairline separators.

### Drawer
- 340px right column with tabs (52px, selected tab ink-filled), a scrolling body at 12px 14px padding and 14px gaps. Contains labelled fields, segmented controls (ink fill when selected), 4-column chips (red when selected), steppers, note tags (red outline and red text), parameter-lock cards (hairline box, slider), a collapsible "more" section, selects, and a 2-column tool grid.

### Sliders
- 6px hairline track, 22 x 34px square thumb in ink (red variant via `.red`), 44px touch height.

### Icons
- Small functional stroke icons (22px, 2.2 stroke, square caps, mitre joins) for transport, stepping, paging and close, drawn inline. They label actions; there is no decorative iconography.

## Do's and Don'ts

### Do:
- **Do** use red only for active, armed or attention states, with black text on it.
- **Do** use white to mark position: track in hand, playhead, selection, focus.
- **Do** keep every touch target at least 44px and every edge a 1px hairline (#707070).
- **Do** keep corners square and depth flat; change fill, not elevation.
- **Do** use Inter Tight with tabular numerals, and carry hierarchy with weight.
- **Do** keep motion short on `cubic-bezier(.19, 1, .22, 1)` (.25s for switch knob, .35s for drawer and track resize) and honour `prefers-reduced-motion`.

### Don't:
- **Don't** add a second accent colour.
- **Don't** use rounded corners, shadows, glow or smooth gradients.
- **Don't** hide the other three tracks when one is in hand; they stay thin and live.
- **Don't** add decorative icons; icons only label an action.
- **Don't** use red text on black for body copy; red-on-black text is reserved for the brand word and note tags.

## Not canonized

Defects and drift the build carries, recorded so they are not inherited:
- `.status.error` declares `color: #fff` and then `color: var(--on-red)`; the first declaration is dead.
- Literals outside the token set: #fff (several), #232323 (roll playhead column), #000 (knob, `.pg` background, tie stripe) are written inline rather than as custom properties.
- The tie cell uses `repeating-linear-gradient`; the contract says no gradients. It is a hard-stop hatch, recorded as the tie mark above, not as licence for gradients.
- The `.name .num` badge and `.brand` in red follow the red-means-active rule only loosely (they label rather than activate).
