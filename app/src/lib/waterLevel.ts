import { SITE_CONFIG } from "../config";
import { getCalibrationOffsetFt } from "./calibration";
import type { AlertLevel, RawWaterMonitorReading } from "../types";

/** Metres → feet (international foot). */
export const METERS_TO_FEET = 3.28084;

const MM_TO_FT = METERS_TO_FEET / 1000;

/**
 * Staff-gauge water level (ft) from A01 air-gap (mm).
 *
 * Includes the operator calibration trim, so every surface that derives a level
 * — live reading, trend chart, exports, reports — moves together. Reading the
 * trim here rather than threading it through each caller is deliberate: a level
 * that is corrected in one view and not another is worse than no correction.
 */
export function distanceToWaterLevelFt(distanceMm: number): number {
  return effectiveSensorElevationFt() - distanceMm * MM_TO_FT;
}

/**
 * Alert level at each point of a chronological level series.
 *
 * Hysteresis is path-dependent by definition — whether 3200.02 ft counts as
 * Warning depends on whether the reservoir arrived there rising or falling — so
 * a single reading cannot be classified in isolation. Replaying the series is
 * what makes the answer reproducible; it is shared rather than reimplemented so
 * that the badge on a history row and the badge on the live gauge can never
 * disagree about the same reading.
 */
export function replayAlertLevels(levelsFt: number[]): AlertLevel[] {
  const out: AlertLevel[] = [];
  let prior: AlertLevel | null = null;
  for (const level of levelsFt) {
    prior = classifyAlertLevel(level, prior);
    out.push(prior);
  }
  return out;
}

/** Air-gap (mm) that would produce a given staff-gauge level — inverse of the above. */
export function waterLevelFtToDistanceMm(waterLevelFt: number): number {
  return (effectiveSensorElevationFt() - waterLevelFt) / MM_TO_FT;
}

/**
 * Fitted sensor elevation plus any operator trim — the datum levels are
 * actually derived against, and therefore the one to display or plot.
 */
export function effectiveSensorElevationFt(): number {
  return SITE_CONFIG.sensorElevationFt + getCalibrationOffsetFt();
}

/**
 * Resolves sensor-to-water distance in MILLIMETRES.
 * Prefer the firmware `distance` (mm); convert legacy m/cm fields.
 */
export function resolveDistanceMm(raw: RawWaterMonitorReading): number {
  if (typeof raw.distance === "number") return raw.distance;
  if (typeof raw.distance_m === "number") return raw.distance_m * 1000;
  if (typeof raw.depth_m === "number") return raw.depth_m * 1000;
  if (typeof raw.depth_cm === "number") return raw.depth_cm * 10;
  return NaN;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function resolveDeviceTimeMs(raw: RawWaterMonitorReading): number | null {
  if (typeof raw.timestamp_ms === "number" && Number.isFinite(raw.timestamp_ms)) {
    return raw.timestamp_ms;
  }
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return raw.timestamp;
  }
  if (typeof raw.timestamp === "string") {
    const parsed = parseDeviceTimestamp(raw.timestamp);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function formatDeviceReportedAt(raw: RawWaterMonitorReading): string | null {
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return new Date(raw.timestamp).toLocaleString();
  }
  if (typeof raw.timestamp === "string") return raw.timestamp;
  return raw.updated_at ?? null;
}

function parseDeviceTimestamp(value: string): number | null {
  const match = value
    .trim()
    .match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, dd, mon, yyyy, hh, mm, ss] = match;
  const monthIndex = MONTHS.indexOf(mon);
  if (monthIndex === -1) return null;

  const date = new Date(
    Number(yyyy),
    monthIndex,
    Number(dd),
    Number(hh),
    Number(mm),
    Number(ss),
  );
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Alert from absolute staff-gauge level (ft) with hysteresis so values
 * flickering around a threshold do not chatter Normal↔Warning↔Critical.
 */
export function classifyAlertLevel(
  waterLevelFt: number,
  previous: AlertLevel | null = null,
): AlertLevel {
  const h = SITE_CONFIG.alertHysteresisFt;
  const warn = SITE_CONFIG.warningLevelFt;
  const crit = SITE_CONFIG.criticalLevelFt;

  if (previous === "critical") {
    if (waterLevelFt >= crit - h) return "critical";
    if (waterLevelFt >= warn - h) return "warning";
    return "normal";
  }
  if (previous === "warning") {
    if (waterLevelFt >= crit) return "critical";
    if (waterLevelFt >= warn - h) return "warning";
    return "normal";
  }

  if (waterLevelFt >= crit) return "critical";
  if (waterLevelFt >= warn) return "warning";
  return "normal";
}

/** Capacity % of full reservoir (3220 ft) for a given staff-gauge level. */
export function levelToCapacityPct(waterLevelFt: number): number {
  return clamp((waterLevelFt / SITE_CONFIG.fullCapacityFt) * 100, 0, 100);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  normal: "Normal Level",
  warning: "Warning Level",
  critical: "Critical Level",
};

/** Compact band names, for chips and dense table cells where the full label wraps. */
export const ALERT_LEVEL_SHORT: Record<AlertLevel, string> = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
};

export const ALERT_LEVEL_ACTION: Record<AlertLevel, string> = {
  normal: "No action required. Continue routine monitoring.",
  warning: `Notify site operator. Level at/above ${SITE_CONFIG.warningLevelFt} ft — prepare contingency / drawdown plan toward FRL ${SITE_CONFIG.fullCapacityFt} ft.`,
  critical: `Immediate inspection required. Level at/above ${SITE_CONFIG.criticalLevelFt} ft (FRL ${SITE_CONFIG.fullCapacityFt} ft). Notify emergency response team.`,
};
