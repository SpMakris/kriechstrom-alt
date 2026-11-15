/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments */
/* KRIECHSTROM: the USER drum kit, every number of its tables editable (included by eng_drum.c, after drum_voice.c).
 *
 * The model kits (drum_voice.c DV_KIT) are tables of numbers in flash; KIT USER plays the same tables from RAM
 * (dv_ukit), one set for the whole instrument, 8 lanes. A lane, as a number list ("fields", UF_*):
 *   RUN   which voice the lane is: PUNCH SNARE CLAP HATC HATO TOM CONGA RIM CLAVE BELL CYM (the runs; ROUND is the
 *         STD kit's alternative kick and has no table)
 *   PTCH  its designed pitch, p16 (16 x the MIDI note)          DSPN  the decay's span, octaves x 16 over DECY 0..127
 *   DEC   the main decay's tau at DECY 0, 0.1 ms                GAIN  the output gain, Q12
 *   ACC   the accent: + (x / 16384) per accent step             V0..V12  the run's own numbers (drum_voice.c, above
 *         DV_KIT: what each is depends on the RUN, uk_meta says; a run uses 4..13 of them)
 *   ATK   the kick's attack sweep tau, 0.1 ms (PUNCH)           CHK  the hats' choke tau, 0.1 ms (HATC, HATO)
 *   R1..R6 the metal source's six ratios, Q12 (HATC, HATO, CYM)
 * Every write lands in its range (uk_set): the filters and envelopes of drum_voice.c have no clamps of their own (their
 * signals stay in range only while these numbers do), so a range here is the limit the voices were measured to
 * (tests/drum_test.c, the corner sweep of the USER kit). A field a RUN does not use is hidden: uk_meta returns 0, and
 * uk_set leaves it. The ranges keep what the model kits use inside them; a shipped lane is always in range.
 * Seeding: uk_seed copies a model kit (all lanes), uk_seed_lane one lane of one (a piece), uk_load_run a lane of a run's
 * first shipped design. Nothing here changes a number the audio ISR reads while it renders (a write is one 16-bit store
 * and dv_ugen moves after it: the next block sets the lane up again).
 * State not saved here (drum_ukit_store.c). */
enum {
    UF_RUN, UF_P16, UF_OCT, UF_TAU, UF_GAIN, UF_ACC,
    UF_V0,                                               /* .. UF_V0 + 12 */
    UF_ATK = UF_V0 + 13, UF_CHK, UF_R0,                  /* UF_R0 .. UF_R0 + 5 */
    UF_N = UF_R0 + 6
};
#define UK_NRUN 11u
static const uint8_t UK_RUNS[UK_NRUN] = {DVT_PUNCH, DVT_SNARE, DVT_CLAP, DVT_HATC, DVT_HATO, DVT_TOM, DVT_CONGA,
                                         DVT_RIM, DVT_CLAVE, DVT_BELL, DVT_CYM};
static const char *const UK_RUN_NAME[UK_NRUN] = {"PUNCH", "SNARE", "CLAP", "HAT CL", "HAT OP", "TOM", "CONGA", "RIM",
                                                 "CLAVE", "BELL", "CYM"};

