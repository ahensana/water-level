/**
 * Site calibration for the MeECL reservoir staff-gauge / A01 ultrasonic pair.
 *
 * The field logbook records water level in FEET (e.g. 3197.27 ft), read hourly
 * off the staff gauge. The A01 publishes air-gap distance in mm.
 *
 *   waterLevelFt = sensorElevationFt − (distanceMm / 1000) × 3.28084
 *
 * Sensor elevation is fitted as `loggedLevelFt + distanceMm × (3.28084 / 1000)`
 * against the register pages in `RealDataFromSite/`. Re-fitted 7 Oct 2026.
 *
 * THE MOUNT IS NOT HOLDING. Four different elevations fit four periods:
 *   5 Aug - 1 Sep  3212.16 ft   9 steady days
 *   11 - 16 Sep    3204.73 ft   1 steady day
 *   28 Sep         3209.04 ft   1 steady hour
 *   6 - 7 Oct      3208.75 ft   22 steady hours   <- in use
 * and the days between never agreed either (21 Sep implies 3205.7, 25 Sep
 * 3205.0). The register moved 0.24 ft across 27-28 Sep while the sensor's
 * air gap moved 4.3 ft, so this is the sensor shifting, not the reservoir.
 *
 * The 6-7 Oct fit is the best this mount has had: 22 register hours from
 * 10 AM 6 Oct to 10 AM 7 Oct, implied elevation 3208.72-3208.79 ft (std
 * 0.017 ft), and the sensor's hour-to-hour movement tracks the register to
 * 3 mm on average. Between 28 Sep and it the feed was erratic (30 Sep - 2 Oct,
 * 340-2900 mm within single hours) and then silent until 5 Oct, so the sensor
 * was likely disturbed again; it is treated as a new epoch, not a correction
 * to the 28 Sep one.
 *
 * Treat the constant as a running correction for a mount that keeps moving,
 * not as a calibration. It is right the day it is fitted and drifts after.
 * The fix is mechanical: until the sensor is fixed in place and aimed at open
 * water, every re-fit here buys days, not months. If moving it becomes
 * routine, replace this constant with dated calibration epochs so old
 * readings keep displaying correctly instead of being cut off by
 * `dataStartMs` each time.
 *
 * The 28 Sep fit: 84 readings between 14:00 and 14:38 IST holding
 * 1973-1991 mm (spread 23 mm), against a register interpolated from 12 noon
 * (3202.51 ft, rising ~0.01 ft/h). One hour is thin evidence — re-fit from
 * the next full steady day.
 *
 * WHAT CAME BEFORE. The sensor also moved between 1 and 11 Sep 2026: the
 * gauge held at ~3201.3 ft
 * across that gap while the air gap fell from 3265 mm (1 Sep) to ~888 mm
 * (11 Sep) — 7.4 ft of apparent rise that the register does not record. The
 * old constant, 3212.16, therefore read ~7.4 ft high on every reading after
 * the move; the dashboard was showing 3209 ft against a gauge reading 3202.
 * Readings before the move are on the old datum and are excluded entirely
 * (see `dataStartMs`), because one constant cannot serve both.
 *
 * The post-move fit rests on 16 Sep 2026, the only day since with a full,
 * steady feed: 2212 readings, 18 logged hours, air gap holding 1114-1115 mm
 * (hour-to-hour spread 0-5 mm). Its implied elevation is 3204.73 ft, spread
 * 0.15 ft across the day. Against all 31 usable September hours the median
 * error is 0.00 ft; across the 19 hours where the sensor itself was steady
 * (15-minute spread ≤ 60 mm) the std is 0.26 ft and the worst 0.61 ft.
 *
 * THAT IS NOT A HEALTHY CALIBRATION, and no constant can fix what is wrong.
 * Over all September hours the std is 1.14 ft and the worst 4.4 ft, because
 * on 11, 21 and 25 Sep the sensor returned several different distances for
 * the same water: 883/904 mm and 2820 mm within twenty minutes on 25 Sep,
 * against ~805 mm expected. Those are false echoes, not level changes. Until
 * the mount and aim are fixed and a full day of steady readings comes back,
 * treat this constant as the best available, not as verified: re-fit from the
 * next clean day (tools/README.md) rather than trusting these residuals.
 *
 * Two known residual effects, deliberately NOT corrected here:
 *  - A repeating ~36 mm (0.119 ft) daily oscillation peaking 17:00-19:00 IST
 *    that the manual log does not show. It is not thermal (correlation with
 *    the onboard BMP280 is r≈0.09, R²≈0.003 across a 22-35 °C span, and the
 *    A01NYUB compensates internally), so no speed-of-sound term is applied.
 *    It is surfaced instead — see `computeDiurnalProfile`.
 *  - The register is written to 0.01 ft (3 mm) in long monotone runs, finer
 *    than a staff gauge resolves in moving water, so some entries are likely
 *    interpolated. Chasing residuals below ~0.05 ft is fitting to noise.
 *
 * Full capacity (FRL / 100%) is the site total of 3220 ft.
 */
