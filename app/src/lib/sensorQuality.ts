import { SITE_CONFIG } from "../config";
import type {
  AlertLevel,
  DataQuality,
  DerivedReading,
  FaultCode,
  RawWaterMonitorReading,
  SessionHistoryPoint,
} from "../types";
import {
  METERS_TO_FEET,
  classifyAlertLevel,
  clamp,
  distanceToWaterLevelFt,
  replayAlertLevels,
  resolveDeviceTimeMs,
  resolveDistanceMm,
  formatDeviceReportedAt,
} from "./waterLevel";

export interface TimedRaw {
  raw: RawWaterMonitorReading;
  /** Prefer device timestamp; fall back supplied by caller. */
  t: number;
}

export interface QualityReport {
  quality: DataQuality;
  faultCodes: FaultCode[];
  message: string | null;
  /** Fraction of raw history points rejected (0–1). */
  rejectRate: number;
  /** Longest gap between trusted points in the loaded history (ms). */
  longestGapMs: number;
  /** Trusted points used for the live median. */
  liveSampleCount: number;
}

export interface PipelineResult {
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  report: QualityReport;
}

/**
 * End-to-end fault-tolerant pipeline:
 * 1. Resolve mm + timestamps
 * 2. Drop physically impossible distances (0, blind-zone, over-range)
 * 3. Drop impossible step changes (echo spikes / post-outage jumps)
 * 4. Median-smooth history for the chart
 * 5. Live value = median of recent trusted samples (not a single raw hit)
 */
