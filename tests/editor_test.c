/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments */
/* The firmware editor handler, USB framing and UART recovery against RAM flash.
 * Build with the generated tables and the same flags as hostsim.c. */
static unsigned char host_samples[3][0x14000];
#define SMP_USER_XIP(k) host_samples[k]
#define FELUCCA_OTA 1
#define FELUCCA_FLASH 0
#define FELUCCA_VERSION "TEST"
#define FELUCCA_CDC 1                                    /* (as the firmware: MENU > USB SERIAL switches the console) */
#define main hostsim_main
#include "hostsim.c"
#undef main
#define MENU_N (32u + FELUCCA_CPU2)                  /* 1.6.1 (core.h FELUCCA_CPU2, the default): 2ND CORE, id 32 */

static uint32_t host_progress = 1, host_erases, host_writes;
static uint8_t host_wire[4096];
static uint32_t host_wire_n;
static void host_drain(void)
{
    while (so_r != so_w) {
        uint32_t p = sx_out_q[so_r++ % SXQ], cin = p & 15u, i;
        uint32_t n = cin == 4u || cin == 7u ? 3u : cin == 6u ? 2u : 1u;
        for (i = 0; i < n && host_wire_n < sizeof host_wire; i++)
            host_wire[host_wire_n++] = (uint8_t)(p >> (8u * (i + 1u)));
    }
}
static uint32_t ota_now_ms(void) { return fm1_ms; }
static void ota_idle(void) { host_drain(); fm1_ms++; }
static void fm1_wdt_feed(void)
{
    fm1_ms++;
    if (host_progress && transport_req == 2u) { seq_stop(); transport_req = 0; }
}
static void fm1_irq_off(void) {}
static void fm1_irq_on(void) {}
static int32_t fm1_enc_take(uint32_t e) { (void)e; return 0; }
static void lcd_sync(void) {}
static void lcd_power(uint32_t s) { (void)s; }   /* (MENU > SCREEN OFF: lcd.c) */
static void lcd_wake_now(void) {}
static void lcd_blit(uint32_t x, uint32_t y, uint32_t w, uint32_t h, const uint16_t *p)
{ (void)x; (void)y; (void)w; (void)h; (void)p; }
#include "../firmware/src/gfx.c"
#include "../firmware/src/panel.c"
#include "../firmware/src/ui.c"
#include "../firmware/src/menu_items.c"
static void panel_setup(void) {}
#include "../firmware/src/upreset.c"
#include "../firmware/src/project.c"

static uint32_t flash_ok = 1;
static void audio_silence(void) {}
static void fl_inval(uint32_t off, uint32_t n) { (void)off; (void)n; }
static uint8_t *host_flash_ptr(uint32_t off) { return &host_samples[0][0] + off - SMP_USER_BASE; }
static int fl_erase4k(uint32_t off, uint32_t *took)
{
    memset(host_flash_ptr(off), 0xFF, 4096); *took = 0; host_erases++; return 0;
}
static int fl_write(uint32_t off, const void *p, uint32_t n)
{
    memcpy(host_flash_ptr(off), p, n); host_writes++; return 0;
}
static int st_read(uint32_t off, void *p, uint32_t n) { (void)off; (void)p; (void)n; return -1; }
static int st_prog(uint32_t off, const void *p, uint32_t n) { (void)off; (void)p; (void)n; return -1; }
static int st_erase(uint32_t off) { (void)off; return -1; }
#include "../firmware/src/storage.c"
#include "../firmware/src/editor.c"

static int check(const char *what, int ok)
{
    printf("editor: %-70s %s\n", what, ok ? "ok" : "FAIL");
    return !ok;
}
static void reset(void)
{
    uint32_t t, i;
    memset(&song, 0, sizeof song); memset(trk, 0, sizeof trk);
    memset(&chain, 0, sizeof chain); chain_defaults(&chain_config);
    memset(&ed_w, 0, sizeof ed_w); memset(&ui, 0, sizeof ui);
    memset(&favorites, 0, sizeof favorites); memset(&settings, 0, sizeof settings); settings_init();
    memset(proj_slot, 0, sizeof proj_slot); memset(up_bank, 0, sizeof up_bank);
    memset(&um, 0, sizeof um); memset(usr_nz, 0, sizeof usr_nz);
    host_progress = 1; host_erases = host_writes = host_wire_n = 0;
    transport_req = panic_req = 0; sx_ready = sx_collect = sx_busy = 0;
    so_r = so_w = mi_r = mi_w = 0; midi_in_overflow = 0; usb.config = 1;
    for (i = 0; i < G_COUNT; i++) song.g[i] = GP[i].def;
    for (t = 0; t < NTRK; t++) {
        track_defaults(&trk[t]); set_engine_of(&trk[t], 0); apply_preset_to(&trk[t], 0);
        trk[t].engine = trk[t].eng_req; track_defaults_steps(&trk[t]);
    }
}
static uint32_t request(uint32_t cmd, const uint8_t *a, uint32_t n)
{
    uint32_t i;
    host_wire_n = 0; ota_frame_done();
    sysex_byte(0xF0); sysex_byte(ED_HDR0); sysex_byte(ED_HDR1); sysex_byte(ED_HDR2); sysex_byte((uint8_t)cmd);
    for (i = 0; i < n; i++) sysex_byte(a[i]);
    sysex_byte(0xF7); ed_service(); host_drain();
    return host_wire_n;
}
static uint32_t pack7(const uint8_t *p, uint32_t n, uint8_t *a)
{
    uint32_t o = 0, i;
    while (n) {
        uint32_t k = n > 7u ? 7u : n, m = o++;
        a[m] = 0;
        for (i = 0; i < k; i++, n--) { a[m] |= (*p >> 7) << i; a[o++] = *p++ & 127u; }
    }
    return o;
}

/* 1.1 parameter locks over MOTION (64): ops 5 (set a lock), 6 (clear a step's locks, 127 every step's), 7 (the query
 * with the kinds); the query and ops 1..4 reply as before (a lock's id without bit 7) */
static int motion_locks(void)
{
    int bad = 0;
    uint32_t n;
    uint8_t a[8];
    reset();
    motion_clear(&trk[1]);
    a[0] = 1; a[1] = 3; a[2] = 2; a[3] = P_REV; a[4] = (uint8_t)((60 + 8192) & 127); a[5] = (uint8_t)((60 + 8192) >> 7);
    request(ED_MOTION, a, 6);                                           /* an automation event, step 2 */
    a[1] = 5; a[2] = 5; a[4] = (uint8_t)((100 + 8192) & 127); a[5] = (uint8_t)((100 + 8192) >> 7);
    n = request(ED_MOTION, a, 6);                                       /* a lock, step 5 */
    bad += check("MOTION op 5 sets a lock: rc 0, two records, then their kinds 0 1",
        host_wire[6] == 0 && host_wire[8] == 2 && host_wire[10] == 2 && host_wire[11] == P_REV &&
        host_wire[14] == 5 && host_wire[15] == P_REV && n == 5u + 5u + 2u * 4u + 2u + 1u &&
        host_wire[18] == 0 && host_wire[19] == 1 && motion_lock_count(&trk[1]) == 1u);
    n = request(ED_MOTION, a, 1);
    bad += check("MOTION query as before 1.1: no kinds, the lock's id without bit 7", n == 5u + 5u + 2u * 4u + 1u &&
        host_wire[15] == P_REV);
    a[1] = 7; n = request(ED_MOTION, a, 2);
    bad += check("MOTION op 7: the query with the kinds", n == 5u + 5u + 2u * 4u + 2u + 1u && host_wire[19] == 1);
    a[1] = 5; a[2] = 64; n = request(ED_MOTION, a, 6);
    bad += check("MOTION op 5 refuses step 64 (rc 1)", host_wire[6] == 1);
    a[1] = 6; a[2] = 2; request(ED_MOTION, a, 3);
    bad += check("MOTION op 6 on step 2: its automation event stays", host_wire[6] == 0 && host_wire[8] == 2);
    a[2] = 127; request(ED_MOTION, a, 3);
    bad += check("MOTION op 6, 127: every lock goes, the automation stays", host_wire[6] == 0 && host_wire[8] == 1 &&
        host_wire[14] == 0 && !motion_lock_count(&trk[1]));
    motion_clear(&trk[1]);
    /* 1.2 (INFO 41 01 00 01): 128 records; ops 1..7 reply as before (max 64, at most 64 records), op 8 all of them */
    {
        uint32_t i, ok = 1;
        for (i = 0; i < MOTION_MAX - 1u; i++)            /* 127 on track 2: two ids a step */
            ok &= !motion_set_event(&trk[1], i % NSTEP, i < NSTEP ? P_REV : P_DLY, (int16_t)(i % 100u));
        a[1] = 5; a[2] = 63; a[3] = P_PAN; a[4] = (uint8_t)((-3 + 8192) & 127); a[5] = (uint8_t)((-3 + 8192) >> 7);
        n = request(ED_MOTION, a, 6);                   /* the 128th: a lock of PAN -3 */
        ok &= host_wire[6] == 0 && motion.count == MOTION_MAX && host_wire[8] == 64 && host_wire[9] == 64 &&
              n == 5u + 5u + 64u * 4u + 64u + 1u;
        bad += check("MOTION 1.2: 128 records on one track; op 5's reply as before: max 64, its first 64 listed", ok);
        a[1] = 3; a[2] = 0; a[3] = P_CHOR; a[4] = 0; a[5] = 64;
        n = request(ED_MOTION, a, 6);
        bad += check("  the 129th: rc 2 (full)", host_wire[6] == 2 && motion.count == MOTION_MAX);
        a[1] = 8; n = request(ED_MOTION, a, 2);
        ok = n == 5u + 7u + 128u * 4u + 128u + 1u && host_wire[8] == 0 && host_wire[9] == 1 && host_wire[10] == 0 &&
             host_wire[11] == 1 && host_wire[12 + 127u * 4u] == 63 && host_wire[13 + 127u * 4u] == P_PAN &&
             ed_rv(&host_wire[14 + 127u * 4u]) == -3 && host_wire[12 + 128u * 4u + 127u] == 1 &&
             host_wire[12 + 128u * 4u] == 0 && n <= sizeof ed_out;
        bad += check("  op 8: count and max as two 7-bit bytes (128), all 128 records, then their kinds", ok);
        a[1] = 8; a[2] = 0;
        bad += check("  op 8 with a further byte: no reply", !request(ED_MOTION, a, 3));
        motion_clear(&trk[1]);
    }
    return bad;
}

static int preferences(void)
{
    int bad = 0;
    uint8_t a[4] = {0, 7, 0, 0};
    reset();
    uint32_t n = request(ED_INFO, a, 0);
    uint32_t e = n - 15u;                                  /* (1.5.5: 4B 01 NCOND, 1.6: 45 01 5, tablet: 58 01 caps, 59 01, 5A 01, below) */
    bad += check("INFO explicitly tags display capabilities after SONG without changing command 33",
        ED_SONG == 33 && ED_UI_STATE == 34 && ED_FAV_SET == 38 &&
        host_wire[e - 47] == CHAIN_ROWS && host_wire[e - 46] == 0x55 &&
        host_wire[e - 45] == 1 && host_wire[e - 44] == 9 &&
        host_wire[e - 43] == 0x4d && host_wire[e - 42] == 1 &&
        host_wire[e - 41] == 64u && host_wire[e - 40] == 1 &&   /* (64 kept: 41 01 says 128) */
        host_wire[e - 39] == 0x42 && host_wire[e - 38] == 1 && host_wire[e - 37] == 3 &&
        host_wire[e - 36] == 0x46 && host_wire[e - 35] == 1 && host_wire[e - 34] == FM6_NFACTORY &&
        host_wire[e - 33] == 0 &&                        /* (no bank since 1.0.3) */
        host_wire[e - 32] == 0x53 && host_wire[e - 31] == 1 && host_wire[e - 30] == 3 &&
        host_wire[e - 29] == 0x50 && host_wire[e - 28] == 1 && host_wire[e - 27] == 3 &&   /* FM6 v2: no bank, preset patches */
        host_wire[e - 26] == 0x4E && host_wire[e - 25] == 1 && host_wire[e - 24] == MENU_N &&   /* MENU settings: 33 items (1.6.1: 2ND CORE; a FELUCCA_CPU2=0 build 32) */
        host_wire[e - 23] == 0x52 && host_wire[e - 22] == 1 && host_wire[e - 21] == 4 &&   /* RATCH */
        host_wire[e - 20] == 0x4C && host_wire[e - 19] == 1 && host_wire[e - 18] == 1 &&   /* 1.1 parameter locks */
        host_wire[e - 17] == 0x41 && host_wire[e - 16] == 1 && host_wire[e - 15] == 0 && host_wire[e - 14] == 1 &&   /* 1.2: 128 */
        host_wire[e - 13] == 0x54 && host_wire[e - 12] == 1 && host_wire[e - 11] == NUDGE_DIV &&   /* 1.2: NUDGE */
        host_wire[e - 10] == 0x57 && host_wire[e - 9] == 1 && host_wire[e - 8] == NTRK &&   /* 1.2: SONG lanes */
        host_wire[e - 7] == 0x56 && host_wire[e - 6] == 1 && host_wire[e - 5] == 32 &&   /* 1.4.1: FM6 voice bank */
        host_wire[e - 4] == 0x43 && host_wire[e - 3] == 1 && host_wire[e - 2] == ML_N);   /* 1.5: MIDI LEARN */
    bad += check("INFO 1.5.5: 4B 01 11, a step's condition after its nudge",
        host_wire[n - 16] == 0x4B && host_wire[n - 15] == 1 && host_wire[n - 14] == NCOND);
    bad += check("INFO 1.6: 45 01 5, CUSTOM's colours, before the tablet tag",
        host_wire[n - 13] == 0x45 && host_wire[n - 12] == 1 && host_wire[n - 11] == 5);
    request(ED_UI_SET, a, 2);
    bad += check("UI_SET updates the actual palette and reports RAM-only saving",
        host_wire[5] == 3 && settings.palette == 7 && T_BG == UI_PALETTES[7].c1);
    a[1] = NPALETTES; request(ED_UI_SET, a, 2);
    bad += check("out-of-range palette leaves the display unchanged", host_wire[5] == 1 && settings.palette == 7);
    a[0] = 1; a[1] = 1; request(ED_UI_SET, a, 2);
    bad += check("the retired font weight is not supported (rc 2), UI_STATE says 127",
        host_wire[5] == 2 && host_wire[8] == 9 && host_wire[10] == 127);
    a[0] = 2; request(ED_UI_SET, a, 2);
    bad += check("unsupported preference is reported without applying it", host_wire[5] == 2);
    a[0] = ENGI_DRUM; a[1] = 0; a[2] = 64; a[3] = 1;
    request(ED_FAV_SET, a, 4);
    bad += check("FAV_SET marks DRUM as a normal engine", host_wire[5] == 3 && favorite_has(ENGI_DRUM, 0));
    request(ED_FAV_GET, a, 4);
    bad += check("FAV_GET reads the bounded favorite range", host_wire[5] == 0 && host_wire[10] == 1);
    a[0] = NENGINES; a[1] = 15; request(ED_FAV_SET, a, 4);
    bad += check("empty user slot cannot be starred", host_wire[5] == 1 && !favorite_has(NENGINES, 15));
    up_store(15, "Saved"); request(ED_FAV_SET, a, 4);
    bad += check("saved user slot can be starred without changing its sound", host_wire[5] == 3 && favorite_has(NENGINES, 15));
    a[3] = 32; request(ED_FAV_GET, a, 4);
    bad += check("favorite range cannot cross the end of user slots", host_wire[5] == 1);
    request(ED_FAV_SET, a, 3);
    bad += check("short favorite writes return an error without reading absent bytes", host_wire[5] == 1);
    bad += check("UI_STATE rejects unexpected request bytes", request(ED_UI_STATE, a, 1) == 0);
    a[0] = 0; request(ED_SONG, a, 1);
    bad += check("SONG still responds through its original command", host_wire_n > 6 && host_wire[4] == 33 && host_wire[5] == 0);
    return bad;
}

