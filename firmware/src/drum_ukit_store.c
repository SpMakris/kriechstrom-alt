/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments */
/* KRIECHSTROM: the USER drum kits in flash (included by upreset.c, after up_fm6.c).
 *
 * Where: storage.c's object OBJ_UPRESET0 + 1, the sector pair 0xDE000 / 0xDF000, which held user presets 17..32 until
 * the user presets became 16 (core.h UP_SLOTS): the flash map did not have another free pair. Like every object, an A/B
 * pair: a save writes the copy that is not current, the commit record last. A bank of user presets that older firmware
 * left there (another record size and magic) reads as no kits here, and the first save of a kit replaces it.
 * Payload: a header (magic "UKT1", version, record count, the used mask) and 8 records of a name and the 8 lanes' UF_N
 * 16-bit fields (drum_ukit.c), 3568 bytes. Records 0..6 are the saved kits K1..K7; record 7 is the working kit, the one
 * KIT USER plays, which uks_poll keeps (written once the transport has stopped and the kit has been still for 2 s,
 * as settings_poll writes the settings) and uks_boot restores. Every field read from flash goes through uk_fit (flash,
 * or a restored backup, may hold anything). */
#define UKS_OBJ (OBJ_UPRESET0 + 1u)
#define UKS_MAGIC 0x31544B55u                    /* "UKT1" */
#define UKS_N 8u
#define UKS_SAVED 7u                             /* K1..K7; record UKS_SAVED is the working kit */
typedef struct {
    char name[12];                               /* ASCII 32..126, 0-padded */
    uint16_t f[DV_NLANE][UF_N];
} uks_rec_t;
typedef struct {
    uint32_t magic;
    uint16_t ver, n;                             /* 1, UKS_N */
    uint32_t used, rsv;                          /* bit k: record k holds a kit */
    uks_rec_t r[UKS_N];
} uks_t;
_Static_assert(sizeof(uks_t) <= 3840u, "USER kits: one storage object");
static uks_t uks __attribute__((section(".pool")));
static uint8_t uks_gen;                          /* dv_ugen when the working kit was last written (or read) */
static uint32_t uks_ms;                          /* when dv_ugen last moved */
static uint8_t uks_moved;

static void uks_pack(uks_rec_t *rec)
{
    uint32_t l, f;
    for (l = 0; l < DV_NLANE; l++)
        for (f = 0; f < UF_N; f++)
            rec->f[l][f] = (uint16_t)uk_get(l, f);
}

/* the 16-bit field of a record as the number it is (the signed ones: pitch and the run's numbers) */
static int32_t uks_val(uint32_t f, uint16_t raw) { return f == UF_P16 || (f >= UF_V0 && f < UF_ATK) ? (int32_t)(int16_t)raw : (int32_t)raw; }

/* record rec -> the lanes, every number into its range */
static void uks_apply(const uks_rec_t *rec)
{
    uint32_t l, f;
    for (l = 0; l < DV_NLANE; l++) {
        dv_ulane_t *u = &dv_ukit[l];
        memset(u, 0, sizeof *u);
        u->k.run = UK_RUNS[rec->f[l][UF_RUN] % UK_NRUN];
        for (f = 1; f < UF_N; f++)
            uk_store(u, f, uks_val(f, rec->f[l][f]));
        uk_fit(u);
    }
    uk_ready = 1;
    dv_ugen++;
}

static int uks_name_ok(const char *s)
{
    uint32_t i;
    for (i = 0; i < 12u && s[i]; i++)
        if ((uint8_t)s[i] < 32u || (uint8_t)s[i] > 126u)
            return 0;
    return s[0] != 0;
}

static int uks_valid(uint32_t k) { return k < UKS_SAVED && ((uks.used >> k) & 1u); }
_Static_assert(UKS_SAVED == KIT_NSAVED, "ui_kitedit.c");
static uint32_t uks_mask(void) { return uks.used & ((1u << UKS_SAVED) - 1u); }
static void uks_name(uint32_t k, char *b)        /* (ui_kitedit.c) the name, 0-terminated */
{
    memcpy(b, uks.r[k % UKS_N].name, 12);
    b[12] = 0;
}