export const SITE_CONFIG = {
  /** Full reservoir level — 100% capacity on the staff gauge (ft). */
  fullCapacityFt: 3220,

  /**
   * Elevation of the A01 sensor face on the same staff-gauge datum (ft), as
   * fitted for the CURRENT mount position (7 Oct 2026, 978.03 m).
   *
   * Use this only for "what is the sensor set to now" — the QA card, the
   * report header, the trend chart's axis. Converting a stored reading goes
   * through `distanceToWaterLevelFt(mm, atMs)`, which picks the elevation that
   * was true when the reading was taken: see CALIBRATION_EPOCHS below.
   */
  sensorElevationFt: 3208.75,

  /** Warning band begins at this staff-gauge level (ft). */
  warningLevelFt: 3200,

  /** Critical band begins at this staff-gauge level (ft). */
  criticalLevelFt: 3210,

  /**
   * A01NYUB blind zone / minimum reliable echo (mm).
   * Firmware often reports 0 or ~250 on no-echo — those are faults, not levels.
   */
  minValidDistanceMm: 280,

  /** Maximum plausible A01 distance (mm). */
  maxValidDistanceMm: 6500,

  /** Legacy metre aliases used only by older helpers. */
  minValidDistanceM: 0.28,
  maxValidDistanceM: 6.5,

  /** Device Offline if no *trusted* reading within this window (ms). */
  offlineTimeoutMs: 90_000,

  /**
   * Readings before this instant are ignored entirely.
   *
   * The A01 was bench-tested and repositioned before going live, so RTDB still
   * holds days of readings taken while it was pointed at something other than
   * the reservoir (600-1600 mm air gaps against a real ~4200 mm). Those are not
   * "noise" the fault filters can reason about — they are a different datum,
   * and letting them into the trend chart, diurnal profile or reliability
   * calendar corrupts all three.
   *
   * Back to 5 Aug 2026, the whole commissioned record. It was cut forward
   * twice while a single constant had to serve every reading; now that each
   * period carries its own (CALIBRATION_EPOCHS), August displays on the
   * August datum and today on today's, so nothing needs discarding.
   *
   * What stays excluded is genuinely different: bench testing before the
   * sensor was first mounted, when it was pointed at something other than the
   * reservoir. There is no elevation that makes those readings mean anything.
   */
  dataStartMs: Date.parse("2026-08-05T00:00:00+05:30"),

  /**
   * After this long with no trusted reading, the level is reported as
   * unavailable (`isSensorFault`) rather than shown as a live number.
   *
   * Below this the last trusted value is still displayed — a reservoir moving
   * ~0.01 ft/hour does not become meaningless because a GSM upload was missed —
   * but it is badged stale and, critically, cannot raise a NEW alert (see the
   * stale branch in `processMonitorPipeline`). Before this existed, a feed that
   * stopped on 31 Jul left the dashboard showing a frozen 3206.44 ft with a
   * standing Warning for two days while the gauge read 3196.9.
   */
  readingFaultAfterMs: 60 * 60 * 1000,

  /**
   * Sustained-step ("resync") detection — the escape hatch for the jump filter.
   *
   * `classifyJumpFault` compares each sample against the last ACCEPTED one, so
   * if the accepted baseline is ever wrong, every correct sample that follows
   * looks like a spike and is discarded — the filter latches and can never
   * recover on its own. That is what froze the dashboard at 3210.92 ft
   * ("Critical") for 17 hours on 3-4 Aug.
   *
   * The escape hatch has to be slow on purpose. A 40-minute false echo looks
   * exactly like a real step for its first 40 minutes, and adopting one that
   * reads NEARER than the truth manufactures a high-level alarm. So a new
   * baseline is adopted only after readings have agreed with each other,
   * continuously, for longer than any dropout observed in the 1-13 Aug record
   * (the worst was ~40 min). Genuine steps are remounts and recalibrations,
   * which persist indefinitely and can afford to wait an hour.
   */
  resyncAfterMs: 60 * 60 * 1000,

  /** Rejected samples must agree within this to count as a sustained step (mm). */
  resyncSpreadMm: 40,

  /** ...and there must be at least this many of them. */
  resyncMinSamples: 20,

  /**
   * Max realistic staff-gauge change rate (ft/hour). Reservoirs do not jump
   * 0.2 ft in seconds — larger steps are treated as echo/mount faults.
   */
  maxLevelChangeFtPerHour: 0.5,

  /** Absolute jump rejected even if rate limit would allow it (ft). */
  maxLevelJumpFt: 0.12,

  /** Median window (odd) for live + history smoothing. */
  medianWindow: 5,

  /** Gap in trusted data longer than this is flagged (ms). */
  gapDetectMs: 15 * 60 * 1000,

  /**
   * How far back "current device health" looks when computing reject rate,
   * gap detection and displayed fault codes (ms). History further back than
   * this still feeds the trend chart/live median, but stale problems from
   * old data (e.g. bench-test noise from before the sensor was mounted)
   * should not keep the status banner "degraded" forever just because they
   * are still sitting in the loaded history window.
   */
  qualityWindowMs: 3 * 60 * 60 * 1000,

  /** How far back to look when picking a live median (ms). */
  liveSampleWindowMs: 5 * 60 * 1000,

  /** Alert exit hysteresis (ft) so levels don't flicker at thresholds. */
  alertHysteresisFt: 0.05,

  /** Firebase RTDB path for live readings (push-keyed children under current). */
  firebaseDataPath: "water_monitor/current",

  /**
   * Provenance of `sensorElevationFt`, for the QA card and the operations PDF.
   *
   * Lives here rather than as literals in each surface: these numbers were
   * previously duplicated in two components and silently went stale the moment
   * the constant was re-fitted, so the dashboard quoted a calibration basis
   * that no longer matched the calibration it was using.
   *
   * Regenerate with `npx tsx tools/pipelineCheck.ts` after any re-fit.
   */
  calibration: {
    basis: "22 hourly register entries, 10 AM 6 Oct - 10 AM 7 Oct 2026",
    /** Median app-vs-logbook error at this constant (ft), over the fitted window. */
    medianErrorFt: 0.001,
    /** Std. dev. of that error (ft), from the pipeline replay over the fitted window. */
    residualStdFt: 0.018,
    /**
     * Repeating daily oscillation the logbook does not record (ft). Measured
     * on the August record; not yet re-measured since the sensor moved, as no
     * clean multi-day feed exists after it.
     */
    diurnalSwingFt: 0.119,
    /**
     * Worst single deviation from the register across the calibration window
     * (ft), from the app pipeline replay. Small because the window is one
     * steady day: measured across a mount that has moved three times since
     * August, the figure that matters is that drift, not this one.
     * Verification against the gauge is expected to
     * FAIL at the 0.3 ft `crossCheckToleranceFt` whenever it moves again —
     * that failure is the sensor's, and the tolerance should not be widened
     * to hide it.
     */
    worstDeviationFt: 0.04,
  },

  /**
   * Acceptance tolerance when verifying the sensor against the manual gauge (ft).
   *
   * Judged on the WORST deviation across the entered readings, not the average:
   * a mean inside tolerance says nothing useful if individual hours sit well
   * outside it. 0.3 ft is comfortably above the two irreducible error sources —
   * the ~0.119 ft daily oscillation the register does not record, and the 0.01 ft
   * write resolution of a staff gauge read by eye in moving water — while still
   * being tight enough to catch a mount that has shifted or silted up.
   */
  crossCheckToleranceFt: 0.3,
} as const;