static int framing(void)
{
    uint32_t i, bad = 0;
    static const uint8_t rt[] = {0xF0, 0x7D, 0xF8, 0x46, 0xFE, 0x4C, ED_PING, 0xFF, 0xF7};
    static const uint8_t aborted[] = {0xF0, 0x7D, 0x46, 0x4C, ED_SET, 0, P_LEVEL, 0x90, 0, 64, 0xF7};
    reset();
    for (i = 0; i < sizeof rt; i++) sysex_byte(rt[i]);
    ed_service(); host_drain();
    bad += check("realtime bytes interleaved in SysEx do not enter the editor frame",
                 host_wire_n == 7u && host_wire[4] == ED_PING && host_wire[5] == 0);
    ota_frame_done(); host_wire_n = 0;
    for (i = 0; i < sizeof aborted; i++) sysex_byte(aborted[i]);
    ed_service(); host_drain();
    bad += check("a non-realtime status aborts SysEx without changing parameters",
                 !sx_ready && !host_wire_n && TSEL->p[P_LEVEL] == TP[P_LEVEL].def);
    bad += check("a valid request works after an aborted frame", request(ED_PING, 0, 0) == 7u);
    ota_frame_done();
    midi_in_event(0x467DF004u);                          /* F0 7D 46 */
    midi_in_event(0x00004C04u);                          /* unfinished SysEx */
    midi_in_event(0x643C9009u);
    sysex_byte(0xF7);
    bad += check("a channel event in another USB packet aborts an unfinished SysEx",
                 !sx_ready && mi_w == 1u && midi_in_q[0] == 0x643C9009u);
    midi_in_event(0x643C8009u);                          /* wrong CIN */
    midi_in_event(0x643CFF09u);                          /* wrong status */
    midi_in_event(0xFF3C9009u);                          /* not a seven-bit velocity */
    midi_in_event(0x64FF9009u);                          /* not a seven-bit note */
    bad += check("USB channel packets reject mismatched CIN and high data bits", mi_w == 1u);
    midi_in_event(0xFF05C00Cu);                          /* one-byte status: padding is ignored */
    midi_in_event(0xFF07D00Du);
    bad += check("USB program and channel pressure keep their one-byte payload", mi_w == 3u);
    mi_w = UINT32_MAX - 5u; mi_r = mi_w;
    for (i = 0; i < MQ + 8u; i++) midi_in_event(0x643C9009u);
    bad += check("USB MIDI ring stops at capacity across counter wrap", mi_w - mi_r == MQ && midi_in_overflow);
    mi_r = mi_w; midi_in_event(0x643C9009u);
    bad += check("USB rejects new messages until the audio consumer clears overflow", mi_w == mi_r);
    midi_in_overflow = 0; midi_in_event(0x643C9009u);
    bad += check("USB resumes after the audio consumer clears overflow", mi_w - mi_r == 1u);
    return bad;
}

static int uart_recovery(void)
{
    uint32_t i;
    int bad = 0;
    reset();
    um_byte(0x90); um_byte(50);
    for (i = 0; i < UM_RING; i++) um_ring[i] = 0;
    um_ring[126] = 0x90; um_ring[127] = 72; um_ring[0] = 99;
    uart_midi_take(UM_RING + 1u);
    bad += check("UART DMA overrun never combines a stale partial note with new data",
                 !mi_w && midi_in_overflow && um.drops == 2u && um.bytes == UM_RING && !um.pend);
    midi_in_overflow = 0; um_byte(0x90); um_byte(72); um_byte(99);
    bad += check("UART receives a complete fresh note after DMA recovery",
                 mi_w == 1u && midi_in_q[0] == 0x63489009u);
    reset();
    um_byte(0x90); um_byte(50);
    for (i = 0; i < UM_RING; i++) um_ring[i] = 60;
    uart_midi_take(UM_RING + 2u);
    bad += check("UART discards running-status data after lost bytes until a new status",
                 !mi_w && midi_in_overflow && um.drops == 2u && !um.st && !um.got);
    midi_in_overflow = 0;
    um_byte(0x91); um_byte(70); um_byte(100);
    bad += check("UART recovers immediately on a complete channel message", mi_w == 1u && midi_in_q[0] == 0x64469109u);
    reset(); mi_w = MQ;
    um_byte(0x90); um_byte(60); um_byte(100);
    bad += check("UART queue overflow latches the same recovery flag as USB", midi_in_overflow && um.drops == 1u && mi_w == MQ);
    mi_r = mi_w; um_byte(61); um_byte(101);
    bad += check("UART rejects a new stream until audio clears overflow", mi_w == mi_r && um.drops == 2u);
    midi_in_overflow = 0; um_byte(62); um_byte(102);
    bad += check("UART resumes valid running status after audio clears overflow",
                 mi_w - mi_r == 1u && midi_in_q[mi_r % MQ] == 0x663E9009u);
    return bad;
}

static int steps(void)
{
    uint8_t a[80] = {0, 1, 60, 0, 0, 0, ST_NOTE, SF_ACCENT, 100, 0x12, 0x02, 1};
    step_t before;
    uint32_t n, ok = 1;
    int bad = 0;
    reset();
    TSEL->step[0].hit = TSEL->step[0].acc = 0x80;
    bad += check("legacy 8-byte step writes preserve lane data",
                 request(ED_STEP_SET, a, 9) == 22u && TSEL->step[0].note[0] == 60 &&
                 TSEL->step[0].hit == 0x80 && TSEL->step[0].acc == 0x80);
    bad += check("full grid step writes preserve high lane bits and constrain accents",
                 request(ED_STEP_SET, a, 12) == 22u && TSEL->step[0].hit == 0x92 && TSEL->step[0].acc == 2);
    before = TSEL->step[0]; a[2] = 71;
    for (n = 2; n <= sizeof a; n++) {
        if (n == 9u || n == 12u || n == 13u) continue;   /* (14: a[13], the ratchet, 0 is refused) */
        ok &= !request(ED_STEP_SET, a, n) && !memcmp(&before, &TSEL->step[0], sizeof before);
    }
    bad += check("partial or oversized step payloads never mutate a valid step", ok);
    a[0] = 1; a[1] = 0; memcpy(a + 2, (const uint8_t[]){1,64,0,0,0,ST_NOTE,0,99}, 8);
    bad += check("TRACK_STEP accepts its legacy payload on an unselected track",
                 request(ED_TRACK_STEP, a, 10) == 23u && trk[1].step[0].note[0] == 64 && song.sel == 0);
    before = trk[1].step[0]; a[3] = 65;
    bad += check("TRACK_STEP rejects an incomplete grid extension",
                 !request(ED_TRACK_STEP, a, 11) && !memcmp(&before, &trk[1].step[0], sizeof before));
    /* RATCH (INFO 52 01 04): the hits 1..4 after the chance; the flags byte stays accent | slide both ways */
    memcpy(a, (const uint8_t[]){0, 1, 60, 0, 0, 0, ST_NOTE, SF_ACCENT, 100, 0, 0, 0, 80, 3}, 14);
    n = request(ED_STEP_SET, a, 14);
    bad += check("STEP_SET with the ratchet: x3 kept, replied after the chance, flags without it",
                 n == 22u && step_ratchet(&TSEL->step[0]) == 3u && step_chance(&TSEL->step[0]) == 80u &&
                 host_wire[n - 4] == 3 && host_wire[n - 5] == 80 && host_wire[n - 3] == 8 && host_wire[12] == SF_ACCENT);
    a[7] = SF_SLIDE; n = request(ED_STEP_SET, a, 13);
    ok = n == 22u && step_ratchet(&TSEL->step[0]) == 3u && TSEL->step[0].flags == (SF_SLIDE | 2u << SF_RATCH_SH);
    n = request(ED_STEP_SET, a, 9);
    bad += check("STEP_SET without the ratchet (an older editor) keeps the step's own",
                 ok && n == 22u && step_ratchet(&TSEL->step[0]) == 3u);
    before = TSEL->step[0]; ok = 1;
    for (n = 0; n < 8u; n++) {
        a[13] = (uint8_t)(n < 4u ? 0u : 5u + n);
        ok &= !request(ED_STEP_SET, a, 14) && !memcmp(&before, &TSEL->step[0], sizeof before);
    }
    bad += check("STEP_SET refuses a ratchet outside 1..4 and leaves the step", ok);
    memcpy(a, (const uint8_t[]){1, 2, 1, 64, 0, 0, 0, ST_NOTE, 0, 99, 0, 0, 0, 100, 4}, 15);
    n = request(ED_TRACK_STEP, a, 15);
    ok = n == 23u && step_ratchet(&trk[1].step[2]) == 4u && host_wire[n - 4] == 4;
    a[14] = 1; n = request(ED_TRACK_STEP, a, 15);
    bad += check("TRACK_STEP sets the ratchet of any track (x4, then back to x1)",
                 ok && n == 23u && step_ratchet(&trk[1].step[2]) == 1u && !(trk[1].step[2].flags & SF_RATCH));
    /* NUDGE (1.2, INFO 54 01 16): the nudge + 8 after the ratchet, both ways; a write without it keeps the step's */
    memcpy(a, (const uint8_t[]){0, 1, 60, 0, 0, 0, ST_NOTE, SF_ACCENT, 100, 0, 0, 0, 80, 1, 8 - 5}, 15);
    n = request(ED_STEP_SET, a, 15);
    ok = n == 22u && step_nudge(&TSEL->step[0]) == -5 && host_wire[n - 3] == 3 && host_wire[12] == SF_ACCENT &&
         (TSEL->step[0].flags & (SF_ACCENT | SF_SLIDE)) == SF_ACCENT;
    a[7] = SF_SLIDE; n = request(ED_STEP_SET, a, 14);
    ok &= n == 22u && step_nudge(&TSEL->step[0]) == -5 && host_wire[12] == SF_SLIDE;
    n = request(ED_STEP_SET, a, 9);
    ok &= step_nudge(&TSEL->step[0]) == -5;
    bad += check("STEP_SET with the nudge (-5): kept, replied + 8 after the ratchet; a write without it keeps it", ok);
    before = TSEL->step[0];
    a[14] = 16;
    bad += check("STEP_SET refuses a nudge byte above 15 and leaves the step",
                 !request(ED_STEP_SET, a, 15) && !memcmp(&before, &TSEL->step[0], sizeof before));
    memcpy(a, (const uint8_t[]){2, 7, 1, 64, 0, 0, 0, ST_NOTE, 0, 99, 0, 0, 0, 100, 1, 15}, 16);
    n = request(ED_TRACK_STEP, a, 16);
    bad += check("TRACK_STEP sets the nudge of any track (+7)", n == 23u && step_nudge(&trk[2].step[7]) == 7 &&
                 host_wire[n - 3] == 15);
    /* 1.5.5 (#209, INFO 4B 01 11): the condition after the nudge (0 none, 1..11), replied with the chance 100 before
     * it; a write without it and a chance of 100 keeps the condition (an editor that does not know them), another
     * chance replaces it */
    memcpy(a, (const uint8_t[]){0, 1, 60, 0, 0, 0, ST_NOTE, 0, 100, 0, 0, 0, 100, 1, 8, 6}, 16);
    n = request(ED_STEP_SET, a, 16);
    ok = n == 22u && step_cond(&TSEL->step[0]) == 6u && host_wire[n - 2] == 6 && host_wire[n - 5] == 100;
    n = request(ED_STEP_SET, a, 13);                  /* (chance 100, no condition byte) */
    ok &= n == 22u && step_cond(&TSEL->step[0]) == 6u;
    a[12] = 40; n = request(ED_STEP_SET, a, 13);
    ok &= step_chance(&TSEL->step[0]) == 40u && !step_cond(&TSEL->step[0]) && host_wire[n - 2] == 0;
    a[12] = 100; a[15] = 10; n = request(ED_STEP_SET, a, 16);
    ok &= step_cond(&TSEL->step[0]) == COND_FILL;
    a[15] = 0; n = request(ED_STEP_SET, a, 16);
    ok &= !TSEL->step[0].probability;
    bad += check("STEP_SET with the condition (1:4, FILL, none); without it a chance of 100 keeps it, 40 % replaces it", ok);
    before = TSEL->step[0];
    a[15] = NCOND + 1u;
    bad += check("STEP_SET refuses a condition byte above 11 and leaves the step",
                 !request(ED_STEP_SET, a, 16) && !memcmp(&before, &TSEL->step[0], sizeof before));
    memcpy(a, (const uint8_t[]){3, 9, 1, 64, 0, 0, 0, ST_NOTE, 0, 99, 0, 0, 0, 100, 1, 8, 11}, 17);
    n = request(ED_TRACK_STEP, a, 17);
    bad += check("TRACK_STEP sets the condition of any track (!FILL)", n == 23u && step_cond(&trk[3].step[9]) == COND_NFILL &&
                 host_wire[n - 2] == 11);
    return bad;
}

static int samples(void)
{
    uint8_t a[640] = {0}, data[257], short_group[] = {0, 0, 4, 0, 1};
    uint32_t n, i;
    int bad = 0;
    smp_user_hdr_t h;
    reset(); memset(host_samples, 0, sizeof host_samples);
    for (i = 0; i < sizeof data; i++) data[i] = (uint8_t)(i * 37u);
    song.playing = 1; host_progress = 0;
    bad += check("sample erase waits for STOP and refuses a stalled audio ISR",
                 request(ED_SMP_BEGIN, a, 1) == 8u && host_wire[6] != 0 && !host_erases && song.playing);
    host_progress = 1;
    bad += check("sample erase stops transport before touching flash",
                 request(ED_SMP_BEGIN, a, 1) == 8u && !host_wire[6] && host_erases == 1 && !song.playing);
    a[0] = 0; a[1] = 0; a[2] = 4; a[3] = 0;
    n = pack7(data, 257, a + 4) + 4u;
    bad += check("257 decoded sample bytes are rejected without a truncated write",
                 request(ED_SMP_WRITE, a, n) == 11u && host_wire[9] == 1 && !host_writes);
    bad += check("a dangling packed-data mask is rejected",
                 request(ED_SMP_WRITE, short_group, sizeof short_group) == 11u && host_wire[9] == 1 && !host_writes);
    n = pack7(data, 256, a + 4) + 4u;
    transport_req = 1;
    bad += check("sample writes cancel a pending PLAY before flash access",
                 request(ED_SMP_WRITE, a, n) == 11u && !host_wire[9] && transport_req != 1u && host_writes == 1);
    memset(&h, 0, sizeof h); h.magic = SMP_USER_MAGIC; h.version = 1; h.nz = 1;
    h.data_len = 256; h.crc = st_crc32(data, 256); h.zone[0].n = 512; h.zone[0].le = 511;
    h.zone[0].rate = 65536; h.zone[0].hi = 127;
    a[0] = 0; n = pack7((const uint8_t *)&h, sizeof h, a + 1) + 1u;
    a[n] = 0; a[n + 1u] = 0;
    bad += check("an oversized sample header is rejected without programming flash",
                 request(ED_SMP_END, a, n + 2u) == 8u && host_wire[6] == 1 && host_writes == 1);
    bad += check("complete sample header and CRC publish a valid slot",
                 request(ED_SMP_END, a, n) == 8u && !host_wire[6] && usr_nz[0] == 1 && host_writes == 2);
    bad += check("repeated END of the same published header does not rewrite live zones",
                 request(ED_SMP_END, a, n) == 8u && !host_wire[6] && host_writes == 2);
    h.zone[0].rate = 131072;
    n = pack7((const uint8_t *)&h, sizeof h, a + 1) + 1u;
    bad += check("END cannot change published sample zones without BEGIN",
                 request(ED_SMP_END, a, n) == 8u && host_wire[6] == 2 && host_writes == 2 &&
                 usr_zone[0][0].rate == 65536u);
    song.playing = 1; host_progress = 0; a[0] = 0; a[1] = 0;
    bad += check("user-preset STORE does not mutate RAM when audio cannot stop",
                 request(ED_UP_STORE, a, 2) == 8u && host_wire[6] == 2 && !up_used(0));
    bad += check("user-preset ERASE reports failure when audio cannot stop",
                 request(ED_UP_ERASE, a, 1) == 8u && host_wire[6] == 2);
    return bad;
}

