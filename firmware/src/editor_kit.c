/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Spiros Makris (tablet companion; the file follows the fork's licence) */
/* Editor protocol: the USER drum kit (drum_ukit.c, drum_ukit_store.c), cmds 88..93, INFO 59 01 ED_KIT_CAPS.
 * Numbers travel as 3 x 7 bit, the value + ED_KIT_OFS (the ranges go from -300 to 65535).
 *   88 KIT_LANE  [lane]                      -> lane, run, n, then n x (field, value 3, lo 3, hi 3, name 0-terminated)
 *   89 KIT_SET   [lane, field, value 3]      -> as KIT_LANE of the lane (the value in its range, the paired number given
 *                                               way, a RUN change: the new run's first design)
 *   90 KIT_INFO  []                          -> nruns, nlanes, nsaved, used, working, nseeds, runs' names, seeds' names, the
 *                                               saved kits' names (0-terminated, empty where none)
 *   91 KIT_SLOT  [1 SAVE, k, name 7-bit..]   -> op, k, rc (0, 1 bad, 2 flash error or the transport runs, 3 RAM only), used
 *                [2 LOAD, k] [3 ERASE, k]       LOAD plays the kit k as the working kit
 *   92 KIT_SEED  [127, seed] | [lane, seed, source lane] -> rc (0, 1)     a model kit (seed 1..DV_NKIT) into the working kit
 *   93 KIT_CHANGED (push, while watched)     [dv_ugen, used, working 0/1]  the working kit or the saved ones changed on the
 *                                               device (its knobs, its SAVE): read the lane again
 * A write of the editor is a write of the instrument: the working kit is what KIT USER plays. */
enum { ED_KIT_LANE = 88, ED_KIT_SET, ED_KIT_INFO, ED_KIT_SLOT, ED_KIT_SEED };   /* (ED_KIT_CHANGED = 93: editor.c) */
#define ED_KIT_OFS 1024
#define ED_KIT_CAPS 1u

static uint32_t ed_kit_sig(void) { return (uint32_t)dv_ugen | (uks.used & 127u) << 8; }

static void ed_kit_lane(uint32_t lane)
{
    uint32_t i, n = uk_count(lane), f;
    ed_b(lane);
    ed_b((uint32_t)uk_get(lane, UF_RUN));
    ed_b(n);
    for (i = 0; i < n; i++) {
        const uk_meta_t *m;
        f = uk_nth(lane, i);
        m = uk_meta(dv_ukit[lane].k.run, f);
        ed_b(f);
        ed_b3((uint32_t)(uk_get(lane, f) + ED_KIT_OFS));
        ed_b3((uint32_t)(m->lo + ED_KIT_OFS));
        ed_b3((uint32_t)(m->hi + ED_KIT_OFS));
        ed_str(m->name, 5);
    }
}

static int ed_kit_args_ok(uint32_t cmd, const uint8_t *a, uint32_t n)
{
    switch (cmd) {
    case ED_KIT_LANE:
        return n == 1u && a[0] < DV_NLANE;
    case ED_KIT_SET:
        return n == 5u && a[0] < DV_NLANE && a[1] < UF_N;
    case ED_KIT_INFO:
        return n == 0u;
    case ED_KIT_SLOT:
        return n >= 2u && ((a[0] == 1u && n >= 3u && n <= 14u) || ((a[0] == 2u || a[0] == 3u) && n == 2u));
    case ED_KIT_SEED:
        return (n == 2u && a[0] == 127u && a[1] >= 1u && a[1] <= DV_NKIT) ||
               (n == 3u && a[0] < DV_NLANE && a[1] >= 1u && a[1] <= DV_NKIT && a[2] < DV_NLANE);
    default:
        return 1;
    }
}

static int ed_kit_handle(uint32_t cmd, const uint8_t *a, uint32_t n)
{
    uint32_t i, rc;
    switch (cmd) {
    case ED_KIT_LANE:
        uk_ensure();
        ed_kit_lane(a[0]);
        return 1;
    case ED_KIT_SET:
        uk_ensure();
        if (uk_meta(dv_ukit[a[0]].k.run, a[1]))
            uk_set(a[0], a[1], (int32_t)ed_r3(a + 2) - ED_KIT_OFS);
        ed_kit_lane(a[0]);
        ed_w.kg = ed_kit_sig();                          /* (the editor's own change: no push) */
        return 1;
    case ED_KIT_INFO:
        uk_ensure();
        ed_b(UK_NRUN); ed_b(DV_NLANE); ed_b(UKS_SAVED); ed_b(uks.used & 127u); ed_b((uks.used >> UKS_SAVED) & 1u);
        ed_b(DV_NKIT);
        for (i = 0; i < UK_NRUN; i++)
            ed_str(UK_RUN_NAME[i], 8);
        for (i = 0; i < DV_NKIT; i++)
            ed_str(N_DRUM_KIT[DK_80 + i], 8);
        for (i = 0; i < UKS_SAVED; i++)
            ed_str(uks_valid(i) ? uks.r[i].name : "", 12);
        return 1;
    case ED_KIT_SLOT:
        if (a[1] >= UKS_SAVED) {
            rc = 1;
        } else if (a[0] == 1u) {
            char nm[13];
            for (i = 0; i + 2u < n; i++)
                nm[i] = (char)a[2u + i];
            nm[i] = 0;
            rc = ed_flash_stop() ? 2u : (uint32_t)uks_save(a[1], nm);
        } else if (a[0] == 2u) {
            rc = (uint32_t)uks_load(a[1]);
        } else {
            rc = ed_flash_stop() ? 2u : (uint32_t)uks_erase(a[1]);
            if (rc == 1u)
                rc = 0;                                  /* (already none: the state asked for) */
        }
        ed_b(a[0]); ed_b(a[1]); ed_b(rc); ed_b(uks.used & 127u);
        ed_w.kg = ed_kit_sig();
        return 1;
    case ED_KIT_SEED:
        uk_ensure();
        if (n == 2u)
            uk_seed(a[1]);
        else
            uk_seed_lane(a[0], a[1], a[2]);
        ed_b(0);
        return 1;
    default:
        return 0;
    }
}