typedef struct { char name[6]; int32_t lo, hi; } uk_meta_t;
#define UKM(n, l, h) {n, l, h}
#define UKX {"", 0, 0}
/* the run families: PUNCH SNARE CLAP HAT TOM RIM BELL CYM */
enum { UKF_PUNCH, UKF_SNARE, UKF_CLAP, UKF_HAT, UKF_TOM, UKF_RIM, UKF_BELL, UKF_CYM, UKF_N };
static const uk_meta_t UK_V[UKF_N][13] = {
    /* PUNCH */ {UKM("SWEEP", 0, 400), UKM("STAU", 1, 5000), UKM("ATKSW", 0, 600), UKM("HARM2", 0, 3200), UKM("HARM3", 0, 1040),
                 UKM("CLKP", 0, 2000), UKM("CLKL", 0, 5200), UKM("DRIVE", 0, 8192), UKM("RISE", 0, 500), UKM("HOLD", 0, 200),
                 UKX, UKX, UKX},
    /* SNARE */ {UKM("2ND", 0, 1000), UKM("GLIDE", 0, 400), UKM("GTAU", 1, 2000), UKM("SHTAU", 0, 1000), UKM("S2LVL", 0, 32767),
                 UKM("SHLVL", 0, 26000), UKM("NBAND", 1000, 2047), UKM("NDAMP", 3277, 12000), UKM("SPTAU", 1, 2000),
                 UKM("SPIKE", 0, 32767), UKM("NOISE", 0, 32767), UKM("BRIGT", 0, 32767), UKM("BCORN", 1000, 2047)},
    /* CLAP  */ {UKX, UKM("BDAMP", 3277, 12000), UKM("BCORN", 1000, 2047), UKM("BRIGT", 0, 16000), UKM("TAIL", 0, 32767),
                 UKM("TEETH", 0, 32767), UKM("TTAU", 1, 500), UKM("SPACE", 50, 2000), UKM("COUNT", 1, 16),
                 UKX, UKX, UKX, UKX},
    /* HAT   */ {UKM("BAND", 1000, 2047), UKM("BDAMP", 1024, 12000), UKM("HP1", 1000, 2239), UKM("HP2", 1000, 2239),
                 UKM("SIZZL", 0, 14500), UKM("METAL", 0, 32767), UKM("NOISE", 0, 18022), UKM("RISE", 1, 500),
                 UKX, UKX, UKX, UKX, UKX},
    /* TOM   */ {UKM("BEND", 0, 400), UKM("STAU", 1, 3000), UKM("STKLP", 1000, 2047), UKM("STICK", 0, 12000),
                 UKM("SLAP", 0, 3000), UKM("CLIP", 0, 12000), UKX, UKX, UKX, UKX, UKX, UKX, UKX},
    /* RIM   */ {UKM("2ND", -300, 700), UKM("BODY", 0, 30000), UKM("CRACK", 0, 30000), UKM("DRIVE", 0, 32000),
                 UKX, UKX, UKX, UKX, UKX, UKX, UKX, UKX, UKX},
    /* BELL  */ {UKM("2ND", 0, 700), UKM("BAND", 0, 700), UKM("BDAMP", 3277, 12000), UKM("STRIK", 0, 30000),
                 UKM("TAU", 1, 2000), UKM("SQRS", 0, 8000), UKX, UKX, UKX, UKX, UKX, UKX, UKX},
    /* CYM   */ {UKM("HBAND", 1000, 2047), UKM("HDAMP", 3277, 12000), UKM("LBAND", 1000, 2047), UKM("LDAMP", 3277, 12000),
                 UKM("HSHR", 0, 26000), UKM("STRIK", 0, 24000), UKM("STAU", 1, 3000), UKM("METAL", 0, 26000),
                 UKM("NOISE", 0, 10000), UKX, UKX, UKX, UKX},
};
static uint32_t uk_family(uint32_t run)
{
    switch (run) {
    case DVT_PUNCH: return UKF_PUNCH;
    case DVT_SNARE: return UKF_SNARE;
    case DVT_CLAP: return UKF_CLAP;
    case DVT_HATC:
    case DVT_HATO: return UKF_HAT;
    case DVT_TOM:
    case DVT_CONGA: return UKF_TOM;
    case DVT_RIM:
    case DVT_CLAVE: return UKF_RIM;
    case DVT_BELL: return UKF_BELL;
    default: return UKF_CYM;
    }
}
static const uk_meta_t UK_HEAD[6] = {UKM("RUN", 0, UK_NRUN - 1u), UKM("PITCH", 400, 2000), UKM("SPAN", 0, 96), UKM("DECAY", 1, 5000),
                                     UKM("GAIN", 0, 13955), UKM("ACCNT", 0, 120)};
/* PITCH is a pitch for a drum and a band for a noise voice: its range is the family's (a clap's band at 60 Hz is a rumble, not a clap) */
static const uk_meta_t UK_PIT[UKF_N] = {UKM("PITCH", 400, 900), UKM("PITCH", 600, 1200), UKM("PITCH", 1000, 2000), UKM("PITCH", 600, 2000),
                                        UKM("PITCH", 400, 1300), UKM("PITCH", 700, 2000), UKM("PITCH", 700, 1700), UKM("PITCH", 700, 2000)};