static int song_protocol(void)
{
    uint8_t a[] = {1, 1, 0, 2};
    chain_config_t before;
    int bad = 0;
    reset();
    bad += check("SONG sets and queries the complete chain without changing selection",
                 request(ED_SONG, a, sizeof a) == 14u && !host_wire[6] && chain_config.count == 1 && song.sel == 0);
    before = chain_config; a[3] = 0;
    bad += check("SONG invalid repeats leave the chain unchanged",
                 request(ED_SONG, a, sizeof a) == 14u && host_wire[6] == 1 && !memcmp(&before, &chain_config, sizeof before));
    a[3] = 2; chain.armed = 1;
    bad += check("SONG cannot replace a chain while its start is pending",
                 request(ED_SONG, a, sizeof a) == 14u && host_wire[6] == 2 && !memcmp(&before, &chain_config, sizeof before));
    chain.armed = 0; a[0] = 2;
    bad += check("SONG PLAY refuses extra argument bytes", !request(ED_SONG, a, 2) && !transport_req);
    {   /* 1.2 (`57 01 04`): sections with a slot per track, ops 4..7; the v6 ops see each section's clock lane */
        static const uint8_t set[] = {5, 2, 0, 1, CHAIN_SILENT, 0, 3, CHAIN_SILENT, CHAIN_SILENT, CHAIN_SILENT, CHAIN_SILENT, 1};
        static const uint8_t q4[] = {4}, q0[] = {0}, bad5[] = {5, 1, 0, 0, 5, 0, 1}, old4[] = {1, 1, CHAIN_SILENT, 1};
        static const uint8_t info[] = {0};
        uint32_t n, i, tag = 0;
        reset();
        n = request(ED_SONG, set, sizeof set);
        bad += check("SONG op 5 sets sections (T1 A, T2 B, T3 -, T4 A x3; all - x1), the reply in lanes",
                     n == 5u + 6u + 2u * 5u + 1u && host_wire[5] == 5 && !host_wire[6] && host_wire[7] == 2 &&
                     !memcmp(host_wire + 11, set + 2, 10) && chain_config.count == 2 &&
                     !memcmp(&chain_config.row[0], &(chain_row_t){{0, 1, CHAIN_SILENT, 0}, 3}, sizeof(chain_row_t)) &&
                     chain_config.row[1].slot[0] == CHAIN_SILENT && chain_config.row[1].repeat == 1);
        n = request(ED_SONG, q4, 1);
        bad += check("SONG op 4 queries them as set", n == 22u && host_wire[5] == 4 && !memcmp(host_wire + 11, set + 2, 10));
        n = request(ED_SONG, q0, 1);
        bad += check("SONG op 0 (v6 editors): a row per section, its clock lane's slot (T1 A; all - : A)",
                     n == 16u && host_wire[11] == 0 && host_wire[12] == 3 && host_wire[13] == 0 && host_wire[14] == 1);
        bad += check("SONG op 5: a slot past - (5) refused, the sections kept",
                     request(ED_SONG, bad5, sizeof bad5) == 22u && host_wire[6] == 1 && chain_config.count == 2);
        bad += check("SONG op 1 (v6): no - in a row of one slot", request(ED_SONG, old4, sizeof old4) == 16u &&
                     host_wire[6] == 1 && chain_config.count == 2);
        chain.armed = 1;
        bad += check("SONG op 5 waits for a pending start (rc 2)", request(ED_SONG, set, sizeof set) == 22u && host_wire[6] == 2);
        chain.armed = 0;
        n = request(ED_INFO, info, 0);
        for (i = 5; i + 2u < n; i++)
            if (host_wire[i] == 0x57 && host_wire[i + 1u] == 1 && host_wire[i + 2u] == NTRK) tag = 1;
        bad += check("INFO says the lanes: 57 01 04", tag);
        {
            uint8_t q[4] = {0, P_SQNT, 0, 0};
            trk[0].p[P_SQNT] = 1; chain.running = 1;
            request(ED_SET, q, 4);
            chain.running = 0;
            bad += check("SET of QUANTIZE waits while a song plays (its slots set it)", trk[0].p[P_SQNT] == 1);
        }
    }
    return bad;
}

static int malformed_saves(void)
{
    static const uint8_t slot[] = {1, 4}, name[] = {0, 'X', 0, 'Y'};
    const uint8_t save[] = {1, 0};
    project_store_t old;
    int bad = 0;
    reset();
    bad += check("PROJECT refuses an invalid slot instead of wrapping to slot 0",
                 !request(ED_PROJECT, slot, sizeof slot) && !project_used(0));
    bad += check("UP_STORE rejects bytes after its name terminator without saving",
                 request(ED_UP_STORE, name, sizeof name) == 8u && host_wire[6] == 1 && !up_used(0));
    bad += check("a successful PROJECT save confirms its slot", request(ED_PROJECT, save, sizeof save) == 9u && project_used(0));
    old = proj_slot[0];
    TSEL->p[P_LEVEL] = 21; song.playing = 1; host_progress = 0;
    bad += check("PROJECT never confirms an old used slot when STOP timed out",
                 !request(ED_PROJECT, save, sizeof save) && !memcmp(&old, &proj_slot[0], sizeof old));
    return bad;
}

/* FM6 patches (cmds 68..71): a track's own patch, the retired bank ("no bank"), the factory patches, the user presets'
 * patches (target 3), malformed frames */
static int fm6_patches(void)
{
    int bad = 0;
    uint8_t a[2 + FM6_PACKED], pk[FM6_PACKED];
    uint32_t n, i;
    reset();
    upf_empty();
    a[0] = ED_FM6_FACTORY; a[1] = 3;
    n = request(ED_FM6_GET, a, 2);
    bad += check("FM6_GET factory 4: the packed record", n == 5u + 3u + FM6_PACKED + 1u && host_wire[7] == 0 &&
                 !memcmp(host_wire + 8, FM6_FACTORY[3], FM6_PACKED));
    memcpy(pk, FM6_FACTORY[3], FM6_PACKED);
    memcpy(pk + 118, "MY PATCH  ", 10);
    trk[2].eng_req = ENGI_FM6;
    trk[2].p[P_E7] = 3;
    a[0] = ED_FM6_TRACK; a[1] = 2; memcpy(a + 2, pk, FM6_PACKED);
    n = request(ED_FM6_PUT, a, sizeof a);
    bad += check("FM6_PUT track 3: rc 0, the track's patch, SLOT OWN (not F4: the name differs)", n == 9u &&
                 host_wire[7] == 0 && !memcmp(fm6_patch[2] + FP_NAME, "MY PATCH  ", 10) &&
                 trk[2].p[P_E7] == FM6_OWN && fm6_slot[2] == FM6_OWN);
    fm6_poll();
    bad += check("  .. the main loop keeps it", !memcmp(fm6_patch[2] + FP_NAME, "MY PATCH  ", 10));
    a[1] = 2;
    n = request(ED_FM6_GET, a, 2);
    bad += check("FM6_GET track 3: as sent", host_wire[7] == 0 && !memcmp(host_wire + 8, pk, FM6_PACKED));
    a[0] = ED_FM6_TRACK; a[1] = 2; memcpy(a + 2, FM6_FACTORY[5], FM6_PACKED);
    request(ED_FM6_PUT, a, sizeof a);
    bad += check("FM6_PUT of a factory patch unchanged: SLOT shows it (F6)", trk[2].p[P_E7] == 5 && fm6_slot[2] == 5u);
    trk[2].p[P_E7] = FM6_OWN;                            /* (back to MY PATCH for the SLOT trip below) */
    a[0] = ED_FM6_TRACK; a[1] = 2; memcpy(a + 2, pk, FM6_PACKED);
    request(ED_FM6_PUT, a, sizeof a);
    trk[2].p[P_E7] = 1;
    fm6_poll();
    bad += check("SLOT OWN -> F2 loads the factory patch", !memcmp(fm6_patch[2] + FP_NAME, FM6_FACTORY[1] + 118, 10));
    trk[2].p[P_E7] = 6;
    fm6_poll();
    trk[2].p[P_E7] = FM6_OWN;
    fm6_poll();
    bad += check("  .. and back to OWN brings the own patch back", !memcmp(fm6_patch[2] + FP_NAME, "MY PATCH  ", 10) &&
                 fm6_slot[2] == FM6_OWN);
    trk[2].p[P_E7] = 20;                                 /* (a 1.0.2 B slot that escaped a clamp) */
    fm6_poll();
    bad += check("a SLOT past OWN is OWN: the patch stays, nothing reloads", trk[2].p[P_E7] == FM6_OWN &&
                 !memcmp(fm6_patch[2] + FP_NAME, "MY PATCH  ", 10));
    for (i = 0; i < 3u; i++) {                           /* the bank: GET, PUT, ERASE answer "no bank" (3) */
        a[0] = ED_FM6_BANK; a[1] = 4; memcpy(a + 2, pk, FM6_PACKED);
        if (i < 2u)
            request(i ? ED_FM6_PUT : ED_FM6_GET, a, i ? sizeof a : 2u);
        else {
            a[0] = 4;
            request(ED_FM6_ERASE, a, 1);
        }
        bad += check(i == 0u ? "FM6_GET of the bank: rc 3, no bank" : i == 1u ? "FM6_PUT to the bank: rc 3, no bank" :
                               "FM6_ERASE: rc 3, no bank", host_wire[i == 2u ? 6 : 7] == 3u);
    }
    n = request(ED_FM6_LIST, a, 0);
    {   /* factory 8, bank 0, then used + name per factory slot */
        uint32_t p = 7, k, ok = host_wire[5] == FM6_NFACTORY && host_wire[6] == 0;
        for (k = 0; k < FM6_NFACTORY && p < n; k++) {
            ok &= host_wire[p++] == 1u;
            while (host_wire[p]) p++;
            p++;
        }
        bad += check("FM6_LIST: 8 factory names, nbank 0", ok && k == FM6_NFACTORY && p == n - 1u);
    }
    /* target 3: an FM6 user preset's patch */
    song.sel = 2;
    up_store(5, "MINE");                                 /* track 3 (MY PATCH, OWN) -> slot 6 */
    a[0] = ED_FM6_USER; a[1] = 5;
    request(ED_FM6_GET, a, 2);
    bad += check("UP_STORE of an FM6 track: FM6_GET user 6 gives its patch", host_wire[7] == 0 &&
                 !memcmp(host_wire + 8 + 118, "MY PATCH  ", 10));
    memcpy(a + 2, pk, FM6_PACKED);
    memcpy(a + 2 + 118, "EDITOR    ", 10);
    a[2 + 14] = 120;                                     /* OP6 output level 120: stored as 99 */
    request(ED_FM6_PUT, a, sizeof a);
    i = host_wire[7];
    request(ED_FM6_GET, a, 2);
    bad += check("FM6_PUT user 6, then GET: stored in range (a level of 120 -> 99)", i == 0u && host_wire[7] == 0 &&
                 host_wire[8 + 14] == 99 && !memcmp(host_wire + 8 + 118, "EDITOR    ", 10));
    fm6_load_slot(2, 0);
    up_load(5);
    bad += check("  .. UP_LOAD 6 plays it, SLOT OWN", !memcmp(fm6_patch[2] + FP_NAME, "EDITOR    ", 10) &&
                 trk[2].p[P_E7] == FM6_OWN);
    up_rename(5, "RENAMED");
    a[0] = ED_FM6_USER; a[1] = 5;
    request(ED_FM6_GET, a, 2);
    bad += check("  .. a rename keeps it", host_wire[7] == 0 && !memcmp(host_wire + 8 + 118, "EDITOR    ", 10));
    trk[0].eng_req = ENGI_DRUM;
    song.sel = 0;
    up_store(6, "KIT");
    a[0] = ED_FM6_USER; a[1] = 6; memcpy(a + 2, pk, FM6_PACKED);
    request(ED_FM6_GET, a, 2);
    i = host_wire[7];
    request(ED_FM6_PUT, a, sizeof a);
    bad += check("a DRUM user preset has no patch: GET rc 2, PUT rc 1", i == 2u && host_wire[7] == 1u);
    a[1] = 9;                                            /* an empty slot */
    request(ED_FM6_PUT, a, sizeof a);
    i = host_wire[7];
    a[1] = UP_SLOTS;
    request(ED_FM6_GET, a, 2);
    bad += check("an empty user slot: PUT rc 1; past the slots: GET rc 1", i == 1u && host_wire[7] == 1u);
    up_put(5, 0);
    a[1] = 5;
    request(ED_FM6_GET, a, 2);
    bad += check("an erased preset's patch is gone (GET rc 2)", host_wire[7] == 2u);
    a[0] = ED_FM6_TRACK; a[1] = 4;
    request(ED_FM6_PUT, a, sizeof a);
    i = host_wire[7];
    request(ED_FM6_PUT, a, 20);
    bad += check("FM6_PUT: a fifth track or a short record: rc 1", i == 1u && host_wire[7] == 1u);
    a[0] = 4; a[1] = 0;
    request(ED_FM6_GET, a, 2);
    bad += check("FM6_GET of an unknown target: rc 1", host_wire[7] == 1u);
    return bad;
}

/* UP_PUT -> UP_GET: every value round-trips through the v4 record (a byte each), negative ones too */
static int user_preset_roundtrip(void)
{
    static uint8_t a[16 + 2u * P_COUNT + 32u + 18u];
    int16_t want[P_COUNT], got[P_COUNT];
    uint32_t k = 0, i, p, ok, n;
    int bad = 0;
    reset();
    a[k++] = 3; a[k++] = 0;                                /* slot U04, ANALOG */
    memcpy(a + k, "ROUND", 5); k += 5; a[k++] = 0;
    for (i = 0; i < P_COUNT; i++) {
        const param_desc_t *d = param_desc_of(0, i);
        int16_t v = d->def;
        uint32_t u;
        if (i == P_LEVEL) v = 90;
        if (i == P_PAN) v = -20;
        if (i == P_ED_FLT) v = -40;
        if (i == P_LD_FLT) v = d->min;
        if (i == P_E1) v = d->max;
        want[i] = v; u = (uint32_t)(v + 8192);
        a[k++] = u & 127u; a[k++] = (u >> 7) & 127u;
    }
    for (i = 0; i < 16u; i++) { a[k++] = i & 1u ? 0u : (uint8_t)(48u + i); a[k++] = 0; }
    request(ED_UP_PUT, a, k);
    bad += check("UP_PUT stores a v4 record (no flash here: kept in RAM)",
                 host_wire[6] != 1u && up_used(3) && up_rec(3)->ver == UP_VER);
    up_values(up_rec(3), got);
    for (i = 0, ok = 1; i < P_COUNT; i++) ok &= got[i] == want[i];
    bad += check("UP_PUT keeps every value (PAN -20, FLT -40, min and max)", ok);
    a[0] = 3;
    request(ED_UP_GET, a, 1);
    ok = host_wire[5] == 3 && host_wire[6] == 1 && host_wire[7] == 0 && !memcmp(host_wire + 8, "ROUND", 6);
    for (i = 0, p = 14; i < P_COUNT; i++, p += 2u)
        ok &= (int32_t)(host_wire[p] | host_wire[p + 1] << 7) - 8192 == want[i];
    for (i = 0; i < 16u; i++, p += 2u)
        ok &= host_wire[p] == (i & 1u ? 0u : 48u + i);
    bad += check("UP_GET returns the values and the pattern UP_PUT sent", ok);
    bad += check("  .. then kind 0 and (1.2) the category: none sent, ANALOG's (OTHER)",
                 host_wire[p] == 0u && host_wire[p + 1u] == CAT_OTHER && host_wire[p + 2u] == 0xF7);
    {   /* 1.2 (Discussion #90): UP_PUT's category after the kind's 16 bytes; UP_LIST lists the categories after the slots */
        uint32_t k0 = k;
        a[k++] = 0;
        for (i = 0; i < 16u; i++) a[k++] = 0;
        a[k++] = CAT_PAD;
        a[0] = 3;
        request(ED_UP_PUT, a, k);
        ok = host_wire[6] != 1u && up_cat(3) == CAT_PAD;
        a[k - 1u] = CAT_N;
        request(ED_UP_PUT, a, k);
        ok &= host_wire[6] == 1u && up_cat(3) == CAT_PAD;
        a[0] = 3;
        request(ED_UP_GET, a, 1);
        ok &= host_wire[p] == 0u && host_wire[p + 1u] == CAT_PAD;
        a[0] = 2; a[1] = 2;
        n = request(ED_UP_LIST, a, 2);
        ok &= host_wire[5] == 2u && host_wire[6] == 2u && host_wire[n - 3u] == 0u && host_wire[n - 2u] == CAT_PAD;
        bad += check("UP_PUT with a category (after the kind's 16 bytes; past the last: rc 1), UP_GET and UP_LIST give it", ok);
        k = k0;
    }
    return bad;
}

