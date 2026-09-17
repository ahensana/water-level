/**
 * Site calibration for the MeECL reservoir staff-gauge / A01 ultrasonic pair.
 *
 * The field logbook records water level in FEET (e.g. 3197.27 ft), read hourly
 * off the staff gauge. The A01 publishes air-gap distance in mm.
 *
 *   waterLevelFt = sensorElevationFt − (distanceMm / 1000) × 3.28084
 *
 * Sensor elevation is fitted as `loggedLevelFt + distanceMm × (3.28084 / 1000)`
 * against the register pages in `RealDataFromSite/`. Re-fitted 13 Aug 2026 over
 * 1-13 Aug (see tools/README.md to reproduce). Restricting to days the sensor
 * has been in its final mounted position, the implied elevation per day is:
 *   6 Aug 3212.23 · 7 Aug 3212.25 · 8 Aug 3212.17 · 9 Aug 3212.17
 *   10 Aug 3212.08 · 11 Aug 3212.13 · 12 Aug 3212.17 · 13 Aug 3212.19
 * Median 3212.16, day-to-day spread 0.17 ft. The previous 3212.21 came from a
 * 3-day fit that included the post-remount settling window and read ~0.05 ft
 * high against every subsequent day.
 *
 * Replaying the live pipeline against 123 logged hours from 7-13 Aug at this
 * constant gives a median error of ~0.00 ft, std 0.055 ft, all points within
 * 0.25 ft.
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
   * Elevation of the A01 sensor face on the same staff-gauge datum (ft).
   * Median of the per-day fits above across 1-13 Aug 2026 (979.06 m).
   */
  sensorElevationFt: 3212.16,

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
   * calendar corrupts all three. The sensor reached its final mounted position
   * on the evening of 4 Aug 2026.
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
    basis: "161 hourly staff-gauge points, 9 days (5-13 Aug 2026)",
    /** Median app-vs-logbook error at this constant (ft). */
    medianErrorFt: -0.013,
    /** Std. dev. of that error (ft). */
    residualStdFt: 0.063,
    /** Repeating daily oscillation the logbook does not record (ft). */
    diurnalSwingFt: 0.119,
    /**
     * Worst single deviation from the register across the calibration window
     * (ft), from `npx tsx tools/intervalReportCheck.ts`. This is the figure the
     * `crossCheckToleranceFt` acceptance limit is set against.
     */
    worstDeviationFt: 0.16,
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
