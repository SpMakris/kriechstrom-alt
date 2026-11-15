/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Spiros Makris (tablet companion; the file follows the fork's licence) */
/* What the tablet companion needs beyond the editor protocol of 1.8 (EDITOR_PROTOCOL.md "Tablet companion"; INFO 58 01
 * ED_K_CAPS): cmd 82 PERF, 83 KEYMAP, 84 SLICE, 85 DRUMMUTE, 86 CLEARALL, and HISS (G_HISS) through GET / SET / DESC of
 * scope 1. Every command sets a state (nothing toggles), so a lost or repeated frame does no harm.
 *
 * PERF holds what the FX layer holds with a key (the effects, perform.c ed_pf), the four FX macros (perf_k), GLO's SOLO
 * (ed_solo) and FILL (ed_fill). Nothing stays held when the tablet goes quiet: the tablet repeats the command while a
 * finger is down, and ED_K_HOLD_MS after the last one (the cable pulled, the page left, a lost touch-up) everything the
 * editor holds is let go, the macros it set go back to 0. The effects, SOLO and FILL are OR'd into the device's own
 * (a held key and the tablet's finger both count); FX KILL (the menu, a dialog) silences the editor's too. */
#ifndef fx_keys
#define fx_keys (&favorites.factory[15][14])            /* (ui_layer.c: the FX layer's key map in the settings) */
#endif
enum { ED_PERF = 82, ED_KEYMAP, ED_SLICE, ED_DRUMMUTE, ED_CLEARALL, ED_MLEARN };
#define ED_K_HOLD_MS 600u
#define ED_K_CLEAR_KEY 0x59u                      /* CLEARALL's argument: it takes this byte, no frame by accident */
/* INFO 58 01 caps: bit 0 PERF, 1 KEYMAP, 2 SLICE, 3 DRUMMUTE, 4 CLEARALL, 5 HISS, 6 MLEARN */
#if FELUCCA_SLICE
#define ED_K_SLICE 4u
#else
#define ED_K_SLICE 0u
#endif
#define ED_K_CAPS (1u | 2u | ED_K_SLICE | 8u | 16u | 32u | 64u)

static struct {
    uint32_t last;                                /* fm1_ms of the last PERF */
    uint8_t own;                                  /* bit i: the editor set the macro perf_k[i] */
    uint8_t on;                                   /* something is held */
} ed_k;

static void ed_b3(uint32_t v) { ed_b(v & 127u); ed_b((v >> 7) & 127u); ed_b((v >> 14) & 127u); }
static uint32_t ed_r3(const uint8_t *a) { return a[0] | ((uint32_t)a[1] << 7) | ((uint32_t)a[2] << 14); }

static void ed_krst_release(void)
{
    uint32_t i;
    ed_pf = 0;
    ed_solo = 0;
    ed_fill = 0;
    for (i = 0; i < 4u; i++)
        if ((ed_k.own >> i) & 1u)
            perf_k[i] = 0;
    ed_k.own = 0;
    ed_k.on = 0;
}

/* main loop, every pass: nothing stays held when the tablet is gone */
static void ed_krst_tick(void)
{
    if (ed_k.on && fm1_ms - ed_k.last > ED_K_HOLD_MS)
        ed_krst_release();
}

/* the effects, the macros as sent, SOLO, FILL; then what the device says: which effects can run (perf_avail), which run,
 * which the device itself holds, FX LATCH on, effects off */
static void ed_perf_reply(void)
{
    uint32_t i;
    ed_b3(ed_pf);
    for (i = 0; i < 4u; i++)
        ed_b(i ? (uint32_t)perf_k[i] : (uint32_t)((perf_k[0] + 100) / 2));
    ed_b(ed_solo);
    ed_b(ed_fill);
    ed_b3(perf_avail());
    ed_b3(perf_act);
    ed_b3(perf_held | perf_latched);
    ed_b(perf_latch_on != 0u);
    ed_b(perf_kill != 0u);
}
/* args (9): effects (3 x 7 bit, bit e = PF_* e < PF_NFX), FILTER (0..100: -100..+100 in steps of 2, 50 = none), CRUSH,
 * THROW, DEPTH (0..100), SOLO (a bit per track), FILL (0 / 1) */
static int ed_perf_ok(const uint8_t *a, uint32_t n)
{
    return n == 0u || (n == 9u && a[2] < 16u && a[3] <= 100u && a[4] <= 100u && a[5] <= 100u && a[6] <= 100u &&
                       a[7] < (1u << NTRK) && a[8] <= 1u);
}
static void ed_perf_set(const uint8_t *a)
{
    uint32_t i;
    int32_t v;
    for (i = 0; i < 4u; i++) {
        v = i ? (int32_t)a[3u + i] : (int32_t)a[3] * 2 - 100;
        if (v) {
            perf_k[i] = (int8_t)v;
            ed_k.own |= (uint8_t)(1u << i);
        } else if ((ed_k.own >> i) & 1u) {
            perf_k[i] = 0;
            ed_k.own &= (uint8_t)~(1u << i);
        }
    }
    ed_pf = ed_r3(a) & (PF_BIT(PF_NFX) - 1u);
    ed_solo = a[7];
    ed_fill = a[8];
    ed_k.last = fm1_ms;
    ed_k.on = (uint8_t)(ed_pf || ed_k.own || ed_solo || ed_fill);
    ui.force = 1;
}

/* KEYMAP: no args = the map; 2 (key 0..15, effect: 0..PF_NFX - 1, or PF_N = none) = one key set; 1 (127) = the default
 * map. Reply: rc (0 saved, 1 refused, 3 RAM only, 4 queued until STOP), 16 effects */
static int ed_keymap_ok(const uint8_t *a, uint32_t n)
{
    return n == 0u || (n == 2u && a[0] < PF_KEYS && (a[1] < PF_NFX || a[1] == PF_N)) || (n == 1u && a[0] == 127u);
}
static void ed_keymap_handle(const uint8_t *a, uint32_t n)
{
    uint32_t p, rc = 0;
    if (n == 2u)
        perf_map_put(fx_keys, a[0], a[1]);
    else if (n == 1u)
        for (p = 0; p < PF_KEYS; p++)
            perf_map_put(fx_keys, p, PF_DEF[p]);
    if (n) {
        ui.force = 1;
        rc = ed_ui_save();
    }
    ed_b(rc);
    for (p = 0; p < PF_KEYS; p++)
        ed_b(perf_map_of(fx_keys, p));
}

#if FELUCCA_SLICE
/* SLICE: [slot] reads, [slot, n, end (3), n x start (3)] writes the MAN slices of user slot 0..SMP_USER_SLOTS - 1 (n 0:
 * none, the AUTO slices again). Positions are samples (3 x 7 bit). Reply: slot, rc (0, 1 no such slot or no sample,
 * 2 refused: the points do not fit the sample, SLC_MIN apart, sorted), man (1: the table is the MAN one, 0: AUTO's
 * shown), the sample's length (3), n, end (3, 0 = the sample's end), n x start (3). The DIV of the track (P_E1) is the
 * editor's to set to MAN (4 + 5 steps of the SLICE page: P_E1 = SLC_DIV_MAN) */
static int ed_slice_ok(const uint8_t *a, uint32_t n)
{
    return n == 1u || (n >= 5u && a[1] <= SLC_AUTO && n == 5u + 3u * a[1]);
}
static void ed_slice_handle(const uint8_t *a, uint32_t n)
{
    uint32_t k = a[0], rc = 0, i, cnt = 0, end = 0, len = 0, man = 0, pos[SLC_AUTO];
    const slc_src_t *s = k < SMP_USER_SLOTS ? slc_get(k + 1u) : 0;
    slc_man_t *m;
    if (!s)
        rc = 1;
    else if (n > 1u) {
        cnt = a[1];
        for (i = 0; i < cnt; i++)
            pos[i] = ed_r3(a + 5u + 3u * i);
        if (!cnt) {
            m = slc_man_begin(k);                 /* (none: the AUTO slices from the next note on) */
            m->n = 0;
            m->end = 0;
            slc_man_commit(k);
            slc_man_save |= (uint8_t)(1u << k);
        } else if (slc_man_restore(k, cnt, ed_r3(a + 2), pos))
            rc = 2;
        else
            slc_man_save |= (uint8_t)(1u << k);
        ui.force = 1;
    }
    ed_b(k);
    ed_b(rc);
    if (rc == 1u) {
        ed_b(0); ed_b3(0); ed_b(0); ed_b3(0);
        return;
    }
    man = slc_man[k][slc_man_cur[k] & 1u].n != 0u;
    m = slc_man_begin(k);                         /* (the table in use: MAN's, or AUTO's as MAN would start) */
    len = s->len;
    cnt = m ? m->n : 0u;
    end = m ? m->end : 0u;
    ed_b(man);
    ed_b3(len);
    ed_b(cnt);
    ed_b3(end);
    for (i = 0; i < cnt; i++)
        ed_b3(m->pos[i]);
}
#endif

/* DRUMMUTE: [track] reads, [track, lanes lo (7 bit), lanes hi (1 bit)] sets the lane mutes (bit l: lane l muted, as the
 * quick actions of the EDIT layer toggle them). Reply: track, lo, hi */
static int ed_drummute_ok(const uint8_t *a, uint32_t n)
{
    return (n == 1u || (n == 3u && a[2] <= 1u)) && a[0] < NTRK;
}
static void ed_drummute_handle(const uint8_t *a, uint32_t n)
{
    uint32_t k = a[0] % NPART;
    if (n == 3u) {
        drum_mute[k] = (uint8_t)(a[1] | (a[2] << 7));
        ui.force = 1;
    }
    ed_b(a[0]);
    ed_b(drum_mute[k] & 127u);
    ed_b(drum_mute[k] >> 7);
}

/* CLEARALL: [0x59] the music as a new project (MENU > SYSTEM > CLEAR ALL, project.c project_new: the stored projects,
 * user presets, samples, settings and MIDI LEARN stay). Reply: rc (0 done, 1 refused) */
static int ed_clearall_handle(void)
{
    return project_new() ? 1 : 0;
}

/* MLEARN: no args reads, [0 / 1] sets MIDI LEARN off / on (GLO + D4 on the machine: the next knob turned is picked, then a
 * CC). Reply: on */
static void ed_mlearn_handle(const uint8_t *a, uint32_t n)
{
    if (n == 1u && (a[0] != 0u) != (ui.ml.on != 0u))
        ml_toggle();
    ed_b(ui.ml.on != 0u);
}

static int ed_krst_args_ok(uint32_t cmd, const uint8_t *a, uint32_t n)
{
    switch (cmd) {
    case ED_PERF:
        return ed_perf_ok(a, n);
    case ED_KEYMAP:
        return ed_keymap_ok(a, n);
    case ED_SLICE:
#if FELUCCA_SLICE
        return ed_slice_ok(a, n);
#else
        return 0;
#endif
    case ED_DRUMMUTE:
        return ed_drummute_ok(a, n);
    case ED_CLEARALL:
        return n == 1u && a[0] == ED_K_CLEAR_KEY;
    case ED_MLEARN:
        return n == 0u || (n == 1u && a[0] <= 1u);
    default:
        return 1;
    }
}

static int ed_krst_handle(uint32_t cmd, const uint8_t *a, uint32_t n)
{
    switch (cmd) {
    case ED_PERF:
        if (n)
            ed_perf_set(a);
        ed_perf_reply();
        return 1;
    case ED_KEYMAP:
        ed_keymap_handle(a, n);
        return 1;
#if FELUCCA_SLICE
    case ED_SLICE:
        ed_slice_handle(a, n);
        return 1;
#endif
    case ED_DRUMMUTE:
        ed_drummute_handle(a, n);
        return 1;
    case ED_CLEARALL:
        ed_b(ed_clearall_handle());
        return 1;
    case ED_MLEARN:
        ed_mlearn_handle(a, n);
        return 1;
    default:
        return 0;
    }
}