/* the frames of cmd in host_wire: how many, and the args of the last (into *args) */
static uint32_t wire_frames(uint32_t cmd, const uint8_t **args)
{
    uint32_t i, k = 0;
    for (i = 0; i + 5u < host_wire_n; i++)
        if (host_wire[i] == 0xF0 && host_wire[i + 1] == ED_HDR0 && host_wire[i + 4] == cmd) {
            k++;
            if (args) *args = host_wire + i + 5;
        }
    return k;
}
static uint32_t sync_pass(void)                          /* one main-loop pass of the pushes */
{
    host_wire_n = 0;
    fm1_ms += 30u;
    ed_sync();
    host_drain();
    return host_wire_n;
}

/* the USER drum kit (editor_kit.c, cmds 88..93) */
static void kit_v3(uint8_t *a, int32_t v) { uint32_t u = (uint32_t)(v + ED_KIT_OFS); a[0] = u & 127u; a[1] = (u >> 7) & 127u; a[2] = (u >> 14) & 127u; }
static int kit_proto(void)
{
    int bad = 0;
    uint8_t a[16];
    const uint8_t *x = 0;
    uint32_t n;
    reset();
    uks_boot();
    n = request(ED_KIT_INFO, a, 0);
    bad += check("KIT_INFO: 11 runs, 8 lanes, 7 saved kits, none used, 8 model kits", n > 20u && host_wire[5] == 11 && host_wire[6] == 8 && host_wire[7] == 7 &&
                 host_wire[8] == 0 && host_wire[10] == 8 && !memcmp(host_wire + 11, "PUNCH", 6));
    a[0] = 0; n = request(ED_KIT_LANE, a, 1);
    bad += check("KIT_LANE 0: lane, the 80 kit's PUNCH, its fields with ranges (RUN first)", n > 40u && host_wire[5] == 0 && host_wire[6] == 0 && host_wire[7] == uk_count(0) &&
                 host_wire[8] == UF_RUN && host_wire[9] + (host_wire[10] << 7) == ED_KIT_OFS);
    a[0] = 0; a[1] = UF_GAIN; kit_v3(a + 2, 5000);
    n = request(ED_KIT_SET, a, 5);
    bad += check("KIT_SET: the field is written, the lane answered", n > 40u && uk_get(0, UF_GAIN) == 5000);
    kit_v3(a + 2, 65000);
    request(ED_KIT_SET, a, 5);
    bad += check("KIT_SET: a value out of its range lands in it", uk_get(0, UF_GAIN) == UK_HEAD[UF_GAIN].hi);
    a[1] = UF_V0 + 12;                                   /* (PUNCH has no V12: left as it is) */
    kit_v3(a + 2, 5);
    request(ED_KIT_SET, a, 5);
    bad += check("KIT_SET: a field the run does not use is left", uk_get(0, UF_V0 + 12) == 0);
    a[0] = 127; a[1] = 2; request(ED_KIT_SEED, a, 2);
    bad += check("KIT_SEED 127, 2: every lane is the 10 kit", host_wire[5] == 0 && uk_get(0, UF_RUN) == (int32_t)uk_run_index(DV_KIT[1][0].run) && uk_get(3, UF_P16) == DV_KIT[1][3].p16);
    a[0] = 0; a[1] = 5; a[2] = 1; request(ED_KIT_SEED, a, 3);
    bad += check("KIT_SEED lane, 5, 1: lane 0 plays the 77 kit's lane 1", uk_get(0, UF_RUN) == (int32_t)uk_run_index(DV_KIT[4][1].run));
    a[0] = 1; a[1] = 2; a[2] = 'Z'; a[3] = 'Y';
    request(ED_KIT_SLOT, a, 4);
    bad += check("KIT_SLOT SAVE 2: rc 0 (3, RAM only, on a host), K3 used", (host_wire[7] == 0 || host_wire[7] == 3) && (host_wire[8] & 4) && uks_valid(2) && !strcmp(uks.r[2].name, "ZY"));
    a[0] = 0; a[1] = 3; a[2] = 1; request(ED_KIT_SEED, a, 3);
    a[0] = 2; a[1] = 2; request(ED_KIT_SLOT, a, 2);
    bad += check("KIT_SLOT LOAD 2: the saved kit is the working kit again", host_wire[7] == 0 && uk_get(0, UF_RUN) == (int32_t)uk_run_index(DV_KIT[4][1].run));
    a[0] = 2; a[1] = 6; request(ED_KIT_SLOT, a, 2);
    bad += check("KIT_SLOT LOAD of an empty kit: rc 1", host_wire[7] == 1);
    a[0] = 1; a[1] = 9; a[2] = 'A'; request(ED_KIT_SLOT, a, 3);
    bad += check("KIT_SLOT: a slot out of range: rc 1", host_wire[7] == 1);
    a[0] = 3; a[1] = 2; request(ED_KIT_SLOT, a, 2);
    bad += check("KIT_SLOT ERASE 2: rc 0 (3, RAM only), none used", (host_wire[7] == 0 || host_wire[7] == 3) && !uks_valid(2));
    n = request(ED_KIT_LANE, a, 0);
    bad += check("a bad frame (no lane) is dropped", n == 0u);
    a[0] = 8; n = request(ED_KIT_LANE, a, 1);
    bad += check("a bad lane is dropped", n == 0u);
    /* the pushes: the device edits the kit (its knobs): KIT_CHANGED once */
    usb.resets = 0;
    a[0] = 1; request(ED_WATCH, a, 1);
    bad += check("KIT_CHANGED: nothing while the kit is still", !sync_pass());
    uk_set(2, UF_P16, uk_get(2, UF_P16) + 7);
    bad += check("KIT_CHANGED: one push when the device moves a number", sync_pass() && wire_frames(ED_KIT_CHANGED, &x) == 1u && !sync_pass());
    a[0] = 2; a[1] = UF_GAIN; kit_v3(a + 2, 4321);
    request(ED_KIT_SET, a, 5);
    bad += check("KIT_SET by the editor: no echo", !sync_pass());
    uks_save(0, "Dev");
    bad += check("KIT_CHANGED: a SAVE on the device is pushed too (the used mask)", sync_pass() && wire_frames(ED_KIT_CHANGED, &x) == 1u && x[1] == 1);
    /* FM6_CHANGED, MENU_CHANGED */
    bad += check("FM6_CHANGED / MENU_CHANGED: nothing while all is still", !sync_pass());
    {
        uint8_t v[FP_SIZE + 1u], pk[2u + FM6_PACKED];
        memcpy(v, fm6_patch[1], sizeof v);
        v[0] = (uint8_t)((v[0] + 1u) % 90u);
        fm6_set_patch(1, v);
        bad += check("FM6_CHANGED: the device writes a track's voice: one push with the track", sync_pass() && wire_frames(ED_FM6_CHANGED, &x) == 1u && x[0] == 1 && !sync_pass());
        v[0] = (uint8_t)((v[0] + 1u) % 90u);
        pk[0] = 0; pk[1] = 1;
        fm6_pack(v, pk + 2);
        request(ED_FM6_PUT, pk, 2u + FM6_PACKED);
        bad += check("FM6 PUT by the editor: no echo", !sync_pass());
    }
    {
        uint32_t w = menu_get(MI_COLOR) ? 0u : 1u;
        menu_put(MI_COLOR, w);
        bad += check("MENU_CHANGED: the device changes a setting: one push (id 0, its value)", sync_pass() && wire_frames(ED_MENU_CHANGED, &x) == 1u && x[0] == 0 && x[1] == (int)(w & 127u) && !sync_pass());
        a[0] = 0; a[1] = (uint8_t)(w ? 0 : 1); a[2] = 0;
        request(ED_MENU_SET, a, 3);
        bad += check("MENU_SET by the editor: no echo", !sync_pass());
    }
    return bad;
}

/* #65: WATCH while watching keeps what is not pushed yet; the editor's own sound load is not echoed as RELOAD */
static int live_sync(void)
{
    int bad = 0;
    uint8_t a[4] = {1, 0, 0, 0};
    uint32_t i, other = 0;
    const uint8_t *x = 0;
    reset();
    usb.resets = 0;
    request(ED_WATCH, a, 1);
    bad += check("WATCH 1 starts watching", host_wire[5] == 1 && ed_w.on && !sync_pass());
    TSEL->p[P_LEVEL] = 77;                               /* a device change, not pushed yet */
    request(ED_WATCH, a, 1);
    bad += check("WATCH 1 while watching keeps a pending change: CHANGED still goes out",
                 sync_pass() && wire_frames(ED_CHANGED, &x) == 1u && x[1] == P_LEVEL && ed_rv(x + 2) == 77);
    TSEL->p[P_LEVEL] = 66;
    a[0] = 0; request(ED_WATCH, a, 1);
    a[0] = 1; request(ED_WATCH, a, 1);
    bad += check("WATCH 0 then WATCH 1 starts from the values as they are (no push)", !sync_pass());
    TSEL->p[P_LEVEL] = 55; trk[1].p[P_PAN] = 3;
    a[0] = 3; request(ED_WATCH, a, 1);
    sync_pass();
    bad += check("WATCH 3 while watching: CHANGED kept, TRACK_CHANGED from the mix as it is",
                 host_wire_n && wire_frames(ED_CHANGED, 0) == 1u && !wire_frames(ED_TRACK_CHANGED, 0) && ed_w.v4);
    usb.resets++;
    TSEL->p[P_LEVEL] = 44;
    request(ED_WATCH, a, 1);
    bad += check("WATCH after a USB reset starts over", !sync_pass());

    /* PRESET */
    TSEL->p[P_LEVEL] = 33;                               /* pending; a sound load keeps P_LEVEL */
    a[0] = 0; a[1] = 2;
    request(ED_PRESET, a, 2);
    sync_pass();
    bad += check("the editor's own PRESET: no RELOAD, no CHANGED for what it loaded, a pending CHANGED stays",
                 TSEL->preset == 2 && !wire_frames(ED_RELOAD, 0) && wire_frames(ED_CHANGED, &x) == 1u &&
                 x[1] == P_LEVEL && !sync_pass());
    for (i = 0; i < 3u; i++) {                           /* any preset of any engine */
        a[0] = (uint8_t)(i ? 12u : 4u); a[1] = (uint8_t)i;
        request(ED_PRESET, a, 2);
        other += sync_pass() != 0;
    }
    bad += check("PRESET of other engines: no push at all", !other && ed_w.eng == ed_eng(TSEL));
    a[0] = 1; a[1] = G_ENGSEL; a[2] = (8192 + 5) & 127; a[3] = (8192 + 5) >> 7;
    request(ED_SET, a, 4);
    bad += check("SET of G_ENGSEL: no RELOAD", ed_eng(TSEL) == 5u && !sync_pass());
    sync_reload = 1;                                     /* a load on the device, not pushed yet */
    a[0] = 0; a[1] = 1;
    request(ED_PRESET, a, 2);
    sync_pass();
    bad += check("a RELOAD due before the editor's PRESET still goes out", wire_frames(ED_RELOAD, 0) == 1u);
    a[0] = 0; request(ED_WATCH, a, 1);
    sync_reload = 0;
    a[0] = 0; a[1] = 3;
    request(ED_PRESET, a, 2);
    a[0] = 1; request(ED_WATCH, a, 1);
    bad += check("not watching: PRESET as before, WATCH then starts from it", !sync_pass() && TSEL->preset == 3);
    return bad;
}

/* #64: SysEx through the USB packet path (ep1_take) at full speed: a 256-byte BACKUP_PUT piece (293 pack7 bytes, 101
 * event packets, 7 USB packets) arrives whole; one request at a time always works, a frame sent before the reply
 * to the one before is dropped whole (no reply; never a partial frame) */
static uint32_t usb_frame(const uint8_t *f, uint32_t n, uint8_t *usbp)   /* F0..F7 -> USB-MIDI event packets */
{
    uint32_t i = 0, o = 0;
    while (i < n) {
        uint32_t k = n - i >= 3u ? 3u : n - i, cin = k == 3u && i + 3u < n ? 4u : k == 3u ? 7u : 4u + k;
        usbp[o++] = (uint8_t)cin;
        usbp[o++] = f[i];
        usbp[o++] = k > 1u ? f[i + 1] : 0;
        usbp[o++] = k > 2u ? f[i + 2] : 0;
        i += k;
    }
    return o;
}
static uint32_t usb_feed(const uint8_t *p, uint32_t n)   /* whole 64-byte USB packets, as the host sends them */
{
    uint32_t o, refused = 0;
    for (o = 0; o < n; o += 64u)
        while (!ep1_take(p + o, n - o > 64u ? 64u : n - o))
            refused++;                                  /* NAK: the host sends it again */
    return refused;
}
static uint32_t put_frame(uint8_t *f, uint32_t op, uint32_t off, uint32_t count)
{
    static const uint8_t zero[256];
    uint32_t n = 0, i;
    f[n++] = 0xF0; f[n++] = ED_HDR0; f[n++] = ED_HDR1; f[n++] = ED_HDR2; f[n++] = ED_BACKUP_PUT;
    f[n++] = (uint8_t)op; f[n++] = 2;
    if (op == 0u) {
        for (i = 0; i < 5u; i++) f[n++] = (uint8_t)((sizeof(project_store_t) >> (7u * i)) & (i == 4u ? 15u : 127u));
        for (i = 0; i < 5u; i++) f[n++] = 0;
    } else if (op == 1u) {
        for (i = 0; i < 5u; i++) f[n++] = (uint8_t)((off >> (7u * i)) & (i == 4u ? 15u : 127u));
        n += pack7(zero, count, f + n);
    }
    f[n++] = 0xF7;
    return n;
}
static int usb_burst(void)
{
    static uint8_t f[700], u[1000], u2[2000];
    uint32_t off, n, k, ok = 1, max = 0;
    const uint8_t *x = 0;
    int bad = 0;
    reset();
    usb.rx_pend = 0;
    n = put_frame(f, 0, 0, 0);
    usb_feed(u, usb_frame(f, n, u)); host_wire_n = 0; ed_service(); host_drain();
    bad += check("BACKUP_PUT begin through ep1_take", wire_frames(ED_BACKUP_PUT, &x) == 1u && !x[2]);
    for (off = 0; off < sizeof(project_store_t); off += 256u) {
        uint32_t c = sizeof(project_store_t) - off > 256u ? 256u : sizeof(project_store_t) - off;
        n = put_frame(f, 1, off, c);
        if (n > max) max = n;
        k = usb_frame(f, n, u);
        usb_feed(u, k);
        host_wire_n = 0; ed_service(); host_drain();
        ok &= wire_frames(ED_BACKUP_PUT, &x) == 1u && !x[2] && sx_ready == 0;
    }
    bad += check("256-byte pieces in 64-byte USB packets at full speed: every piece taken (rc 0)",
                 ok && ed_bk_pos == sizeof(project_store_t) && max == 4u + 1u + 7u + 293u + 1u && max <= sizeof sx_frame);
    n = put_frame(f, 3, 0, 0);
    usb_feed(u, usb_frame(f, n, u)); host_wire_n = 0; ed_service(); host_drain();
    bad += check("abort through ep1_take", wire_frames(ED_BACKUP_PUT, &x) == 1u && !x[2] && !ed_bk_put);

    /* two frames back to back, before the reply: the second is dropped whole, the first answered intact */
    n = put_frame(f, 0, 0, 0);
    usb_feed(u, usb_frame(f, n, u)); host_wire_n = 0; ed_service(); host_drain();
    k = usb_frame(f, put_frame(f, 1, 0, 256), u2);
    k += usb_frame(f, put_frame(f, 1, 256, 256), u2 + k);
    usb_feed(u2, k);
    host_wire_n = 0; ed_service(); ed_service(); host_drain();
    bad += check("pipelined: the first piece is taken, the second (sent before its reply) dropped whole",
                 wire_frames(ED_BACKUP_PUT, &x) == 1u && !x[2] && ed_bk_pos == 256u && !sx_ready);
    n = put_frame(f, 1, 512, 256);
    usb_feed(u, usb_frame(f, n, u)); host_wire_n = 0; ed_service(); host_drain();
    bad += check("... so the next piece is refused (rc 1, offset), as a host that waits never sees",
                 wire_frames(ED_BACKUP_PUT, &x) == 1u && x[2] == 1u && ed_bk_pos == 256u);
    request(ED_BACKUP_PUT, (const uint8_t[]){3, 2}, 2);
    return bad;
}