/**
 * Sensor elevation by period — the datum each stored reading was taken on.
 *
 * The mount has moved twice (see the note at the top of this file), and a
 * reading is only meaningful against the elevation that was true when it was
 * recorded. With a single constant the only honest option was to cut the
 * record at every re-fit, which threw away August to show September. Each
 * period keeps its own constant instead, so the whole series displays
 * correctly and a re-fit stops destroying history.
 *
 * Entries are ordered oldest first, and each applies from `fromMs` until the
 * next one begins. Boundaries are placed inside the outages that separate the
 * periods — the sensor was silent 1-11 Sep and 25-28 Sep — so no reading sits
 * near a boundary where the wrong constant might be picked.
 *
 * Adding an epoch: fit against the register (tools/README.md), append the
 * entry, and update `sensorElevationFt` above to the new value. Do not edit a
 * past entry unless its own fit was wrong; changing it rewrites history that
 * has already been exported and filed.
 */
export const CALIBRATION_EPOCHS = [
  {
    fromMs: Date.parse("2026-08-05T00:00:00+05:30"),
    elevationFt: 3212.16,
    note: "Original mount. Fitted over 9 steady days, 5-13 Aug; day-to-day spread 0.17 ft.",
  },
  {
    fromMs: Date.parse("2026-09-11T00:00:00+05:30"),
    elevationFt: 3204.73,
    note: "After the first move. Fitted on 16 Sep, the only steady day in the period.",
  },
  {
    fromMs: Date.parse("2026-09-26T00:00:00+05:30"),
    elevationFt: 3209.04,
    note: "After the second move. Fitted on 84 readings, 14:00-14:38 IST on 28 Sep.",
  },
  {
    fromMs: Date.parse("2026-10-03T00:00:00+05:30"),
    elevationFt: 3208.75,
    note: "After the 30 Sep - 2 Oct disturbance. Fitted on 22 register hours, 10 AM 6 Oct - 10 AM 7 Oct.",
  },
] as const;

