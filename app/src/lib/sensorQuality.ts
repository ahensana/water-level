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
  previousAlert: AlertLevel | null,
): PipelineResult {
  const timed: TimedRaw[] = [];
  for (const raw of rawHistory) {
    const deviceT = resolveDeviceTimeMs(raw);
    const t = deviceT ?? null;
    if (t == null || !Number.isFinite(t) || t <= 0) continue;
    timed.push({ raw, t });
  }
  if (liveRaw) {
    const deviceT = resolveDeviceTimeMs(liveRaw);
    const t = deviceT ?? liveReceivedAtMs;
    // Prefer including live even if already in history (dedupe by time+distance later).
    timed.push({ raw: liveRaw, t });
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

  type Candidate = { t: number; distanceMm: number; raw: RawWaterMonitorReading };
  const physicalOk: Candidate[] = [];

  for (const row of deduped) {
    const distanceMm = resolveDistanceMm(row.raw);
    const fault = classifyDistanceFault(distanceMm);
    if (fault) {
      rejected++;
      faultCodes.add(fault);
      continue;
    }
    physicalOk.push({ t: row.t, distanceMm, raw: row.raw });
  }

  // Rate / jump filter against last accepted trusted point.
  const trusted: Candidate[] = [];
  for (const c of physicalOk) {
    const prev = trusted[trusted.length - 1];
    if (prev) {
      const jumpFault = classifyJumpFault(prev.distanceMm, c.distanceMm, c.t - prev.t);
      if (jumpFault) {
        rejected++;
        faultCodes.add(jumpFault);
        continue;
      }
    }
    trusted.push(c);
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
    };
  });

  const longestGapMs = longestGap(trusted.map((c) => c.t));
  if (longestGapMs >= SITE_CONFIG.gapDetectMs) {
    faultCodes.add("data_gap");
  }

  const now = Date.now();
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
    const alertLevel = classifyAlertLevel(waterLevelFt, previousAlert);
    const ageMs = now - anchor.t;
    const isStale = ageMs > SITE_CONFIG.offlineTimeoutMs;
    if (isStale) faultCodes.add("stale");

    reading = {
      distanceMm: medianMm,
      rawDistanceMm: resolveDistanceMm(anchor.raw),
      waterLevelM: waterLevelFt / METERS_TO_FEET,
      waterLevelFt,
      capacityPct: clamp((waterLevelFt / SITE_CONFIG.fullCapacityFt) * 100, 0, 100),
      alertLevel,
      isSensorFault: false,
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
      alertLevel: previousAlert ?? "normal",
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

  const total = deduped.length || 1;
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
  const hours = dtMs / 3_600_000;

  // Absolute jump cap only for short intervals (false echoes within minutes).
  // After a long outage, a larger step can be a real level change — use rate only.
  const SHORT_WINDOW_MS = 10 * 60 * 1000;
  if (dtMs < SHORT_WINDOW_MS && deltaFt > SITE_CONFIG.maxLevelJumpFt) {
    return "spike";
  }

  const rateHours = Math.max(hours, 1 / 60);
  const rate = deltaFt / rateHours;
  if (rate > SITE_CONFIG.maxLevelChangeFtPerHour) return "spike";
  return null;
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
  if (faults.has("data_gap") || faults.has("spike") || faults.has("high_reject_rate") || rejectRate > 0.1) {
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
    parts.push("No trusted sensor readings — check A01 aim, mounting, and power.");
  }
  if (faults.has("stale")) {
    parts.push("Last trusted reading is stale (device may be offline).");
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
};