/* ---- MENU_DESC / MENU_SET (72, 73): the menu's settings over the editor ---- */
typedef struct { uint32_t index, id, kind, nnames, tab, rest; int32_t value, min, max; char name[16], names[20][12], tabname[16], unit[16]; } menu_item_t;
static uint32_t menu_desc(uint32_t index, menu_item_t *it)   /* the reply's payload length; it parsed */
{
    uint8_t a[1] = {(uint8_t)index};
    uint32_t n = request(ED_MENU_DESC, a, 1), p = 14, k;
    memset(it, 0, sizeof *it);
    if (n < 8u || host_wire[4] != ED_MENU_DESC || host_wire[n - 1] != 0xF7) return 0;
    it->index = host_wire[5]; it->id = host_wire[6];
    if (n < 15u) return n - 6u;
    it->kind = host_wire[7];
    it->value = ed_rv(host_wire + 8); it->min = ed_rv(host_wire + 10); it->max = ed_rv(host_wire + 12);
    for (k = 0; p < n - 1u && host_wire[p] && k < 15u; ) it->name[k++] = (char)host_wire[p++];
    p++;
    if (it->kind == 1u) {                                   /* (a number: its unit, then the tab) */
        for (k = 0; p < n - 1u && host_wire[p] && k < 15u; ) it->unit[k++] = (char)host_wire[p++];
        p++;
    }
    while (it->kind == 0u && p < n - 1u && it->nnames < 20u && (int32_t)it->nnames < it->max - it->min + 1) {   /* (kind 0: max - min + 1) */
        for (k = 0; p < n - 1u && host_wire[p] && k < 11u; ) it->names[it->nnames][k++] = (char)host_wire[p++];
        p++; it->nnames++;
    }
    it->tab = 127;                                          /* 1.0.5: then the row's tab, index and name */
    if (p < n - 1u) {
        it->tab = host_wire[p++];
        for (k = 0; p < n - 1u && host_wire[p] && k < 15u; ) it->tabname[k++] = (char)host_wire[p++];
        p++;
    }
    it->rest = p < n - 1u ? n - 1u - p : 0u;                /* (bytes left over: none) */
    return n - 6u;
}
static uint32_t menu_set(uint32_t id, int32_t v)            /* -> rc; host_wire[6], [7..8]: id, value */
{
    uint8_t a[3] = {(uint8_t)id, (uint8_t)((v + 8192) & 127), (uint8_t)(((v + 8192) >> 7) & 127)};
    uint32_t n = request(ED_MENU_SET, a, 3);
    return n == 10u && host_wire[4] == ED_MENU_SET ? host_wire[5] : 99u;
}
#define TCH_NAMES "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,OMNI,OFF"
static int menu_protocol(void)
{
    static const char *const WANT[33][2] = {
        {"COLOR", 0}, {"STYLE", "FLAT,LINE"}, {"LARGE", "OFF,ON"}, {"ANIM", "ON,OFF,IDLE"}, {"LEDS", "OFF,DIM LO,DIM HI,INV,INV LO,INV HI"},
        {"HOLD", "0.3 s,0.4 s,0.5 s,0.6 s"}, {"KNOB ACCEL", "OFF,ON"}, {"FX LATCH", "OFF,ON"}, {"BPM LOCK", "OFF,ON"},
        {"SPEAKER EQ", "FLAT,LOWCUT,BASS+"}, {"USB LEVEL", "MASTER,FIXED"}, {"USB SERIAL", "ON,OFF"},
        {"CLICK", "OFF,REC,ON"}, {"CLICK LEVEL", "LOW,MID,HIGH"}, {"COUNT-IN", "OFF,1 BAR,2 BARS"},   /* (1.1: appended) */
        {"RESTORE LAST", "ON,OFF"}, {"SCALE LEDS", "OFF,ON"},                                        /* (1.2) */
        {"SCREEN OFF", "NEVER,5 MIN,15 MIN,30 MIN,60 MIN"},
        {"SCOPE", "OUT,MIX"}, {"STEP PREVIEW", "OFF,ON"}, {"CHORD ENTRY", "HOLD,ADD"},                  /* (1.2) */
        {"MIDI IN", "CH1-4,SEL,CH5-8,CH9-12,CH13-16,TRACK"}, {"TUNE", 0},   /* (1.2: the project's ROUT and TUNE; TUNE a number) */
        {"HOME", "SCOPE,TRACKS,LEVELS"},                                                       /* (1.3; 1.5: LEVELS) */
        {"HELP", "OFF,ON"},                                                                          /* (1.5) */
        {"SELECT", "BPM,PAGE,MODW,VEL"},                                                             /* (1.5.5; 1.5.6 MODW VEL) */
        {"T1 CHANNEL", TCH_NAMES}, {"T2 CHANNEL", TCH_NAMES}, {"T3 CHANNEL", TCH_NAMES}, {"T4 CHANNEL", TCH_NAMES},   /* (1.5.5) */
        {"AUTO SELECT", "OFF,ON"}, {"SCREEN WAKE", "+MIDI,PANEL"},                                   /* (1.5.5) */
        {"2ND CORE", "OFF,ON (BETA)"}};                                                           /* (1.6.1; OFF the default) */
    static const int32_t DEF[33] = {-1, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 0, 0, 0};   /* (COLOR: the default palette) */
    static const uint8_t TAB[33] = {0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 4, 2, 2, 2, 4, 1, 0, 0, 1, 1, 3, 2, 0, 4, 1, 3, 3, 3, 3, 3, 3, 4};   /* DISPLAY CONTROL AUDIO
                                                                                                         * MIDI SYSTEM (1.2) */
    static const char *const TABN[5] = {"DISPLAY", "CONTROL", "AUDIO", "MIDI", "SYSTEM"};
    int bad = 0, ok = 1;
    uint32_t i, k, n;
    menu_item_t it;
    char joined[128];
    const char *json = getenv("MENU_JSON");
    FILE *jf = json ? fopen(json, "w") : 0;
    reset();
    if (jf) fprintf(jf, "[");
    for (i = 0; i < MENU_N; i++) {
        n = menu_desc(i, &it);
        joined[0] = 0;
        for (k = 0; k < it.nnames; k++) { if (k) strcat(joined, ","); strcat(joined, it.names[k]); }
        ok &= i == 22u ? n > 10u && it.index == i && it.id == i && it.kind == 1 && it.min == -50 && it.max == 50 &&
                         !it.nnames && !strcmp(it.unit, "ct") && !strcmp(it.name, "TUNE")     /* (a number: cents) */
                       : n > 10u && it.index == i && it.id == i && it.kind == 0 && it.min == 0 && !it.unit[0] &&
                         it.max + 1 == (int32_t)it.nnames && !strcmp(it.name, WANT[i][0]) &&
                         (WANT[i][1] ? !strcmp(joined, WANT[i][1]) : it.nnames == NPALETTES);
        ok &= it.value == (DEF[i] < 0 ? (int32_t)settings.palette : DEF[i]) &&
              it.tab == TAB[i] && !strcmp(it.tabname, TABN[TAB[i]]) && !it.rest;
        if (i == 0)
            for (k = 0; k < NPALETTES; k++) ok &= !strcmp(it.names[k], UI_PALETTES[k].name);
        if (!ok) { printf("  MENU_DESC %u: %s [%s] value %d max %d tab %u %s\n", i, it.name, joined, it.value, it.max, it.tab, it.tabname); break; }
        if (jf) {
            fprintf(jf, "%s\n {\"id\":%u,\"kind\":%u,\"min\":%d,\"max\":%d,\"value\":%d,\"name\":\"%s\",\"names\":[", i ? "," : "",
                    it.id, it.kind, it.min, it.max, it.value, it.name);
            for (k = 0; k < it.nnames; k++) fprintf(jf, "%s\"%s\"", k ? "," : "", it.names[k]);
            fprintf(jf, "],\"unit\":\"%s\",\"tab\":%u,\"tabName\":\"%s\"}", it.unit, it.tab, it.tabname);
        }
    }
    if (jf) { fprintf(jf, "]\n"); fclose(jf); }
    bad += check(FELUCCA_CPU2 ? "MENU_DESC: 33 items (... 1.5.5, then 1.6.1 2ND CORE id 32 last: OFF / ON (BETA), OFF by default), names, defaults" : "MENU_DESC (FELUCCA_CPU2=0): 32 items (1.0.4's 12 in the menu's order, then 1.1's CLICK, CLICK LEVEL, COUNT-IN, 1.2's RESTORE LAST, SCALE LEDS, SCREEN OFF, 1.2's SCOPE, STEP PREVIEW, CHORD ENTRY, MIDI IN, TUNE, 1.3's HOME, 1.5's HELP, 1.5.5's SELECT, T1..T4 CHANNEL, AUTO SELECT, SCREEN WAKE), ids 0..31, names, defaults; TUNE a number -50..50 ct", ok);
    bad += check("MENU_DESC (1.0.5): after the names (TUNE: the unit) each item's tab, index and name (DISPLAY CONTROL AUDIO MIDI SYSTEM)", ok);
    {   /* an older editor reads the names and stops: the tab is past them, nothing it reads moved */
        uint32_t m = menu_desc(4, &it), p = 14, q;
        for (q = 0; q < 1u + it.nnames; q++) { while (host_wire[p]) p++; p++; }   /* name, the names */
        ok = m > 10u && host_wire[p] == 0 && !strcmp((const char *)host_wire + p + 1, "DISPLAY") &&
             p + 1u + 8u == m + 6u - 1u;
        bad += check("MENU_DESC: the tab comes after every byte of the 1.0.4 reply (older editors ignore it)", ok);
    }
    ok = 1;
    for (i = 0; i < MENU_N; i++) {
        menu_desc(i, &it);
        ok &= strcmp(it.name, "CALIBRATION") && strcmp(it.name, "ABOUT") && strcmp(it.name, "INFO");
    }
    n = menu_desc(MENU_N, &it);
    ok &= n == 2u && it.index == MENU_N && it.id == 127;
    n = menu_desc(127, &it);
    bad += check("MENU_DESC: no CALIBRATION / INFO / ABOUT; an index past the list answers index, 127 (no item)",
                 ok && n == 2u && it.index == 127 && it.id == 127);
    {
        uint8_t a[3] = {0, 0, 0};
        ok = request(ED_MENU_DESC, a, 0) == 0 && request(ED_MENU_DESC, a, 2) == 0 && request(ED_MENU_SET, a, 2) == 0 &&
             request(ED_MENU_SET, a, 1) == 0;
        bad += check("MENU_DESC / MENU_SET with the wrong length: no reply", ok);
    }

    /* MENU_SET: each setting, applied as the menu applies it; RAM only here (no flash: rc 3) */
    reset();
    ui.force = 0;
    ok = menu_set(0, 2) == 3 && host_wire[6] == 0 && ed_rv(host_wire + 7) == 2 && settings.palette == 2u &&
         T_BG == UI_PALETTES[2].c1 && ui.force;
    ok &= menu_set(1, 1) == 3 && ui_style == ST_LINE;
    ok &= menu_set(2, 1) == 3 && (ui_prefs & PREF_LARGE);
    ok &= menu_set(3, 1) == 3 && (ui_prefs & PREF_ANIM_OFF);
    ok &= menu_set(4, 0) == 3 && settings_leds == LEDS_OFF && menu_set(4, 1) == 3 && settings_leds == LEDS_DIM_LO;
    ok &= menu_set(5, 3) == 3 && settings_hold == 3u;
    ok &= menu_set(6, 1) == 3 && (ui_prefs & PREF_ACCEL);
    ok &= menu_set(7, 1) == 3 && (ui_prefs & PREF_LATCH);
    ok &= menu_set(8, 1) == 3 && (ui_prefs & PREF_BPM_LOCK);
    ok &= menu_set(9, 2) == 3 && settings.lowcut == 2u && fx_lowcut == 2u;
    ok &= menu_set(10, 1) == 3 && (ui_prefs & PREF_USB_FIXED) && fx_usb_fixed;
    ok &= menu_set(12, 1) == 3 && click_mode == CLICK_REC && menu_set(12, 2) == 3 && click_mode == CLICK_ON;
    ok &= menu_set(13, 0) == 3 && click_lvl == 0u;
    ok &= menu_set(14, 2) == 3 && cin_bars == 2u;
    ok &= menu_set(15, 1) == 3 && (ui_prefs & PREF_RESTORE_OFF);
    ok &= menu_set(16, 1) == 3 && (ui_rec_prefs & 0x40u) && click_mode == CLICK_ON && cin_bars == 2u;   /* (its own bit) */
    ok &= menu_set(17, 0) == 3 && scr_get() == 0u && menu_set(17, 9) == 3 && scr_get() == 4u &&   /* (clamped) */
          menu_set(17, 2) == 3 && scr_get() == 2u && ui_scr == 1u;
    ok &= menu_set(18, 1) == 3 && ui_prefs2 == 1u && scope_mix;                                    /* (1.2: their own byte) */
    ok &= menu_set(19, 1) == 3 && ui_prefs2 == 3u && menu_set(20, 1) == 3 && ui_prefs2 == 7u;
    ok &= menu_set(21, 2) == 0 && song.g[G_ROUTE] == 2 && menu_set(22, -13) == 0 && song.g[G_TUNE] == -13;   /* (1.2: the
                                                         * project's, rc 0: in the music, no settings record) */
    ok &= menu_set(23, 1) == 3 && ui_home_view == HV_TRACKS && ui_prefs2 == 7u && ui_scr == 1u;   /* (1.3: its own byte) */
    ok &= menu_set(24, 1) == 3 && ui_prefs2 == 15u && help_on();                                  /* (1.5: HELP, bit 3) */
    ok &= menu_set(25, 1) == 3 && ui_prefs2 == 31u;                                               /* (1.5.5: SELECT, bit 4) */
    ok &= menu_set(26, 9) == 0 && mch_get(0) == 9u && song.mch[0] == 9u && menu_set(27, MCH_OMNI) == 0 &&   /* (1.5.5: */
          mch_get(1) == MCH_OMNI && menu_set(28, MCH_OFF) == 0 && mch_get(2) == MCH_OFF && menu_set(29, 0) == 0 &&   /* the */
          mch_get(3) == 0u && song.mch[3] == 13u;           /* project's T1..T4 CHANNEL, rc 0, as MIDI IN) */
    ok &= menu_set(30, 1) == 3 && (ui_rec_prefs & 0x80u) && (ui_rec_prefs & 0x40u) && click_mode == CLICK_ON &&   /* (1.5.5:
                                                         * AUTO SELECT, a setting: bit 7 of ui_rec_prefs) */
          ui_prefs2 == 31u;                             /* (its own byte: SELECT's bit 4 untouched) */
    ok &= menu_set(31, 1) == 3 && ui_prefs2 == 63u && (ui_rec_prefs & 0x80u) && ui_scr == 1u;   /* (1.5.5: SCREEN WAKE
                                                         * PANEL, bit 5 of ui_prefs2; SCREEN OFF's byte untouched) */
#if FELUCCA_CPU2
    ok &= menu_set(32, 1) == 3 && ui_prefs2 == 0xBFu;   /* (2ND CORE ON (BETA), bit 7 of ui_prefs2) */
#else
    ok &= menu_set(32, 1) == 1 && ui_prefs2 == 0x3Fu;   /* (no 2ND CORE in a FELUCCA_CPU2=0 build: an unknown id, nothing set) */
#endif
    for (i = 0; i < MENU_N; i++) {                         /* MENU_DESC reads them back */
        static const int32_t SET[33] = {2, 1, 1, 1, 1, 3, 1, 1, 1, 2, 1, 0, 2, 0, 2, 1, 1, 2, 1, 1, 1, 2, -13, 1, 1, 1, 9, 16, 17, 0, 1, 1, 1};
        menu_desc(i, &it);
        ok &= it.value == SET[i];
    }
    bad += check("MENU_SET: every setting applied as the menu does (palette, EQ, USB LEVEL, CLICK, COUNT-IN at once, RESTORE LAST, SCALE LEDS, SCREEN OFF, SCOPE, STEP PREVIEW, CHORD ENTRY, HOME, HELP, SELECT, T1..T4 CHANNEL, AUTO SELECT, SCREEN WAKE, 2ND CORE ON (bit 7 of ui_prefs2; none in a FELUCCA_CPU2=0 build)), read back", ok);
    ok = menu_set(3, 0) == 3 && !(ui_prefs & PREF_ANIM_OFF) && (ui_prefs & PREF_LARGE) && menu_set(10, 0) == 3 &&
         !fx_usb_fixed && menu_set(1, 0) == 3 && ui_style == ST_FLAT;
    bad += check("MENU_SET: a flag back to its default leaves the other flags", ok);

    /* clamping: the reply carries the device's value */
    ok = menu_set(0, 50) == 3 && ed_rv(host_wire + 7) == (int32_t)NPALETTES - 1 && settings.palette == NPALETTES - 1u;
    ok &= menu_set(0, -5) == 3 && ed_rv(host_wire + 7) == 0 && settings.palette == 0u;
    ok &= menu_set(4, 99) == 3 && ed_rv(host_wire + 7) == 5 && settings_leds == LEDS_INV && leds_inv() == 2u;   /* (1.5.6: INV HI last) */
    ok &= menu_set(5, 8191) == 3 && ed_rv(host_wire + 7) == 3 && settings_hold == 3u;
    ok &= menu_set(2, 7) == 3 && ed_rv(host_wire + 7) == 1 && (ui_prefs & PREF_LARGE);
    ok &= menu_set(14, 9) == 3 && ed_rv(host_wire + 7) == 2 && cin_bars == 2u;
    ok &= menu_set(12, -1) == 3 && ed_rv(host_wire + 7) == 0 && click_mode == CLICK_OFF;
    ok &= menu_set(21, 9) == 0 && ed_rv(host_wire + 7) == 5 && song.g[G_ROUTE] == 5;   /* (1.5.5: TRACK the last) */
    ok &= menu_set(26, 40) == 0 && ed_rv(host_wire + 7) == 17 && mch_get(0) == MCH_OFF;   /* (T1 CHANNEL) */
    ok &= menu_set(22, -99) == 0 && ed_rv(host_wire + 7) == -50 && song.g[G_TUNE] == -50;
    ok &= menu_set(22, 51) == 0 && ed_rv(host_wire + 7) == 50 && song.g[G_TUNE] == 50;
    bad += check("MENU_SET: out-of-range values clamped, the reply says the value the device took (TUNE -50..50)", ok);

    /* an id nobody has */
    {
        static uint8_t fav0[sizeof favorites], set0[sizeof settings];
        uint8_t hold0 = settings_hold, leds0 = settings_leds;
        memcpy(fav0, &favorites, sizeof favorites); memcpy(set0, &settings, sizeof settings);
        ok = menu_set(MENU_N, 1) == 1 && host_wire[6] == MENU_N && ed_rv(host_wire + 7) == 1;
        ok &= menu_set(126, -3) == 1 && host_wire[6] == 126 && ed_rv(host_wire + 7) == -3;
        ok &= menu_set(127, 0) == 1 && host_wire[6] == 127;
        ok &= !memcmp(fav0, &favorites, sizeof favorites) && !memcmp(set0, &settings, sizeof settings) &&
              hold0 == settings_hold && leds0 == settings_leds;
        bad += check("MENU_SET: an unknown id answers rc 1, id and value echoed, nothing changed", ok);
    }

    /* the MENU page shown: the editor's change redraws it */
    ui.menu = 1; ui.force = 0;
    menu_set(7, 0);
    bad += check("MENU_SET while the MENU page is shown: the page redraws (ui.force)", ui.force && ui.menu == 1);
    ui.menu = 0;

    /* USB SERIAL: the reply first, the re-enumeration 200 ms later (usb_serial_apply, called every frame). (usb.up
     * stays 0 here: the host has no USB registers; usb.config 0 = the device off the bus, enumerated afresh) */
    {
        uint32_t t0;
        reset();
        usb_cdc_on = 1;
        usb_serial_apply();
        ok = usb_cdc_on && usb.config;
        ok &= menu_set(11, 1) == 3 && host_wire[6] == 11 && ed_rv(host_wire + 7) == 1 && (ui_prefs & PREF_SERIAL_OFF);
        t0 = fm1_ms;
        usb_serial_apply();
        ok &= usb_cdc_on && usb.config;                 /* the reply has left; USB as it was */
        fm1_ms = t0 + 150u; usb_serial_apply();
        ok &= usb_cdc_on && usb.config;
        fm1_ms = t0 + 201u; usb_serial_apply();
        ok &= !usb_cdc_on && !usb.config;               /* off the bus: usb_retry attaches again without the console */
        bad += check("MENU_SET USB SERIAL OFF: reply first, applied ~200 ms later (the device re-enumerates)", ok);
        usb.config = 1;
        ok = menu_set(11, 0) == 3 && !(ui_prefs & PREF_SERIAL_OFF);
        t0 = fm1_ms;
        ui.menu = 1;                                    /* the MENU shown: applied when it closes, as the menu's own */
        fm1_ms = t0 + 500u;                             /* (ui_input calls usb_serial_apply only with the menu closed) */
        ok &= !usb_cdc_on && usb.config;
        ui.menu = 0; usb_serial_apply();
        ok &= usb_cdc_on && !usb.config;
        usb.config = 1;
        ok &= menu_set(11, 0) == 3;                     /* unchanged: no re-enumeration */
        fm1_ms += 300u; usb_serial_apply();
        ok &= usb_cdc_on && usb.config;
        bad += check("MENU_SET USB SERIAL ON: applied later (with the MENU open: when it closes); unchanged: no drop", ok);
    }
    reset();
    return bad;
}

