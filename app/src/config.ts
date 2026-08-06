/**
 * Site calibration for the MeECL reservoir staff-gauge / A01 ultrasonic pair.
 *
 * Field logbooks (4 Aug & 6 Aug 2026) record water level in FEET (e.g. 3197.27 ft).
 * The A01 publishes air-gap distance in millimetres.
 *
 *   waterLevelFt = sensorElevationFt − (distanceMm / 1000) × 3.28084
 *
 * Sensor elevation was fitted to the 6 Aug hourly log (std ≈ 0.07 ft).
 * Full capacity (FRL / 100%) is the site total of 3220 ft.
 */
export const SITE_CONFIG = {
  /** Full reservoir level — 100% capacity on the staff gauge (ft). */
  fullCapacityFt: 3220,

  /**
   * Elevation of the A01 sensor face on the same staff-gauge datum (ft).
   * Calibrated 6 Aug 2026: mean offset vs field log ≈ 3212.11 ft (979.05 m).
   */
  sensorElevationFt: 3212.11,

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

  /** How far back to look when picking a live median (ms). */
  liveSampleWindowMs: 5 * 60 * 1000,

  /** Alert exit hysteresis (ft) so levels don't flicker at thresholds. */
  alertHysteresisFt: 0.05,

  /** Firebase RTDB path for live readings (push-keyed children under current). */
  firebaseDataPath: "water_monitor/current",
} as const;

export const ORG_INFO = {
  name: "Meghalaya Energy Corporation Limited",
  shortName: "MeECL",
  projectName: "Water Level Monitoring System",
  version: "v1.1.0",
  supportEmail: "support@meecl.in",
  supportPhone: "+91 364 222 2222",
} as const;