static const uk_meta_t UK_ATK = UKM("ATKTAU", 1, 255), UK_CHK = UKM("CHOKE", 1, 255), UK_RAT[6] = {
    UKM("RATIO1", 0, 65535), UKM("RATIO2", 0, 65535), UKM("RATIO3", 0, 65535), UKM("RATIO4", 0, 65535),
    UKM("RATIO5", 0, 65535), UKM("RATIO6", 0, 65535)};

/* the run's index in UK_RUNS (a DVT_ the table has no row for -> PUNCH) */
static uint32_t uk_run_index(uint32_t dvt)
{
    uint32_t i;
    for (i = 0; i < UK_NRUN; i++)
        if (UK_RUNS[i] == dvt)
            return i;
    return 0;
}

/* field f of a lane running run: its name and range, 0 where the run does not use it */
static const uk_meta_t *uk_meta(uint32_t run, uint32_t f)
{
    uint32_t fam = uk_family(run);
    if (f == UF_P16)
        return &UK_PIT[fam];
    if (f < UF_V0)
        return &UK_HEAD[f];
    if (f < UF_ATK)
        return UK_V[fam][f - UF_V0].hi ? &UK_V[fam][f - UF_V0] : 0;
    if (f == UF_ATK)
        return fam == UKF_PUNCH ? &UK_ATK : 0;
    if (f == UF_CHK)
        return fam == UKF_HAT ? &UK_CHK : 0;
    if (f < UF_N)
        return fam == UKF_HAT || fam == UKF_CYM ? &UK_RAT[f - UF_R0] : 0;
    return 0;
}

/* the lane's visible fields in order, n-th: its field id, UF_N when there is none */
static uint32_t uk_nth(uint32_t lane, uint32_t n)
{
    uint32_t f, run = dv_ukit[lane % DV_NLANE].k.run;
    for (f = 0; f < UF_N; f++)
        if (uk_meta(run, f) && n-- == 0)
            return f;
    return UF_N;
}
static uint32_t uk_count(uint32_t lane)
{
    uint32_t f, n = 0, run = dv_ukit[lane % DV_NLANE].k.run;
    for (f = 0; f < UF_N; f++)
        n += uk_meta(run, f) != 0;
    return n;
}

static int32_t uk_get(uint32_t lane, uint32_t f)
{
    const dv_ulane_t *u = &dv_ukit[lane % DV_NLANE];
    if (f == UF_RUN) return (int32_t)uk_run_index(u->k.run);
    if (f == UF_P16) return u->k.p16;
    if (f == UF_OCT) return u->k.oct16;
    if (f == UF_TAU) return u->k.tau0;
    if (f == UF_GAIN) return u->k.gain;
    if (f == UF_ACC) return u->acc;
    if (f < UF_ATK) return u->k.v[f - UF_V0];
    if (f == UF_ATK) return u->atk;
    if (f == UF_CHK) return u->chk;
    if (f < UF_N) return u->ratio[f - UF_R0];
    return 0;
}

/* the hats' and the cymbal's metal and noise levels add up inside the run (its output passes 2^17 above the model kits' sums
 * and the output stage overflows): their sum stays at the shipped largest, the one written gives way */
static int32_t uk_pair(const dv_ulane_t *u, uint32_t f, int32_t v)
{
    uint32_t fam = uk_family(u->k.run), a = UF_V0 + (fam == UKF_HAT ? 5u : 7u), b = a + 1u;
    if (fam != UKF_HAT && fam != UKF_CYM)
        return v;
    if (f == a)
        return v > 32767 - u->k.v[b - UF_V0] ? 32767 - u->k.v[b - UF_V0] : v;
    if (f == b)
        return v > 32767 - u->k.v[a - UF_V0] ? 32767 - u->k.v[a - UF_V0] : v;
    return v;
}
static void uk_store(dv_ulane_t *u, uint32_t f, int32_t v)
{
    if (f == UF_RUN) u->k.run = UK_RUNS[(uint32_t)v % UK_NRUN];
    else if (f == UF_P16) u->k.p16 = (int16_t)v;
    else if (f == UF_OCT) u->k.oct16 = (uint8_t)v;
    else if (f == UF_TAU) u->k.tau0 = (uint16_t)v;
    else if (f == UF_GAIN) u->k.gain = (uint16_t)v;
    else if (f == UF_ACC) u->acc = (uint8_t)v;
    else if (f < UF_ATK) u->k.v[f - UF_V0] = (int16_t)v;
    else if (f == UF_ATK) u->atk = (uint8_t)v;
    else if (f == UF_CHK) u->chk = (uint8_t)v;
    else if (f < UF_N) u->ratio[f - UF_R0] = (uint16_t)v;
}