export function processMonitorPipeline(
  rawHistory: RawWaterMonitorReading[],
  liveRaw: RawWaterMonitorReading | null,
  liveReceivedAtMs: number,
): PipelineResult {
  const now = Date.now();
  // Reject-rate, gap detection and displayed fault codes only look at this
  // recent slice — old, already-resolved problems (e.g. bench-test noise
  // from before the sensor was mounted) stay in the loaded history for the
  // trend chart/live median, but must not keep flagging current status.
  const qualityWindowStart = now - SITE_CONFIG.qualityWindowMs;

  const timed: TimedRaw[] = [];
  for (const raw of rawHistory) {
    const deviceT = resolveDeviceTimeMs(raw);
    const t = deviceT ?? null;
    if (t == null || !Number.isFinite(t) || t <= 0) continue;
    // Pre-commissioning readings are a different datum, not recoverable noise.
    if (t < SITE_CONFIG.dataStartMs) continue;
    timed.push({ raw, t });
  }
  if (liveRaw) {
    const deviceT = resolveDeviceTimeMs(liveRaw);
    const t = deviceT ?? liveReceivedAtMs;
    // Prefer including live even if already in history (dedupe by time+distance later).
    if (t >= SITE_CONFIG.dataStartMs) timed.push({ raw: liveRaw, t });
  }

  timed.sort((a, b) => a.t - b.t);

  // Dedupe identical timestamps keeping the last write.
  const deduped: TimedRaw[] = [];
  for (const row of timed) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.t - row.t) < 500) {
      deduped[deduped.length - 1] = row;
    } else {
      deduped.push(row);
    }
  }

  const faultCodes = new Set<FaultCode>();
  let rejected = 0;
  let recentTotal = 0;

  type Candidate = { t: number; distanceMm: number; raw: RawWaterMonitorReading };
  const physicalOk: Candidate[] = [];

  for (const row of deduped) {
    const isRecent = row.t >= qualityWindowStart;
    if (isRecent) recentTotal++;
    const distanceMm = resolveDistanceMm(row.raw);
    const fault = classifyDistanceFault(distanceMm);
    if (fault) {
      if (isRecent) {
        rejected++;
        faultCodes.add(fault);
      }
      continue;
    }
    physicalOk.push({ t: row.t, distanceMm, raw: row.raw });
  }

  // Rate / jump filter against the last accepted trusted point, with a
  // sustained-step escape hatch so a wrong baseline cannot latch forever.
  const trusted: Candidate[] = [];
  let pendingStep: Candidate[] = [];

  for (const c of physicalOk) {
    const prev = trusted[trusted.length - 1];
    if (!prev) {
      trusted.push(c);
      continue;
    }

    const jumpFault = classifyJumpFault(prev.distanceMm, c.distanceMm, c.t - prev.t);
    if (!jumpFault) {
      // Back in agreement with the baseline, so whatever we were holding was a
      // transient echo, not a step. Drop it.
      pendingStep = [];
      trusted.push(c);
      continue;
    }

    // Hold rejected samples rather than discarding them outright: one outlier
    // is a spike, but a long run that agrees with itself is a real step.
    pendingStep.push(c);
    if (isSustainedStep(pendingStep)) {
      trusted.push(...pendingStep);
      pendingStep = [];
      faultCodes.add("resync");
      continue;
    }

    if (c.t >= qualityWindowStart) {
      rejected++;
      faultCodes.add(jumpFault);
    }
  }

  const smoothed = medianSmooth(trusted, SITE_CONFIG.medianWindow);

  const history: SessionHistoryPoint[] = smoothed.map((c) => {
    const waterLevelFt = clamp(
      distanceToWaterLevelFt(c.distanceMm),
      0,
      SITE_CONFIG.fullCapacityFt,
    );
    return {
      t: c.t,
      distanceMm: c.distanceMm,
      waterLevelFt,
      waterLevelM: waterLevelFt / METERS_TO_FEET,
      capacityPct: clamp((waterLevelFt / SITE_CONFIG.fullCapacityFt) * 100, 0, 100),
      trusted: true,
      temperatureC: resolveFinite(c.raw.temperature),
      pressureHpa: resolvePressure(c.raw.pressure),
      batteryVoltage: resolveBattery(c.raw),
      signalStrength: resolveSignal(c.raw),
    };
  });

  /**
   * Alert level entering the live sample, obtained by replaying the whole
   * trusted history through the hysteresis rule.
   *
   * Carrying this state across React renders instead made the answer depend on
   * how long the tab had been open: a freshly loaded dashboard and one left
   * running overnight could disagree about the current alert on identical data.
   * Deriving it from the record makes the alert a pure function of the readings,
   * so every operator sees the same band and a refresh changes nothing.
   */
  const replayed = replayAlertLevels(history.map((p) => p.waterLevelFt));
  const priorAlert: AlertLevel | null = replayed.length ? replayed[replayed.length - 1] : null;

  const recentTrusted = trusted.filter((c) => c.t >= qualityWindowStart);
  const longestGapMs = longestGap(recentTrusted.map((c) => c.t));
  if (longestGapMs >= SITE_CONFIG.gapDetectMs) {
    faultCodes.add("data_gap");
  }

  const liveWindowStart = now - SITE_CONFIG.liveSampleWindowMs;
  const liveSamples = trusted.filter((c) => c.t >= liveWindowStart);
  // If clock skew puts device time ahead/behind, fall back to last N trusted.
  const samplesForLive =
    liveSamples.length >= 3 ? liveSamples : trusted.slice(-SITE_CONFIG.medianWindow);

  let reading: DerivedReading | null = null;
  if (samplesForLive.length > 0) {
    const medianMm = median(samplesForLive.map((c) => c.distanceMm));
    const anchor = samplesForLive[samplesForLive.length - 1];
    const waterLevelFt = clamp(
      distanceToWaterLevelFt(medianMm),
      0,
      SITE_CONFIG.fullCapacityFt,
    );
    const ageMs = now - anchor.t;
    const isStale = ageMs > SITE_CONFIG.offlineTimeoutMs;
    const isUnavailable = ageMs > SITE_CONFIG.readingFaultAfterMs;
    if (isStale) faultCodes.add("stale");
    if (isUnavailable) faultCodes.add("no_trusted_data");

    // An old reading must never manufacture an alarm. Once unavailable there is
    // no level to classify at all; while merely stale, hold the last known
    // classification instead of re-deriving one from data we no longer trust.
    const alertLevel = isUnavailable
      ? "normal"
      : isStale
        ? (priorAlert ?? "normal")
        : classifyAlertLevel(waterLevelFt, priorAlert);

    reading = {
      distanceMm: medianMm,
      rawDistanceMm: resolveDistanceMm(anchor.raw),
      waterLevelM: waterLevelFt / METERS_TO_FEET,
      waterLevelFt,
      capacityPct: clamp((waterLevelFt / SITE_CONFIG.fullCapacityFt) * 100, 0, 100),
      alertLevel,
      isSensorFault: isUnavailable,
      isStale,
      isSmoothed: samplesForLive.length >= 3,
      faultCodes: [...faultCodes],
      receivedAtMs: anchor.t,
      deviceReportedAt: formatDeviceReportedAt(anchor.raw),
      batteryVoltage: resolveBattery(anchor.raw),
      signalStrength: resolveSignal(anchor.raw),
      pressureHpa: resolvePressure(anchor.raw.pressure),
      temperatureC: resolveFinite(anchor.raw.temperature),
      heightM: resolveFinite(anchor.raw.height),
      remotePressureHpa: resolvePressure(anchor.raw.remote_pressure),
    };
  } else if (liveRaw) {
    // Nothing trusted — still surface a fault reading so the UI can warn.
    faultCodes.add("no_trusted_data");
    const distanceMm = resolveDistanceMm(liveRaw);
    reading = {
      distanceMm,
      rawDistanceMm: distanceMm,
      waterLevelM: 0,
      waterLevelFt: 0,
      capacityPct: 0,
      alertLevel: priorAlert ?? "normal",
      isSensorFault: true,
      isStale: true,
      isSmoothed: false,
      faultCodes: [...faultCodes],
      receivedAtMs: resolveDeviceTimeMs(liveRaw) ?? liveReceivedAtMs,
      deviceReportedAt: formatDeviceReportedAt(liveRaw),
      batteryVoltage: resolveBattery(liveRaw),
      signalStrength: resolveSignal(liveRaw),
      pressureHpa: resolvePressure(liveRaw.pressure),
      temperatureC: resolveFinite(liveRaw.temperature),
      heightM: resolveFinite(liveRaw.height),
      remotePressureHpa: resolvePressure(liveRaw.remote_pressure),
    };
  }

  const total = recentTotal || 1;
  const rejectRate = rejected / total;
  if (rejectRate > 0.25) faultCodes.add("high_reject_rate");

  const quality = resolveQuality(faultCodes, reading, rejectRate);
  const message = qualityMessage(quality, faultCodes, longestGapMs, rejectRate);

  return {
    reading,
    history,
    report: {
      quality,
      faultCodes: [...faultCodes],
      message,
      rejectRate,
      longestGapMs,
      liveSampleCount: samplesForLive.length,
    },
  };
}