/* DRUM KIT 1..3 (HAND CYM H+CYM until 1.0.4, retired): DESC names them as the kit they play (66 10 77), a SET of
 * one lands on that kit (the reply says so), a user preset sent with one loads as that kit */
static int drum_kit_retired(void)
{
    static const uint8_t MAP[4] = {0, 6, 5, 8};
    static uint8_t a[16 + 2u * P_COUNT + 32u];
    int16_t got[P_COUNT];
    uint32_t r, i, k = 0, ok = 1;
    int bad = 0;
    reset();
    a[0] = 1; a[1] = G_ENGSEL; a[2] = (8192 + ENGI_DRUM) & 127; a[3] = (8192 + ENGI_DRUM) >> 7;
    request(ED_SET, a, 4);
    a[0] = 0; a[1] = P_E0;
    request(ED_DESC, a, 2);
    {   /* scope, id, fmt, min, max, def (v14 each), "KIT", "", then the 9 names */
        const char *n = (const char *)host_wire + 5 + 3 + 6;
        static const char *const WANT[9] = {"STD", "66", "10", "77", "80", "10", "66", "55", "77"};
        n += strlen(n) + 1; n += strlen(n) + 1;
        for (i = 0; i < 9u; i++, n += strlen(n) + 1)
            ok &= !strcmp(n, WANT[i]);
    }
    bad += check("DESC of DRUM KIT: STD 66 10 77 80 10 66 55 77 (1..3 as the kits they play)", ok);
    for (r = 1, ok = ed_eng(TSEL) == ENGI_DRUM; r < 4u; r++) {
        uint32_t u = r + 8192u;
        a[0] = 0; a[1] = P_E0; a[2] = u & 127u; a[3] = u >> 7;
        request(ED_SET, a, 4);
        ok &= TSEL->p[P_E0] == MAP[r] && (int32_t)(host_wire[7] | host_wire[8] << 7) - 8192 == MAP[r];
    }
    bad += check("SET of DRUM KIT 1..3 lands on 66 10 77 (and replies it)", ok);
    a[k++] = 5; a[k++] = ENGI_DRUM;                        /* slot U06, DRUM, KIT 3 (H+CYM) */
    memcpy(a + k, "OLDKIT", 6); k += 6; a[k++] = 0;
    for (i = 0; i < P_COUNT; i++) {
        uint32_t u = (uint32_t)((i == P_E0 ? 3 : param_desc_of(ENGI_DRUM, i)->def) + 8192);
        a[k++] = u & 127u; a[k++] = (u >> 7) & 127u;
    }
    for (i = 0; i < 16u; i++) { a[k++] = 0; a[k++] = 0; }
    request(ED_UP_PUT, a, k);
    up_values(up_rec(5), got);
    bad += check("a user preset of DRUM KIT 3 (H+CYM) loads as 77", up_used(5) && got[P_E0] == 8);
    {   /* a project whose DRUM tracks hold KIT 0..3: loaded (and bounded, as from flash) as STD 66 10 77 */
        static project_t p;
        for (r = 0; r < NTRK; r++) {
            set_engine_of(&trk[r], ENGI_DRUM); apply_preset_to(&trk[r], 0);
            trk[r].engine = trk[r].eng_req;
        }
        project_capture(&p);
        for (r = 0; r < NTRK; r++) p.t[r].p[P_E0] = (int16_t)r;
        p.sum = proj_sum(&p);
        ok = !project_restore_runtime(&p);
        for (r = 0; r < NTRK; r++) ok &= trk[r].p[P_E0] == MAP[r];
        for (r = 0; r < NTRK; r++) p.t[r].p[P_E0] = (int16_t)r;
        proj_bound(&p);
        for (r = 0; r < NTRK; r++) ok &= p.t[r].p[P_E0] == MAP[r];
        bad += check("a project of DRUM KIT 1..3 loads as 66 10 77 (STD stays)", ok);
    }
    return bad;
}

/* 1.5 MIDI LEARN (78 LEARN_GET, 79 LEARN_SET; editor_learn.c): the map as the device keeps it (midi_learn.c) */
static int learn_entry(uint32_t i, uint32_t used, uint32_t cc, uint32_t k, uint32_t id)   /* (a LEARN_GET reply) */
{
    const uint8_t *e = &host_wire[6u + 4u * i];      /* (ML_N, then the entries) */
    return e[0] == used && e[1] == cc && e[2] == k && e[3] == id;
}
static int learn_protocol(void)
{
    int bad = 0, ok;
    uint32_t n, i;
    reset();
    memset(favorites.factory[14], 0, 32);
    n = request(ED_LEARN_GET, 0, 0);
    ok = n == 6u + 1u + 4u * ML_N && host_wire[4] == ED_LEARN_GET && host_wire[5] == ML_N;
    for (i = 0; i < ML_N; i++)
        ok &= !memcmp(&host_wire[6u + 4u * i], "\0\0\0\0", 4);
    bad += check("LEARN_GET: 16 entries, all empty at first", ok);
    {
        const uint8_t a[] = {0, 74, 3, P_E0 + 2}, b[] = {0, 20, 0, P_LEVEL}, c[] = {0, 20, 1, P_PAN};
        n = request(ED_LEARN_SET, a, 4);
        ok = n == 6u + 2u + 4u * ML_N && host_wire[4] == ED_LEARN_SET && (host_wire[5] == 0u || host_wire[5] == 3u) &&
             host_wire[6] == ML_N && !memcmp(&host_wire[7], (const uint8_t[]){1, 74, 3, P_E0 + 2}, 4);   /* (rc, then GET's) */
        request(ED_LEARN_SET, b, 4);
        request(ED_LEARN_SET, c, 4);                     /* (CC20 again: T2 PAN in place of T1 LEVEL) */
        n = request(ED_LEARN_GET, 0, 0);
        ok &= learn_entry(0, 1, 74, 3, P_E0 + 2) && learn_entry(1, 1, 20, 1, P_PAN) && learn_entry(2, 0, 0, 0, 0);
        bad += check("LEARN_SET op 0: learns (DRUM's TONE on CC74); CC20 again replaces its parameter", ok);
    }
    {
        const uint8_t bad1[] = {0, 64, 0, 1}, bad2[] = {0, 21, 4, 1}, bad3[] = {0, 21, 0, P_COUNT}, bad4[] = {0, 120, 0, 1};
        ok = request(ED_LEARN_SET, bad1, 4) && host_wire[5] == 1u;
        ok &= request(ED_LEARN_SET, bad2, 4) && host_wire[5] == 1u;
        ok &= request(ED_LEARN_SET, bad3, 4) && host_wire[5] == 1u;
        ok &= request(ED_LEARN_SET, bad4, 4) && host_wire[5] == 1u;
        n = request(ED_LEARN_GET, 0, 0);
        ok &= learn_entry(0, 1, 74, 3, P_E0 + 2) && learn_entry(1, 1, 20, 1, P_PAN);
        for (i = 0; i < ML_N - 2u; i++) {
            const uint8_t f[] = {0, (uint8_t)(40u + i), 2, (uint8_t)i};
            request(ED_LEARN_SET, f, 4);
        }
        { const uint8_t f[] = {0, 90, 2, 40}; ok &= request(ED_LEARN_SET, f, 4) && host_wire[5] == 5u; }
        bad += check("LEARN_SET refuses CC64 / CC120, track 4, a parameter past P_COUNT (rc 1); a 17th: rc 5 (full)", ok);
    }
    {
        const uint8_t one[] = {1, 74}, all[] = {2}, odd[] = {3};
        request(ED_LEARN_SET, one, 2);
        n = request(ED_LEARN_GET, 0, 0);
        ok = learn_entry(0, 0, 0, 0, 0) && learn_entry(1, 1, 20, 1, P_PAN) && ml_count() == ML_N - 1u;
        ok &= request(ED_LEARN_SET, odd, 1) && host_wire[5] == 1u;
        request(ED_LEARN_SET, all, 1);
        ok &= host_wire[5] != 1u && host_wire[5] != 5u && !ml_count() && !favorites.factory[14][0] && !memcmp(favorites.factory[14], favorites.factory[14] + 1, 31);
        ok &= request(ED_LEARN_GET, odd, 1) == 0u;          /* (GET takes no arguments) */
        bad += check("LEARN_SET op 1 clears one CC, op 2 all; unknown ops rc 1; GET with arguments: no reply", ok);
    }
    (void)n;
    return bad;
}