/* the object's bytes -> RAM: the kits as flash holds them, none when it holds something else */
static void uks_check(int len)
{
    if (len != (int)sizeof uks || uks.magic != UKS_MAGIC || uks.ver != 1u || uks.n != UKS_N)
        memset(&uks, 0, sizeof uks);
    uks.used &= (1u << UKS_N) - 1u;
}

static int uks_write(void)                       /* 0 ok, 2 flash error, 3 no flash (kept in RAM) */
{
    uks.magic = UKS_MAGIC;
    uks.ver = 1;
    uks.n = UKS_N;
#if FELUCCA_FLASH
    if (flash_ok)
        return st_save(UKS_OBJ, &uks, sizeof uks) ? 2 : 0;
#endif
    return 3;
}

static void uks_boot(void)                       /* persist_boot (up_boot): the kits, and the working kit back */
{
    memset(&uks, 0, sizeof uks);
#if FELUCCA_FLASH
    if (flash_ok)
        uks_check(st_load(UKS_OBJ, &uks, sizeof uks));
#endif
    if ((uks.used >> UKS_SAVED) & 1u)
        uks_apply(&uks.r[UKS_SAVED]);
    else
        uk_ensure();
    uks_gen = dv_ugen;
    uks_moved = 0;
}

/* the working kit -> record k (0..UKS_SAVED - 1) named name: 0 ok, 1 bad slot or name, 2 flash error or the transport
 * runs (nothing written), 3 no flash (kept in RAM) */
static int uks_save(uint32_t k, const char *name)
{
    uks_rec_t old;
    uint32_t used = uks.used, i;
    int rc;
    if (k >= UKS_SAVED || !uks_name_ok(name))
        return 1;
    if (transport_busy())
        return 2;
    uk_ensure();
    old = uks.r[k];
    memset(uks.r[k].name, 0, sizeof uks.r[k].name);
    for (i = 0; i < 12u && name[i]; i++)
        uks.r[k].name[i] = name[i];
    uks_pack(&uks.r[k]);
    uks.used |= 1u << k;
    rc = uks_write();
    if (rc == 2) {
        uks.r[k] = old;
        uks.used = used;
    }
    return rc;
}

/* record k -> the working kit */
static int uks_load(uint32_t k)
{
    if (!uks_valid(k))
        return 1;
    uks_apply(&uks.r[k]);
    return 0;
}

static int uks_erase(uint32_t k)                 /* 0 ok, 1 none there, 2 flash error or the transport runs, 3 no flash */
{
    uks_rec_t old;
    uint32_t used = uks.used;
    int rc;
    if (!uks_valid(k))
        return 1;
    if (transport_busy())
        return 2;
    old = uks.r[k];
    memset(&uks.r[k], 0, sizeof uks.r[k]);
    uks.used &= ~(1u << k);
    rc = uks_write();
    if (rc == 2) {
        uks.r[k] = old;
        uks.used = used;
    }
    return rc;
}

/* main loop: the working kit, once it has been still for 2 s and the transport has stopped */
static void uks_poll(void)
{
    if (dv_ugen != uks_gen) {                    /* (a number moved) */
        uks_gen = dv_ugen;
        uks_ms = fm1_ms;
        uks_moved = 1;
    }
    if (!uks_moved || (uint32_t)(fm1_ms - uks_ms) < 2000u || transport_busy() || !uk_ready)
        return;
    uks_moved = 0;
    uks_pack(&uks.r[UKS_SAVED]);
    memset(uks.r[UKS_SAVED].name, 0, sizeof uks.r[UKS_SAVED].name);
    uks.used |= 1u << UKS_SAVED;
    uks_write();
}