export function classifyDistanceFault(distanceMm: number): FaultCode | null {
  if (!Number.isFinite(distanceMm)) return "invalid_distance";
  if (distanceMm <= 0) return "no_echo";
  if (distanceMm < SITE_CONFIG.minValidDistanceMm) return "blind_zone";
  if (distanceMm > SITE_CONFIG.maxValidDistanceMm) return "out_of_range";
  return null;
}

export function classifyJumpFault(
  prevMm: number,
  nextMm: number,
  dtMs: number,
): FaultCode | null {
  if (dtMs <= 0) return null;
  const deltaFt = Math.abs(prevMm - nextMm) * (METERS_TO_FEET / 1000);

  // Short intervals (normal ~30s cadence): judge by absolute step size only.
  // A ft/hour rate is meaningless at this timescale — the firmware's own
  // ~5-10mm sample-to-sample echo dither, extrapolated to an hourly rate,
  // blows straight past maxLevelChangeFtPerHour even though it is nowhere
  // near a real fault. Only a step bigger than the short-window cap (false
  // echo/dropout) is rejected here.
  const SHORT_WINDOW_MS = 10 * 60 * 1000;
  if (dtMs < SHORT_WINDOW_MS) {
    return deltaFt > SITE_CONFIG.maxLevelJumpFt ? "spike" : null;
  }

  // Longer gap (e.g. after an outage): a bigger absolute step can be a real
  // level change, so gate by sustained rate instead of an absolute cap.
  const hours = dtMs / 3_600_000;
  const rate = deltaFt / hours;
  return rate > SITE_CONFIG.maxLevelChangeFtPerHour ? "spike" : null;
}

/**
 * True when a run of rejected samples has held a consistent new value for
 * longer than `resyncAfterMs` — i.e. the sensor really is reading somewhere
 * new (remount, recalibration) rather than throwing a transient false echo.
 *
 * Deliberately conservative: see the `resyncAfterMs` note in SITE_CONFIG for
 * why adopting a new baseline quickly is worse than staying blind.
 */