export const ORG_INFO = {
  name: "Meghalaya Energy Corporation Limited",
  shortName: "MeECL",
  tagline: "A Government of Meghalaya Undertaking",
  projectName: "Water Level Monitoring System",
  version: "v1.1.0",
  supportEmail: "support@meecl.in",
  supportPhone: "+91 364 222 2222",
} as const;

/**
 * Tuning for the derived analytics layer (trend/forecast, device health,
 * quality breakdown) — separate from SITE_CONFIG's calibration/fault
 * thresholds so the two concerns don't get tangled.
 */
export const ANALYTICS_CONFIG = {
  /** Lookback window for the rate-of-change regression (ms). */
  trendWindowMs: 2 * 60 * 60 * 1000,

  /** Minimum trusted points required before a trend is reported at all. */
  trendMinPoints: 6,

  /** Minimum time span the points must cover before trusting a slope (ms). */
  trendMinSpanMs: 20 * 60 * 1000,

  /**
   * |rate| below this is reported as "Stable" rather than rising/falling —
   * keeps normal sub-mm/hour noise from reading as a false trend.
   */
  stableRateFtPerHour: 0.01,

  /** Longest threshold-crossing ETA worth displaying; beyond this, omit it. */
  maxProjectionMs: 30 * 24 * 60 * 60 * 1000,

  /**
   * Firmware upload cadence (ms) — used to estimate expected reading count /
   * completeness % over a period. Matches UPLOAD_INTERVAL_MS in the firmware.
   */
  expectedSampleIntervalMs: 30_000,

  /** Battery voltage bands (V) — Low/Critical mirror the existing SensorCard threshold. */
  batteryNormalV: 3.7,
  batteryLowV: 3.5,

  /** GSM CSQ (0-31) bands — standard AT+CSQ interpretation. */
  signalExcellentCsq: 20,
  signalGoodCsq: 15,
  signalFairCsq: 10,

  /**
   * Surface disturbance bands (mm) — std. dev. of raw (pre-median) distance
   * samples over `surfaceDisturbanceWindowMs`. Thresholds are a heuristic
   * grounded in what normal vs. faulty scatter actually looked like in the
   * 4-6 Aug live feed: routine echo dither sat at 1-9 mm; the two confirmed
   * echo-dropout faults jumped >600 mm. Calm/Moderate/Rough describes how
   * choppy the water surface currently is, not a fault state on its own —
   * `classifyJumpFault` already screens outright faults out of the level.
   */
  surfaceDisturbanceWindowMs: 15 * 60 * 1000,
  surfaceCalmMm: 5,
  surfaceModerateMm: 15,

  /** How many trailing calendar days the reliability calendar displays. */
  reliabilityCalendarDays: 14,
} as const;