/* 1.6 (#244): CUSTOM, the user's palette: PALETTE_GET / PALETTE_SET (80, 81; INFO 45 01 5), COLOR's 11th value */
static uint32_t palette_cmd(uint32_t cmd, const uint8_t *a, uint32_t n) { return request(cmd, a, n); }
/* a PALETTE_SET frame: op, then 5 x (r, g, b) */
static uint32_t pal_send(uint32_t op, const uint16_t *c)
{
    uint8_t a[16];
    uint32_t i;
    a[0] = (uint8_t)op;
    for (i = 0; i < 5u; i++) { a[1 + 3 * i] = (uint8_t)(c[i] >> 11); a[2 + 3 * i] = (uint8_t)((c[i] >> 5) & 63u); a[3 + 3 * i] = (uint8_t)(c[i] & 31u); }
    return palette_cmd(ED_PALETTE_SET, a, 16);
}
static uint16_t rgb565(uint32_t r, uint32_t g, uint32_t b) { return (uint16_t)((r >> 3) << 11 | (g >> 2) << 5 | b >> 3); }
static int custom_palette(void)
{
    int bad = 0, ok;
    uint8_t a[4] = {0};
    const uint16_t good[5] = {rgb565(8, 16, 40), rgb565(24, 32, 64), rgb565(240, 240, 255), rgb565(120, 200, 255), rgb565(255, 160, 40)};
    const uint16_t flat[5] = {rgb565(80, 80, 80), rgb565(90, 90, 90), rgb565(100, 100, 100), rgb565(110, 110, 110), rgb565(120, 120, 120)};
    uint32_t n, i;
    reset();
    n = palette_cmd(ED_PALETTE_GET, a, 0);
    ok = n == 5u + 2u + 15u + 1u && host_wire[4] == ED_PALETTE_GET && host_wire[5] == 0 && host_wire[6] == 5 &&
         host_wire[7] == (T_BG >> 11) && host_wire[8] == ((T_BG >> 5) & 63u);        /* (nothing stored: the palette in use, to start from) */
    bad += check("PALETTE_GET: none stored (flags 0), five colours: the palette in use", ok);
    ok = palette_cmd(ED_PALETTE_GET, a, 1) == 0u;
    bad += check("  PALETTE_GET takes no arguments", ok);
    n = pal_send(0, flat);
    ok = n > 0u && host_wire[5] == 0 && T_BG == flat[0] && T_TEXT == flat[2] && !(ui_cpal_flags & CPAL_STORED);
    bad += check("PALETTE_SET: colours that are hard to read are shown too (a preview: the editor warns, the device does not refuse)", ok);
    a[0] = 3; request(ED_PALETTE_SET, a, 1);
    n = pal_send(1, flat);
    ok = n > 0u && (host_wire[5] == 0 || host_wire[5] == 3) && (ui_cpal_flags & CPAL_STORED) && cpal_on() && T_BG == flat[0];
    bad += check("  and stored (op 1: rc as UI_SET, no rc 5)", ok);
    a[0] = 2; request(ED_PALETTE_SET, a, 1);
    ok = ui_cpal_flags == 0u && palette_n() == NPALETTES;
    bad += check("  a way back: op 2 removes it", ok);
    {
        uint8_t b[16] = {1, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};          /* red 32: out of range */
        ok = request(ED_PALETTE_SET, b, 16) > 0u && host_wire[5] == 1;
        b[1] = 0; b[2] = 64;                                                           /* green 64 */
        ok &= request(ED_PALETTE_SET, b, 16) > 0u && host_wire[5] == 1;
        ok &= request(ED_PALETTE_SET, b, 15) > 0u && host_wire[5] == 1;               /* (the wrong length: rc 1) */
        b[0] = 9;
        ok &= request(ED_PALETTE_SET, b, 16) > 0u && host_wire[5] == 1;               /* an unknown op */
        ok &= !(ui_cpal_flags & CPAL_STORED);
    }
    bad += check("  a value out of range, an unknown op: rc 1, nothing stored", ok);
    n = pal_send(0, good);                                                          /* the preview: gfx.c's copy only */
    ok = n > 0u && host_wire[5] == 0 && T_BG == good[0] && T_TEXT == good[2] && T_THEME == good[1] && T_REC == good[3] && T_ACCENT == good[4] &&
         ui_cpal_flags == 0u && ui_cpal[0] == 0 && palette_n() == NPALETTES;
    bad += check("PALETTE_SET op 0 (preview): the colours are shown at once, nothing is stored", ok);
    ok = T_SEL == ux_mix(good[0], good[1], UI_SEL_PCT) && T_MID == ux_mix(good[0], good[2], UI_MID_PCT) && T_INK == good[0] &&
         !ux.mono && ux.light == 0u;
    bad += check("  the other tokens derived as for any palette (SEL, MID, INK), not GREY", ok);
    a[0] = 3; n = palette_cmd(ED_PALETTE_SET, a, 1);
    ok = n > 0u && host_wire[5] == 0 && T_BG == UI_PALETTES[settings.palette].c1;
    bad += check("PALETTE_SET op 3: the preview dropped, the palette in use again", ok);
    n = pal_send(1, good);
    ok = n > 0u && host_wire[4] == ED_PALETTE_SET && (host_wire[5] == 3 || host_wire[5] == 0) && ui_cpal_flags == (CPAL_STORED | CPAL_ACTIVE | CPAL_V2) &&
         palette_cur() == NPALETTES && palette_n() == NPALETTES + 1u && T_BG == good[0] && host_wire[6] == 3 && host_wire[7] == 5;
    for (i = 0; i < 5u; i++) ok &= (uint16_t)(ui_cpal[2 * i] | ui_cpal[2 * i + 1] << 8) == good[i];
    bad += check("PALETTE_SET op 1: stored, in use (flags 3), five colours little endian in the settings' bytes", ok);
    n = palette_cmd(ED_PALETTE_GET, a, 0);
    ok = host_wire[5] == 3 && host_wire[6] == 5 && host_wire[7] == (good[0] >> 11) && host_wire[8] == ((good[0] >> 5) & 63u) &&
         host_wire[9] == (good[0] & 31u);
    bad += check("PALETTE_GET after: flags 3 and the stored colours (r5 g6 b5, three 7-bit bytes each)", ok);
    n = palette_cmd(ED_UI_PALETTES, a, 0);
    ok = n > 0u && host_wire[5] == NPALETTES + 1u && !strncmp((const char *)host_wire + 6 + 0, UI_PALETTES[0].name, 1);
    {   /* the names: each a 12-byte field (ed_str): the last one is CUSTOM */
        uint32_t pos = 6, k;
        for (k = 0; k < NPALETTES; k++) pos += (uint32_t)strlen((const char *)host_wire + pos) + 1u;
        ok &= !strcmp((const char *)host_wire + pos, "CUSTOM");
    }
    bad += check("UI_PALETTES: CUSTOM listed last while one is stored", ok);
    a[0] = 0; a[1] = NPALETTES; n = request(ED_UI_SET, a, 2);
    ok = n > 0u && host_wire[5] != 1 && palette_cur() == NPALETTES;
    a[1] = 3; request(ED_UI_SET, a, 2);
    ok &= palette_cur() == 3u && settings.palette == 3u && (ui_cpal_flags & CPAL_STORED) && !(ui_cpal_flags & CPAL_ACTIVE) &&
          T_BG == UI_PALETTES[3].c1;
    a[1] = NPALETTES; request(ED_UI_SET, a, 2);
    ok &= palette_cur() == NPALETTES && T_BG == good[0] && settings.palette == 3u;
    a[1] = NPALETTES + 1u; request(ED_UI_SET, a, 2);
    ok &= host_wire[5] == 1;
    bad += check("UI_SET 0: CUSTOM (10) selectable like a built-in palette, a built-in one leaves it stored (settings.palette the base)", ok);
    {   /* COLOR in MENU: 11 values, CUSTOM last */
        menu_item_t it;
        menu_desc(0, &it);
        ok = it.max == (int32_t)NPALETTES && it.nnames == NPALETTES + 1u && !strcmp(it.names[NPALETTES], "CUSTOM") &&
             it.value == (int32_t)NPALETTES;
        ok &= menu_set(0, 5) == 3 && palette_cur() == 5u && T_BG == UI_PALETTES[5].c1;
        ok &= menu_set(0, 99) == 3 && palette_cur() == NPALETTES && T_BG == good[0];
        bad += check("MENU COLOR: 11 values while CUSTOM is stored (CUSTOM last), MENU_SET reaches it", ok);
    }
    n = palette_cmd(ED_UI_STATE, a, 0);
    ok = n > 0u && host_wire[6] == NPALETTES;
    bad += check("UI_STATE: the palette byte is 10 while CUSTOM is in use", ok);
    a[0] = 2; n = palette_cmd(ED_PALETTE_SET, a, 1);
    ok = n > 0u && ui_cpal_flags == 0u && palette_cur() == settings.palette && palette_n() == NPALETTES && T_BG == UI_PALETTES[settings.palette].c1;
    for (i = 0; i < 10u; i++) ok &= ui_cpal[i] == 0;
    bad += check("PALETTE_SET op 2: removed (flags 0, bytes 0), the built-in palette is back, COLOR has 10 values again", ok);
    a[0] = 0; a[1] = NPALETTES; n = request(ED_UI_SET, a, 2);
    ok = host_wire[5] == 1;
    bad += check("UI_SET 0 with CUSTOM (10) but none stored: rc 1", ok);
    {   /* a settings object with the bytes round trips (settings_export / settings_import), none stored reads as none */
        persist_t p;
        pal_send(1, good);
        settings_export(&p);
        memset(&favorites, 0, sizeof favorites);
        ok = settings_import(&p, sizeof p) == 1 && ui_cpal_flags == 7u && palette_n() == NPALETTES + 1u;
        palette_apply();
        ok &= T_BG == good[0] && T_ACCENT == good[4];
        bad += check("settings: CUSTOM kept by an export and an import, in use after palette_apply", ok);
        p.favorites.factory[15][12] = 7; p.favorites.factory[15][0] = p.favorites.factory[15][4] = 0x55;   /* hard to read: kept as saved */
        p.favorites.factory[15][1] = p.favorites.factory[15][5] = 0x55;
        ok = settings_import(&p, sizeof p) == 1 && ui_cpal_flags == 7u && ui_cpal[0] == 0x55 && palette_n() == NPALETTES + 1u;
        bad += check("settings: colours that are hard to read are kept as saved (the user's choice)", ok);
        {   /* 1.6 and before: BG SURF TEXT THEME ACCENT (flags 3) is read as BG THEME TEXT <red> ACCENT, once */
            uint8_t *f = p.favorites.factory[15];
            memset(f, 0, 16);
            for (i = 0; i < 5u; i++) { f[2 * i] = (uint8_t)good[i]; f[2 * i + 1] = (uint8_t)(good[i] >> 8); }
            f[12] = 3;
            ok = settings_import(&p, sizeof p) == 1 && ui_cpal_flags == 3u;
            palette_apply();
            ok &= ui_cpal_flags == 7u && T_BG == good[0] && T_THEME == good[3] && T_TEXT == good[2] && T_ACCENT == good[4] &&
                  T_REC == UI_REC_DARK;
            palette_apply();
            ok &= T_THEME == good[3] && T_REC == UI_REC_DARK;      /* (not migrated twice) */
            bad += check("settings: a CUSTOM of 1.6 (BG SURF TEXT THEME ACCENT) is read as the five of 1.7, once", ok);
        }
        p.favorites.factory[15][12] = 0xFE;
        ok = settings_import(&p, sizeof p) == 1 && ui_cpal_flags == 0u && ui_cpal[0] == 0;
        bad += check("settings: a flags byte without the stored bit: none, the colours zero; the bits past the two dropped", ok);
    }
    return bad;
}

/* the tablet companion's commands (editor_krst.c; INFO 58 01): PERF 82, KEYMAP 83, SLICE 84, DRUMMUTE 85, CLEARALL 86,
 * and HISS through GET / SET of scope 1 */
static int krst_ext(void)
{
    int bad = 0, ok;
    uint8_t a[640] = {0}, data[256], p[12];
    uint32_t n, i, k;
    smp_user_hdr_t h;
    reset();
    n = request(ED_INFO, a, 0);
    bad += check("INFO: 58 01 caps last (PERF KEYMAP SLICE DRUMMUTE CLEARALL HISS MLEARN)",
                 host_wire[n - 10] == 0x58 && host_wire[n - 9] == 1 && host_wire[n - 8] == ED_K_CAPS && ED_K_CAPS == 127u);
    bad += check("INFO: 59 01 caps last (the USER drum kit)",
                 host_wire[n - 7] == 0x59 && host_wire[n - 6] == 1 && host_wire[n - 5] == ED_KIT_CAPS);
    bad += check("INFO: 5A 01 3 last (FM6_CHANGED, MENU_CHANGED pushes)",
                 host_wire[n - 4] == 0x5A && host_wire[n - 3] == 1 && host_wire[n - 2] == 3);

    /* PERF: query, set, echo, the audio side sees it, a bad frame is dropped, nothing stays held */
    n = request(ED_PERF, a, 0);
    ok = n == 5u + 20u + 1u && host_wire[4] == ED_PERF && !host_wire[5] && !host_wire[6] && !host_wire[7] &&
         host_wire[8] == 50 && !host_wire[9] && !host_wire[10] && !host_wire[11] && !host_wire[12] && !host_wire[13];
    bad += check("PERF: the query answers 20 bytes (nothing held, FILTER 50 = none)", ok);
    memset(p, 0, sizeof p);
    p[0] = (uint8_t)((1u << PF_R16) | (1u << PF_LPF)); p[1] = (uint8_t)(((1u << PF_R16) | (1u << PF_LPF)) >> 7);
    p[3] = 70; p[4] = 30; p[5] = 0; p[6] = 10; p[7] = 5; p[8] = 1;
    perf_k[1] = 7;                                       /* (a macro the device's own knob set) */
    n = request(ED_PERF, p, 9);
    ok = n == 26u && ed_pf == (PF_BIT(PF_R16) | PF_BIT(PF_LPF)) && perf_k[0] == 40 && perf_k[1] == 30 && perf_k[2] == 0 &&
         perf_k[3] == 10 && ed_solo == 5 && ed_fill == 1 && host_wire[5] == p[0] && host_wire[8] == 70 && host_wire[9] == 30 &&
         host_wire[12] == 5 && host_wire[13] == 1;
    bad += check("PERF: effects, macros, SOLO and FILL set and echoed", ok);
    p[4] = 0;
    request(ED_PERF, p, 9);
    bad += check("PERF: a macro the editor set goes back to 0 when sent as 0", perf_k[1] == 0);
    perf_k[2] = 9; p[5] = 0;
    request(ED_PERF, p, 9);
    bad += check("PERF: a macro the editor never set is left alone", perf_k[2] == 9);
    perf_k[2] = 0;
    perf_kill = 0; ed_pf = 0; ed_pf_seen = 0;
    ed_pf = PF_BIT(PF_GATE);
    bad += check("perform: an effect the editor holds runs (perf_begin) and is let go with FX KILL",
                 perf_begin(64) == 1 && (pf.act & PF_BIT(PF_GATE)));
    perf_kill = 1;
    perf_begin(64);
    bad += check("perform: FX KILL silences the editor's hold too", !(pf.act & PF_BIT(PF_GATE)));
    perf_kill = 0; ed_pf = 0; perf_begin(64);
    p[0] = 1; p[1] = 0; p[3] = 70; p[4] = 30; p[5] = 0; p[6] = 10;
    request(ED_PERF, p, 9);
    ed_krst_tick();
    bad += check("PERF: held while the tablet repeats it", ed_pf && ed_solo == 5 && ed_fill);
    fm1_ms += ED_K_HOLD_MS + 1u;
    ed_krst_tick();
    bad += check("PERF: 600 ms of quiet lets everything go (effects, SOLO, FILL, the macros it set)",
                 !ed_pf && !ed_solo && !ed_fill && !perf_k[0] && !perf_k[3]);
    p[2] = 16;
    bad += check("PERF: an effect bit past the effects, a short or a long frame: no reply",
                 !request(ED_PERF, p, 9) && !request(ED_PERF, p, 5) && !request(ED_PERF, p, 10));
    p[2] = 0; p[6] = 101;
    bad += check("PERF: DEPTH over 100: no reply", !request(ED_PERF, p, 9));
    p[6] = 0; p[7] = 16;
    bad += check("PERF: SOLO of a fifth track: no reply", !request(ED_PERF, p, 9));
    p[7] = 0; p[8] = 2;
    bad += check("PERF: FILL 2: no reply", !request(ED_PERF, p, 9));
    ed_krst_release();

    /* KEYMAP */
    n = request(ED_KEYMAP, a, 0);
    ok = n == 5u + 17u + 1u && !host_wire[5];
    for (k = 0; k < PF_KEYS; k++)
        ok &= host_wire[6 + k] == PF_DEF[k];
    bad += check("KEYMAP: the default map, 16 keys", ok);
    a[0] = 3; a[1] = PF_N;
    n = request(ED_KEYMAP, a, 2);
    bad += check("KEYMAP: one key set to NONE (saved or RAM only), the map follows",
                 n == 5u + 17u + 1u && host_wire[5] != 1 && host_wire[6 + 3] == PF_N &&
                 perf_map_of(fx_keys, 3) == PF_N && perf_map_of(fx_keys, 4) == PF_DEF[4]);
    a[0] = 5; a[1] = PF_CRSW;
    request(ED_KEYMAP, a, 2);
    bad += check("KEYMAP: a key set to CRUSH SWEEP", perf_map_of(fx_keys, 5) == PF_CRSW && host_wire[6 + 5] == PF_CRSW);
    a[0] = PF_KEYS; a[1] = 0;
    bad += check("KEYMAP: a key past 15: no reply", !request(ED_KEYMAP, a, 2));
    a[0] = 0; a[1] = PF_NFX;
    bad += check("KEYMAP: an effect past the list (and not NONE): no reply", !request(ED_KEYMAP, a, 2) && perf_map_of(fx_keys, 0) == PF_DEF[0]);
    a[0] = 127;
    n = request(ED_KEYMAP, a, 1);
    ok = n == 5u + 17u + 1u;
    for (k = 0; k < PF_KEYS; k++)
        ok &= host_wire[6 + k] == PF_DEF[k] && perf_map_of(fx_keys, k) == PF_DEF[k];
    bad += check("KEYMAP: 127 puts the default map back", ok);
    a[0] = 1;
    bad += check("KEYMAP: one byte other than 127: no reply", !request(ED_KEYMAP, a, 1));

    /* DRUMMUTE */
    a[0] = 1; a[1] = 0x15; a[2] = 1;
    n = request(ED_DRUMMUTE, a, 3);
    bad += check("DRUMMUTE: lanes 0 2 4 7 muted on track 2, echoed",
                 n == 5u + 3u + 1u && drum_mute[1] == 0x95u && host_wire[5] == 1 && host_wire[6] == 0x15 && host_wire[7] == 1);
    a[0] = 1;
    n = request(ED_DRUMMUTE, a, 1);
    bad += check("DRUMMUTE: the read", n == 9u && host_wire[6] == 0x15 && host_wire[7] == 1 && drum_mute[0] == 0);
    a[0] = 1; a[1] = 0; a[2] = 2;
    bad += check("DRUMMUTE: a ninth lane: no reply", !request(ED_DRUMMUTE, a, 3) && drum_mute[1] == 0x95u);
    a[0] = NTRK; a[2] = 0;
    bad += check("DRUMMUTE: a fifth track: no reply", !request(ED_DRUMMUTE, a, 3));

    /* HISS: scope 1, id G_HISS (past G_COUNT) */
    a[0] = 1; a[1] = G_HISS;
    n = request(ED_GET, a, 2);
    bad += check("HISS: GET of global G_HISS answers its value", n == 5u + 4u + 1u && host_wire[5] == 1 && host_wire[6] == G_HISS &&
                 ed_rv(host_wire + 7) == song.g[G_HISS]);
    a[2] = (8192 + 77) & 127; a[3] = (8192 + 77) >> 7;
    n = request(ED_SET, a, 4);
    bad += check("HISS: SET to 77, echoed", n == 10u && song.g[G_HISS] == 77 && ed_rv(host_wire + 7) == 77);
    a[2] = (8192 + 200) & 127; a[3] = (8192 + 200) >> 7;
    request(ED_SET, a, 4);
    bad += check("HISS: SET over the range is clamped to 127", song.g[G_HISS] == 127);
    a[1] = G_ALL;
    bad += check("HISS: a global past G_HISS: no reply", !request(ED_GET, a, 2));
    a[1] = G_HISS;
    n = request(ED_DESC, a, 2);
    bad += check("HISS: DESC answers", n > 8u);
    a[0] = 1; a[1] = G_HISS; a[2] = 0; a[3] = 64;
    request(ED_SET, a, 4);

    /* SLICE: a sample in user slot 1 (as samples() uploads it), then the slice points */
    memset(host_samples, 0, sizeof host_samples);
    for (i = 0; i < sizeof data; i++) data[i] = (uint8_t)(i * 37u);
    a[0] = 0; a[1] = 0; a[2] = 4; a[3] = 0;
    n = pack7(data, 256, a + 4) + 4u;
    request(ED_SMP_BEGIN, a, 1);
    request(ED_SMP_WRITE, a, n);
    memset(&h, 0, sizeof h); h.magic = SMP_USER_MAGIC; h.version = 1; h.nz = 1;
    h.data_len = 256; h.crc = st_crc32(data, 256); h.zone[0].n = 512; h.zone[0].le = 511;
    h.zone[0].rate = 65536; h.zone[0].hi = 127;
    a[0] = 0; n = pack7((const uint8_t *)&h, sizeof h, a + 1) + 1u;
    request(ED_SMP_END, a, n);
    memset(a, 0, sizeof a);
    a[0] = 0;
    n = request(ED_SLICE, a, 1);
    {
        const slc_src_t *s = slc_get(1);
        uint32_t len = s ? s->len : 0, cnt = n > 14u ? host_wire[11] : 0;
        ok = s && n >= 5u + 3u + 3u + 1u + 3u + 1u && !host_wire[6] && !host_wire[7] && cnt == (s ? s->nauto : 0) &&
             (uint32_t)(host_wire[8] | (host_wire[9] << 7) | (host_wire[10] << 14)) == len && len == 512u;
        bad += check("SLICE: the read of a sample (rc 0, AUTO's slices shown, man 0, its length 512)", ok);
    }
    memset(a, 0, sizeof a);
    a[0] = 0; a[1] = 3;                                  /* 3 slices, end 0: at 0, 100, 300 */
    a[5 + 3] = 100; a[5 + 6] = (uint8_t)(300 & 127); a[5 + 7] = (uint8_t)(300 >> 7);
    slc_man_save = 0;
    n = request(ED_SLICE, a, 5u + 9u);
    ok = n > 14u && !host_wire[6] && host_wire[7] == 1 && host_wire[11] == 3 && (slc_man_save & 1u) &&
         slc_man[0][slc_man_cur[0] & 1u].n == 3u && slc_man[0][slc_man_cur[0] & 1u].pos[1] == 100u &&
         slc_man[0][slc_man_cur[0] & 1u].pos[2] == 300u;
    bad += check("SLICE: three MAN slices set, read back (man 1), the slot marked for flash", ok);
    a[5 + 3] = 10;                                       /* 10 samples after the first start: closer than SLC_MIN */
    n = request(ED_SLICE, a, 5u + 9u);
    bad += check("SLICE: starts closer than the shortest slice: rc 2, the table kept",
                 n > 6u && host_wire[6] == 2 && slc_man[0][slc_man_cur[0] & 1u].pos[1] == 100u);
    a[5 + 3] = 100; a[5 + 6] = 0; a[5 + 7] = 4;          /* a start at 512: the sample's end */
    n = request(ED_SLICE, a, 5u + 9u);
    bad += check("SLICE: a start at the sample's end: rc 2", n > 6u && host_wire[6] == 2);
    memset(a, 0, sizeof a); a[0] = 1;
    n = request(ED_SLICE, a, 1);
    bad += check("SLICE: an empty slot: rc 1", n > 6u && host_wire[6] == 1);
    a[0] = SMP_USER_SLOTS;
    n = request(ED_SLICE, a, 1);
    bad += check("SLICE: a slot that does not exist: rc 1", n > 6u && host_wire[6] == 1);
    memset(a, 0, sizeof a); a[0] = 0; a[1] = 2;
    bad += check("SLICE: a count that does not match the frame: no reply", !request(ED_SLICE, a, 5u + 3u) && !request(ED_SLICE, a, 4));
    a[1] = (uint8_t)(SLC_AUTO + 1u);
    bad += check("SLICE: more than SLC_AUTO slices: no reply", !request(ED_SLICE, a, 5u + 3u * (SLC_AUTO + 1u)));
    a[1] = 0;
    n = request(ED_SLICE, a, 5);
    bad += check("SLICE: none (count 0) puts AUTO's slices back", n > 6u && !host_wire[6] && !host_wire[7] &&
                 slc_man[0][slc_man_cur[0] & 1u].n == 0u);

    /* MLEARN */
    n = request(ED_MLEARN, a, 0);
    bad += check("MLEARN: the read (off)", n == 7u && !host_wire[5] && !ui.ml.on);
    a[0] = 1;
    n = request(ED_MLEARN, a, 1);
    bad += check("MLEARN: set on (as GLO + D4), echoed", n == 7u && host_wire[5] == 1 && ui.ml.on);
    n = request(ED_MLEARN, a, 1);
    bad += check("MLEARN: set on again keeps it on (no toggle)", host_wire[5] == 1 && ui.ml.on);
    a[0] = 0;
    n = request(ED_MLEARN, a, 1);
    bad += check("MLEARN: set off", host_wire[5] == 0 && !ui.ml.on);
    a[0] = 2;
    bad += check("MLEARN: a value past 1, or two bytes: no reply", !request(ED_MLEARN, a, 1) && !request(ED_MLEARN, a, 2));

    /* CLEARALL */
    trk[0].step[0].time = 0;
    song.g[G_HISS] = 50;
    a[0] = 0;
    bad += check("CLEARALL: a wrong key byte or no byte: no reply and nothing cleared",
                 !request(ED_CLEARALL, a, 1) && !request(ED_CLEARALL, a, 0) && trk[0].step[0].time == 0 && song.g[G_HISS] == 50);
    a[0] = ED_K_CLEAR_KEY;
    n = request(ED_CLEARALL, a, 1);
    bad += check("CLEARALL: the music is a new project (steps and HISS cleared, rc 0)",
                 n == 7u && !host_wire[5] && trk[0].step[0].time == ST_REST && song.g[G_HISS] == 0 && sync_reload);
    return bad;
}