function isSustainedStep(pending: { t: number; distanceMm: number }[]): boolean {
  if (pending.length < SITE_CONFIG.resyncMinSamples) return false;
  if (pending[pending.length - 1].t - pending[0].t < SITE_CONFIG.resyncAfterMs) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const p of pending) {
    if (p.distanceMm < min) min = p.distanceMm;
    if (p.distanceMm > max) max = p.distanceMm;
  }
  return max - min <= SITE_CONFIG.resyncSpreadMm;
}

function medianSmooth(
  points: { t: number; distanceMm: number; raw: RawWaterMonitorReading }[],
  window: number,
): { t: number; distanceMm: number; raw: RawWaterMonitorReading }[] {
  if (points.length === 0) return [];
  const w = Math.max(1, window % 2 === 1 ? window : window + 1);
  const half = Math.floor(w / 2);
  return points.map((p, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(points.length, i + half + 1);
    const slice = points.slice(from, to).map((x) => x.distanceMm);
    return { ...p, distanceMm: median(slice) };
  });
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function longestGap(times: number[]): number {
  if (times.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < times.length; i++) {
    max = Math.max(max, times[i] - times[i - 1]);
  }
  return max;
}

function resolveQuality(
  faults: Set<FaultCode>,
  reading: DerivedReading | null,
  rejectRate: number,
): DataQuality {
  if (!reading || reading.isSensorFault || faults.has("no_trusted_data")) return "fault";
  if (reading.isStale || faults.has("stale")) return "degraded";
  if (
    faults.has("data_gap") ||
    faults.has("spike") ||
    faults.has("resync") ||
    faults.has("high_reject_rate") ||
    rejectRate > 0.1
  ) {
    return "degraded";
  }
  return "good";
}

function qualityMessage(
  quality: DataQuality,
  faults: Set<FaultCode>,
  longestGapMs: number,
  rejectRate: number,
): string | null {
  if (quality === "good") return null;
  const parts: string[] = [];
  if (faults.has("no_trusted_data")) {
    parts.push(
      "Level unavailable — no trusted reading for over an hour. Alerts are suppressed. " +
        "Check A01 aim, mounting, and power.",
    );
  } else if (faults.has("stale")) {
    parts.push("Last trusted reading is stale (device may be offline); alert level is held, not re-evaluated.");
  }
  if (faults.has("resync")) {
    parts.push("Baseline re-synced after a sustained step — verify the sensor has not moved.");
  }
  if (faults.has("data_gap")) {
    const mins = Math.round(longestGapMs / 60_000);
    parts.push(`Data gap detected (~${mins} min without trusted readings).`);
  }
  if (faults.has("spike")) {
    parts.push("Unrealistic level jumps filtered (likely false echo).");
  }
  if (faults.has("blind_zone") || faults.has("no_echo")) {
    parts.push("Blind-zone / no-echo samples rejected.");
  }
  if (faults.has("high_reject_rate")) {
    parts.push(`${Math.round(rejectRate * 100)}% of samples rejected as invalid.`);
  }
  return parts.join(" ") || "Sensor data quality is degraded.";
}

function resolvePressure(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function resolveFinite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveBattery(raw: RawWaterMonitorReading): number | null {
  return typeof raw.battery_voltage === "number" && Number.isFinite(raw.battery_voltage)
    ? raw.battery_voltage
    : null;
}

function resolveSignal(raw: RawWaterMonitorReading): number | null {
  return typeof raw.signal_strength === "number" && Number.isFinite(raw.signal_strength)
    ? raw.signal_strength
    : null;
}

export const FAULT_CODE_LABEL: Record<FaultCode, string> = {
  invalid_distance: "Invalid distance",
  no_echo: "No echo (0 mm)",
  blind_zone: "Blind zone (<280 mm)",
  out_of_range: "Out of range",
  spike: "Unrealistic jump",
  data_gap: "Data gap",
  stale: "Stale reading",
  no_trusted_data: "No trusted data",
  high_reject_rate: "High reject rate",
  resync: "Baseline re-synced",
};