/* a lane's numbers that its RUN has no use for, and the ones out of its range, put in range (0 for an unused v) */
static void uk_fit(dv_ulane_t *u)
{
    uint32_t f;
    u->k.run = UK_RUNS[uk_run_index(u->k.run)];
    for (f = 1; f < UF_N; f++) {
        const uk_meta_t *m = uk_meta(u->k.run, f);
        int32_t v = uk_get((uint32_t)(u - dv_ukit), f);
        if (!m) {
            if (f >= UF_V0 && f < UF_ATK)
                u->k.v[f - UF_V0] = 0;
            continue;
        }
        v = v < m->lo ? m->lo : v > m->hi ? m->hi : v;
        uk_store(u, f, v);
    }
    for (f = UF_V0; f < UF_ATK; f++)                     /* (the metal and noise sum: uk_pair, for a lane read from flash) */
        uk_store(u, f, uk_pair(u, f, u->k.v[f - UF_V0]));
}

static void uk_load_run(uint32_t lane, uint32_t run);
/* field f of lane = v, into its range; 1 when the lane changed (the next block sets it up again) */
static uint32_t uk_set(uint32_t lane, uint32_t f, int32_t v)
{
    dv_ulane_t *u = &dv_ukit[lane % DV_NLANE];
    const uk_meta_t *m = uk_meta(u->k.run, f);
    if (!m)
        return 0;
    v = v < m->lo ? m->lo : v > m->hi ? m->hi : v;
    v = uk_pair(u, f, v);
    if (uk_get(lane, f) == v)
        return 0;
    if (f == UF_RUN) {                                   /* another voice: a first shipped design of it, not the old run's numbers */
        uk_load_run(lane, UK_RUNS[(uint32_t)v % UK_NRUN]);
        return 1;
    }
    uk_store(u, f, v);
    dv_ugen++;
    return 1;
}

/* lane from a shipped lane (a model kit's, nibble 1..DV_NKIT, lane 0..7) */
static void uk_copy_lane(dv_ulane_t *u, uint32_t nib, uint32_t src)
{
    const dv_kit_t *K = &DV_KIT[(nib - 1u) % DV_NKIT][src % DV_NLANE];
    uint32_t i, row = K->run == DVT_CYM ? (uint32_t)K->v[9] : (uint32_t)K->v[8];
    memset(u, 0, sizeof *u);
    u->k = *K;
    u->acc = DV_KIT_ACC[(nib - 1u) % DV_NKIT];
    u->atk = u->chk = 15;                                /* the model kits' 1.5 ms */
    for (i = 0; i < 6u; i++)
        u->ratio[i] = DV_METAL_R[row % 7u][i];
    uk_fit(u);
}
static void uk_seed_lane(uint32_t lane, uint32_t nib, uint32_t src)
{
    uk_copy_lane(&dv_ukit[lane % DV_NLANE], nib, src);
    dv_ugen++;
}
static void uk_seed(uint32_t nib)
{
    uint32_t l;
    for (l = 0; l < DV_NLANE; l++)
        uk_copy_lane(&dv_ukit[l], nib, l);
    dv_ugen++;
}
/* a lane as the first shipped design of a run is */
static void uk_load_run(uint32_t lane, uint32_t run)
{
    uint32_t k, l;
    for (k = 0; k < DV_NKIT; k++)
        for (l = 0; l < DV_NLANE; l++)
            if (DV_KIT[k][l].run == run) {
                uk_seed_lane(lane, k + 1u, l);
                return;
            }
}
static uint8_t uk_ready;
static void uk_ensure(void)                              /* (power-on: the 80 kit; a stored kit replaces it) */
{
    if (!uk_ready) {
        uk_ready = 1;
        uk_seed(1);
    }
}