#ifndef EDITOR_TEST_NO_MAIN                              /* (robust_test.c, fuzz_*.c: this file is their base) */
/* KRST_DESC_DUMP=1: print what the editor protocol says about the engines and the globals, one line per answer, as the
 * bytes after the frame header (the tablet's mock is checked against this: tablet/desc_fw.txt, tablet/test.mjs). */
static void dump_frame(const char *tag, uint32_t a0, uint32_t a1)
{
    uint32_t i, k;
    for (k = 0; k < 200u && !(host_wire_n && host_wire[host_wire_n - 1u] == 0xF7u); k++) { ed_service(); host_drain(); }   /* (a long reply leaves over several passes) */
    printf("%s %u %u ", tag, (unsigned)a0, (unsigned)a1);
    if (host_wire_n >= 6u)
        for (i = 4; i + 1u < host_wire_n; i++) printf("%02x", host_wire[i]);
    printf("\n");
}
/* the USER drum kit for the tablet (tablet/kitdata.js, tablet/fwcheck.mjs): KRST_KIT_DATA=1 prints what the mock needs as a
 * JS module: the runs, the model kits and every lane of them as the fields hold them, each run's fields (name, range);
 * KRST_KIT_SCRIPT=1 prints a request script with the firmware's answers: K <cmd> <n> <args hex>_<reply hex> */
static void kit_data_dump(void)
{
    uint32_t k, l, f, r;
    uk_ready = 1;
    printf("// made by the firmware's host test: KRST_KIT_DATA=1 editor_test (vendor/kriechstrom/tests/editor_test.c); do not edit\n");
    printf("export const KIT = {\n  runs: [");
    for (r = 0; r < UK_NRUN; r++) printf("%s\"%s\"", r ? ", " : "", UK_RUN_NAME[r]);
    printf("],\n  seeds: [");
    for (k = 0; k < DV_NKIT; k++) printf("%s\"%s\"", k ? ", " : "", N_DRUM_KIT[DK_80 + k]);
    printf("],\n  nfields: %u,\n  /* per run, per field: [name, lo, hi] or 0 where the run does not use it */\n  meta: [\n", (unsigned)UF_N);
    for (r = 0; r < UK_NRUN; r++) {
        printf("    [");
        for (f = 0; f < UF_N; f++) {
            const uk_meta_t *m = uk_meta(UK_RUNS[r], f);
            if (m) printf("%s[\"%s\", %d, %d]", f ? ", " : "", m->name, (int)m->lo, (int)m->hi);
            else printf("%s0", f ? ", " : "");
        }
        printf("]%s\n", r + 1u < UK_NRUN ? "," : "");
    }
    printf("  ],\n  /* per model kit, per lane: every field */\n  seed: [\n");
    for (k = 0; k < DV_NKIT; k++) {
        uk_seed(k + 1u);
        printf("    [\n");
        for (l = 0; l < DV_NLANE; l++) {
            printf("      [");
            for (f = 0; f < UF_N; f++) printf("%s%d", f ? ", " : "", (int)uk_get(l, f));
            printf("]%s\n", l + 1u < DV_NLANE ? "," : "");
        }
        printf("    ]%s\n", k + 1u < DV_NKIT ? "," : "");
    }
    printf("  ],\n};\n");
}
static void kreq(uint32_t cmd, const uint8_t *a, uint32_t n)
{
    uint32_t i, k;
    request(cmd, a, n);
    for (k = 0; k < 200u && !(host_wire_n && host_wire[host_wire_n - 1u] == 0xF7u); k++) { ed_service(); host_drain(); }
    printf("K %u %u ", (unsigned)cmd, (unsigned)n);
    for (i = 0; i < n; i++) printf("%02x", a[i]);
    printf("_");
    if (host_wire_n >= 6u)
        for (i = 4; i + 1u < host_wire_n; i++) printf("%02x", host_wire[i]);
    printf("\n");
}
static void kit_script(void)
{
    uint32_t k, l, f, i, r, n;
    uint8_t a[8];
    reset();
    uks_boot();
    kreq(ED_KIT_INFO, a, 0);
    for (k = 1; k <= DV_NKIT; k++) {
        a[0] = 127; a[1] = (uint8_t)k; kreq(ED_KIT_SEED, a, 2);
        for (l = 0; l < DV_NLANE; l++) { a[0] = (uint8_t)l; kreq(ED_KIT_LANE, a, 1); }
    }
    for (r = 0; r < UK_NRUN; r++) {                      /* every run on every lane: its first design */
        for (l = 0; l < DV_NLANE; l += 3u) {
            a[0] = (uint8_t)l; a[1] = UF_RUN; a[2] = (uint8_t)((r + ED_KIT_OFS) & 127); a[3] = (uint8_t)(((r + ED_KIT_OFS) >> 7) & 127); a[4] = 0;
            kreq(ED_KIT_SET, a, 5);
        }
    }
    a[0] = 127; a[1] = 1; kreq(ED_KIT_SEED, a, 2);
    for (l = 0; l < DV_NLANE; l++) {                     /* every field of every lane at its edges and a middle, and out of its range */
        for (r = 0; r < 2u; r++) {
            if (r) { a[0] = 127; a[1] = (uint8_t)(2u + l % 7u); kreq(ED_KIT_SEED, a, 2); }
            n = uk_count(l);
            for (i = 0; i < n; i++) {
                int32_t lo, hi, v[4];
                const uk_meta_t *m;
                uint32_t j;
                f = uk_nth(l, i);
                m = uk_meta(dv_ukit[l].k.run, f);
                lo = m->lo; hi = m->hi;
                v[0] = lo - 3; v[1] = hi + 3; v[2] = (lo + hi) / 2; v[3] = hi;
                for (j = 0; j < 4u; j++) {
                    uint32_t u = (uint32_t)(v[j] + ED_KIT_OFS);
                    if (v[j] + ED_KIT_OFS < 0) u = 0;
                    a[0] = (uint8_t)l; a[1] = (uint8_t)f; a[2] = (uint8_t)(u & 127u); a[3] = (uint8_t)((u >> 7) & 127u); a[4] = (uint8_t)((u >> 14) & 127u);
                    kreq(ED_KIT_SET, a, 5);
                }
            }
            a[0] = (uint8_t)l; kreq(ED_KIT_LANE, a, 1);
        }
    }
    for (l = 0; l < DV_NLANE; l++) {                     /* a piece of another kit */
        a[0] = (uint8_t)l; a[1] = (uint8_t)(1u + (l * 3u) % DV_NKIT); a[2] = (uint8_t)((l * 5u + 1u) % DV_NLANE); kreq(ED_KIT_SEED, a, 3);
        a[0] = (uint8_t)l; kreq(ED_KIT_LANE, a, 1);
    }
    a[0] = 2; a[1] = 6; kreq(ED_KIT_SLOT, a, 2);         /* LOAD of a kit not there; a slot out of range */
    a[0] = 2; a[1] = 9; kreq(ED_KIT_SLOT, a, 2);
}
static void desc_dump(void)
{
    uint32_t e, id;
    uint8_t a[2];
    request(ED_INFO, 0, 0);
    dump_frame("I", 0, 0);
    for (e = 0; e < NENGINES; e++) {
        a[0] = (uint8_t)e; a[1] = 0;
        request(ED_PRESET, a, 2);                       /* (the selected track takes the engine: DESC answers for it) */
        {
            uint32_t k; const char *c;
            #define HX(ch) printf("%02x", (unsigned)(uint8_t)(ch))
            printf("N %u 0 ", (unsigned)e);
            HX(10); HX(e); HX(ENGINES[e]->npresets);
            for (k = 0; k < ENGINES[e]->npresets; k++) { for (c = ENGINES[e]->presets[k].name; *c; c++) HX(*c); HX(0); }
            for (k = 0; k < 2; k++) { for (c = ENGINES[e]->page_title[k]; *c; c++) HX(*c); HX(0); }
            printf("\n");
        }
        for (id = 0; id < P_COUNT; id++) {
            a[0] = 0; a[1] = (uint8_t)id;
            request(ED_DESC, a, 2);
            dump_frame("D0", e, id);
        }
    }
    for (id = 0; id < G_ALL; id++) {
        a[0] = 1; a[1] = (uint8_t)id;
        request(ED_DESC, a, 2);
        dump_frame("D1", 0, id);
    }
}

int main(void)
{
    if (getenv("KRST_DESC_DUMP")) { desc_dump(); return 0; }
    if (getenv("KRST_KIT_DATA")) { reset(); kit_data_dump(); return 0; }
    if (getenv("KRST_KIT_SCRIPT")) { kit_script(); return 0; }
    int bad = preferences() + motion_locks() + framing() + uart_recovery() + steps() + samples() + song_protocol() + malformed_saves() +
              fm6_patches() + user_preset_roundtrip() + live_sync() + kit_proto() + usb_burst() + menu_protocol() + drum_kit_retired() +
              learn_protocol() + custom_palette();
    bad += krst_ext();                                   /* (after the others: its CLEAR ALL and sample upload change what they start from) */
    printf("%s\n", bad ? "EDITOR TEST FAILED" : "editor test passed");
    return bad != 0;
}
#endif
