# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain HTML, CSS and JavaScript. Static files, no build step.

## Users

The owner of an M-VAVE FM-1 running KRIECHSTROM firmware, using the screen as a companion beside the machine while playing and programming. The first user is the person commissioning this editor. Other audiences are not confirmed.

## Product Purpose

A live editor and companion screen for the KRIECHSTROM firmware (a fork of Felucca 1.8.2, 0.2 source on hand) on the FM-1. It replaces the shipped `web/editor.html`, which the owner finds unintuitive and low-level. Its first surface is the sequencer.

## Operating Context

The owner describes the FM-1 as a jam machine for the living room, not a studio workstation; the editor must feel intuitive rather than technical. The FM-1 is within reach while the tablet is used, so the screen complements the machine's own controls and does not have to duplicate all of them. The owner wants all four tracks within reach to jam with, without feeling overwhelmed. The editor talks to it over USB-MIDI SysEx (WebMIDI, Chrome or Edge). The device protocol is documented in the firmware's `web/EDITOR_PROTOCOL.md`; the shipped editor includes a built-in mock device (`?mock=1`) that renders without hardware.

## Capabilities and Constraints

- First version of sequencer editing covers everything the device stores: notes, velocity, accent, slide, tie, ratchet, chance or condition, nudge, parameter locks, plus LEN, DIV, SWING, GATE and the SEQ TOOLS.
- The sequencer must be designed for a tablet screen, so touch is the primary input. The tablet is used in landscape and has an 8 to 9 inch screen. Tablet OS is undecided.
- Nothing scrolls. This is a design rule from the owner: the app is made for tablets, not desktops. Every screen, drawer and sheet fits the viewport; content that does not fit is split into sub-tabs or pages.
- Steps are shown in pages of 16 per screen. The owner finds 64 on one screen overwhelming.
- The tablet is the MIDI clock master from version 1 (the owner's decision). The device's clock source is set to USB; the tablet sends 24 pulses per quarter note plus Start, Continue and Stop over WebMIDI, and the live playhead is derived from those pulses. The device's own BPM and transport then follow the tablet.
- Firmware facts (from `firmware/src/midi_clock.c` and `web/EDITOR_PROTOCOL.md`): with source USB the sequencer steps on incoming pulses; Start (0xFA) restarts from step 0; Continue (0xFB) resumes; Stop (0xFC) stops; BPM follows the incoming tempo within 40 to 240; 500 ms without a pulse stops the transport; changing the clock source stops the transport.
- The protocol's pushes are CHANGED, RELOAD, STEP_CHANGED and TRACK_CHANGED. None reports the play position, so position comes from the tablet's own clock.
- Undecided: what the machine's own PLAY button does while the clock source is USB; whether USB real-time messages sent between SysEx frames are handled correctly by the device; the timing quality of a tablet's WebMIDI clock. None of these is verified without hardware. iOS support is undecided.
- No real FM-1 hardware testing is confirmed to be available in this environment.

## Brand Commitments

Keep and deepen the existing KRIECHSTROM look: black, white and one red. Visual world is not otherwise specified.

## Evidence on Hand

`kriechstrom-0.2-src.tar.gz` in the project root: firmware source, `web/editor.html`, `web/EDITOR_PROTOCOL.md`, the manual in `site/manual/en.html`, and web tests with a mock device. No usage data, no user research, no screenshots of real hardware sessions.

## Product Principles

- A companion first: the screen serves someone whose hands and attention are on the machine.
- Everything the device stores is reachable from the screen.
