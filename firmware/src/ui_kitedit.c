/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Spiros Makris (tablet companion; the file follows the fork's licence) */
/* EDIT > KIT 1..7 and KIT SLOT: the USER drum kit on the machine (drum_ukit.c, drum_ukit_store.c). They show on a DRUM
 * track whose KIT is USER (EDIT 1), in the EDIT family where OPERATOR's pages are, as FM6's operator pages do (ui_fm6op.c):
 *   KIT n       KNOB 1 the LANE (1..8: the run's name under it), KNOB 2..4 the lane's fields, three a page in the order of
 *               uk_nth (RUN PITCH SPAN DECAY GAIN ACCNT, then the run's own numbers, ATKTAU / CHOKE, the metal ratios).
 *               The pages some lane has fields for show: a lane with fewer leaves the cards blank. A detent is one write
 *               of a number (uk_set: into its range); the audio takes it at its next block, the tablet is told (KIT_CHANGED)
 *   KIT SLOT    KNOB 1 the slot (K1..K7 the saved kits, then the model kits 80 10 66 55 77 DEEP TIGHT PERC), then LOAD ERASE
 *               SAVE as SAVE > USER: LOAD plays it as the working kit (a model kit: all eight lanes of it), SAVE writes the
 *               working kit under the name "KIT n" (a tablet names it), ERASE removes a saved kit. Flash writes stop the
 *               transport first as everywhere ("STOP TO SAVE").
 * The kit being edited is the working kit: KIT USER plays it, it is written 2 s after the last change and comes back at
 * power-on. No undo of a number (a model kit's LOAD brings a first design back). Included by ui.c. */
#define KIT_NSAVED 7u                                /* the saved kits (drum_ukit_store.c UKS_SAVED: asserted there) */
/* the kits' store (drum_ukit_store.c, after the UI) */
static int uks_valid(uint32_t k);
static int uks_load(uint32_t k);
static int uks_save(uint32_t k, const char *name);
static int uks_erase(uint32_t k);
static void uks_name(uint32_t k, char *b);           /* (13 bytes) */
static uint32_t uks_mask(void);                      /* bit k: a kit is saved in K(k + 1) */
static int32_t accel(uint32_t role, int32_t s, int32_t range);   /* (ui_input.c) */
static uint8_t kit_lane;                             /* the lane shown, 0..7 */
static uint8_t kit_slot;                             /* KIT SLOT: 0..6 the saved kits, 7..14 the model kits */
#define KIT_SLOTS (KIT_NSAVED + DV_NKIT)

static int kit_ok(void) { return TSEL->eng_req % NENGINES == ENGI_DRUM && drum_kit_plays(TSEL->p[P_E0]) == DK_USER; }
static int kit_page(uint32_t g) { return g >= GR_KIT0 && g <= GR_KIT6; }
static uint32_t kit_pages(void)                      /* the pages some lane has fields for */
{
    uint32_t l, m = 1;
    for (l = 0; l < DV_NLANE; l++) {
        uint32_t p = (uk_count(l) + 2u) / 3u;
        m = p > m ? p : m;
    }
    return m;
}
static int kit_vis(uint32_t g)                       /* (ui.c page_visible) */
{
    if (!kit_ok())
        return 0;
    uk_ensure();
    return g == GR_KITSLOT || (g - GR_KIT0) < kit_pages();
}
static uint32_t kit_pg(void) { return cur_page()->graph - GR_KIT0; }
static uint32_t kit_field(uint32_t slot)             /* knob slot 1..3 of this page: its field of the lane, UF_N = none */
{
    return uk_nth(kit_lane, kit_pg() * 3u + slot - 1u);
}

static void kit_knob(uint32_t slot, int32_t steps)
{
    uint32_t f;
    const uk_meta_t *m;
    if (!kit_ok() || !steps)
        return;
    uk_ensure();
    if (!slot) {
        kit_lane = (uint8_t)clamp((int32_t)kit_lane + steps, 0, (int32_t)DV_NLANE - 1);
        return;
    }
    f = kit_field(slot);
    m = f < UF_N ? uk_meta(dv_ukit[kit_lane].k.run, f) : 0;
    if (!m)
        return;
    uk_set(kit_lane, f, clamp(uk_get(kit_lane, f) + accel(EN_K1 + slot, steps, m->hi - m->lo), m->lo, m->hi));
}

/* a card of a KIT page: label, value (12), unit, gauge, icon; 0 = a blank column. vo >= 0: as if the field held vo (span) */
static int kit_card_at(uint32_t slot, int32_t vo, const char **label, char *val, const char **unit, int32_t *ratio, uint32_t *icon)
{
    uint32_t f;
    const uk_meta_t *m;
    int32_t v;
    *unit = "";
    *ratio = -1;
    *icon = 0xFEu;                                     /* (ICON_AUTO: by the label, icons.c) */
    val[0] = 0;
    uk_ensure();
    if (!slot) {
        *label = "LANE";
        fmt_int(val, (int32_t)kit_lane + 1);
        *unit = UK_RUN_NAME[uk_run_index(dv_ukit[kit_lane].k.run)];
        *ratio = (int32_t)kit_lane * 1000 / (int32_t)(DV_NLANE - 1u);
        return 1;
    }
    f = kit_field(slot);
    m = f < UF_N ? uk_meta(dv_ukit[kit_lane].k.run, f) : 0;
    if (!m)
        return 0;
    *label = m->name;
    v = vo >= 0 ? vo : uk_get(kit_lane, f);
    if (f == UF_RUN)
        str_cpy(val, UK_RUN_NAME[(uint32_t)v % UK_NRUN], 12);
    else
        fmt_int(val, v);
    *ratio = m->hi > m->lo ? (v - m->lo) * 1000 / (m->hi - m->lo) : 0;
    return 1;
}

/* KIT SLOT: the slot's label ("K3", "M") and what it holds ("MY KIT", "80", "--") */
static void kit_slot_label(uint32_t k, char *tag, char *nm)
{
    if (k < KIT_NSAVED) {
        tag[0] = 'K';
        tag[1] = (char)('1' + k);
        tag[2] = 0;
        if (uks_valid(k))
            uks_name(k, nm);
        else
            str_cpy(nm, "--", 13);
    } else {
        str_cpy(tag, "M", 4);
        str_cpy(nm, N_DRUM_KIT[DK_80 + (k - KIT_NSAVED)], 13);
    }
}
static int kit_slot_used(uint32_t k) { return k >= KIT_NSAVED || uks_valid(k); }

/* OCT+ on KIT SLOT: c 1 LOAD, 2 ERASE, 3 SAVE */
static void kit_act(uint32_t c)
{
    uint32_t k = kit_slot % KIT_SLOTS;
    char nm[8] = {'K', 'I', 'T', ' ', 0, 0, 0, 0};
    int rc;
    if (c > 1u)
        ui.act = 0;
    if (c == 1u) {
        if (!kit_slot_used(k)) {
            ui_message("EMPTY KIT");
        } else {
            if (k >= KIT_NSAVED)
                uk_seed(k - KIT_NSAVED + 1u);
            else
                (void)uks_load(k);
            ui_message("KIT LOADED");
        }
    } else if (k >= KIT_NSAVED) {
        ui_message("MODEL KIT: NOT SAVED OVER");
    } else if (transport_busy()) {
        ui_message("STOP TO SAVE");
    } else if (c == 2u) {
        ui_message(uks_valid(k) ? (uks_erase(k) == 2 ? "FLASH ERROR" : "KIT ERASED") : "EMPTY KIT");
    } else {
        nm[4] = (char)('1' + k);
        rc = uks_save(k, nm);
        ui_message(rc == 2 ? "FLASH ERROR" : rc == 3 ? "SAVED (RAM ONLY)" : "KIT SAVED");
    }
    ui.force = 1;
}
