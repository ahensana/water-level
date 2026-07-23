import { SITE_CONFIG, type EditableSiteConfig } from "../config";
import type { AlertLevel, DerivedReading, RawWaterMonitorReading } from "../types";

/**
 * Converts a raw Firebase payload into a fully derived reading.
 *
 * Water Level = Sensor Mounting Height - Distance to Water Surface
 *
 * `siteConfig` (mount height + thresholds) is passed in rather than imported
 * as a static constant because it is user-editable at runtime (see
 * useSiteConfig) - this function must reflect whatever the operator has
 * currently configured, not a fixed default.
 */
export function deriveReading(
  raw: RawWaterMonitorReading,
  receivedAtMs: number,
  siteConfig: EditableSiteConfig,
): DerivedReading {
  const distanceM = resolveDistanceMeters(raw);

  const isSensorFault =
    !Number.isFinite(distanceM) ||
    distanceM < SITE_CONFIG.minValidDistanceM ||
    distanceM > SITE_CONFIG.maxValidDistanceM;

  const rawLevel = siteConfig.sensorMountHeightM - distanceM;
  const waterLevelM = clamp(rawLevel, 0, siteConfig.sensorMountHeightM);
  const capacityPct = clamp((waterLevelM / siteConfig.sensorMountHeightM) * 100, 0, 100);

  // Prefer a real device timestamp so "Last Updated" reflects true sensor age
  // and survives page refreshes. The current firmware publishes a human-readable
  // clock string ("24-Jun-2026 16:32:00"); older payloads used a numeric
  // timestamp_ms. Fall back to the browser receive-time when neither is present.
  const deviceTimeMs = resolveDeviceTimeMs(raw);
  const effectiveTimeMs = deviceTimeMs ?? receivedAtMs;

  return {
    distanceM,
    waterLevelM,
    capacityPct,
    alertLevel: classifyAlertLevel(capacityPct, siteConfig),
    isSensorFault,
    receivedAtMs: effectiveTimeMs,
    deviceReportedAt: formatDeviceReportedAt(raw),
    batteryVoltage:
      typeof raw.battery_voltage === "number" && Number.isFinite(raw.battery_voltage)
        ? raw.battery_voltage
        : null,
    signalStrength:
      typeof raw.signal_strength === "number" && Number.isFinite(raw.signal_strength)
        ? raw.signal_strength
        : null,
    pressureHpa: resolvePressure(raw.pressure),
    remotePressureHpa: resolvePressure(raw.remote_pressure),
  };
}

/**
 * Normalises a pressure field (hPa) to a finite positive number or null. The
 * firmware writes -1 when a sensor is unavailable (e.g. no BMP280 detected, or
 * no remote LoRa data yet), so treat non-positive values as "not reported".
 */
function resolvePressure(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolves the sensor-to-water distance in METRES from whichever field the
 * payload carries.
 *
 * The current firmware writes `distance` in CENTIMETRES, so that takes priority
 * and is converted to metres. The remaining fields are legacy metre/cm variants
 * kept for backward compatibility with older stored readings.
 */
function resolveDistanceMeters(raw: RawWaterMonitorReading): number {
  if (typeof raw.distance === "number") return raw.distance / 100;
  if (typeof raw.distance_m === "number") return raw.distance_m;
  if (typeof raw.depth_m === "number") return raw.depth_m;
  if (typeof raw.depth_cm === "number") return raw.depth_cm / 100;
  return NaN;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Resolves a device-reported time (epoch ms) from whichever timestamp field the
 * payload carries. Returns null if no parseable device time is present, so the
 * caller can fall back to the browser receive-time.
 *
 * The firmware emits the SIM800 network clock as "DD-Mon-YYYY HH:MM:SS", e.g.
 * "24-Jun-2026 16:32:00", in local network time (no timezone in the string), so
 * we parse it as local time.
 */
function resolveDeviceTimeMs(raw: RawWaterMonitorReading): number | null {
  if (typeof raw.timestamp_ms === "number" && Number.isFinite(raw.timestamp_ms)) {
    return raw.timestamp_ms;
  }

  // Current firmware: numeric Firebase server timestamp in epoch milliseconds.
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return raw.timestamp;
  }

  if (typeof raw.timestamp === "string") {
    const parsed = parseDeviceTimestamp(raw.timestamp);
    if (parsed !== null) return parsed;
  }

  return null;
}

/**
 * Builds the human-readable "device reported at" string shown in the UI. A
 * numeric epoch-ms timestamp is formatted to a locale string; a string timestamp
 * is passed through as-is; otherwise falls back to the legacy `updated_at`.
 */
function formatDeviceReportedAt(raw: RawWaterMonitorReading): string | null {
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return new Date(raw.timestamp).toLocaleString();
  }
  if (typeof raw.timestamp === "string") return raw.timestamp;
  return raw.updated_at ?? null;
}

/** Parses "DD-Mon-YYYY HH:MM:SS" (local time) into epoch ms, or null if unparseable. */
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

export function classifyAlertLevel(capacityPct: number, siteConfig: EditableSiteConfig): AlertLevel {
  if (capacityPct >= siteConfig.criticalThresholdPct) return "critical";
  if (capacityPct >= siteConfig.warningThresholdPct) return "warning";
  return "normal";
}

export function clamp(value: number, min: number, max: number): number {
  // Treat non-finite input (NaN from a missing/null Firebase field) as the
  // minimum, so derived values are always real numbers and never crash the UI.
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  normal: "Normal Level",
  warning: "Warning Level",
  critical: "Critical Level",
};

export const ALERT_LEVEL_ACTION: Record<AlertLevel, string> = {
  normal: "No action required. Continue routine monitoring.",
  warning: "Notify site operator. Prepare contingency / drawdown plan.",
  critical: "Immediate inspection required. Notify emergency response team.",
};
