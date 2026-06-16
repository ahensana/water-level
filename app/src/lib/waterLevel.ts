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
  // and survives page refreshes. Fall back to the browser receive-time only
  // when the device hasn't published a numeric timestamp_ms yet.
  const hasDeviceTime =
    typeof raw.timestamp_ms === "number" && Number.isFinite(raw.timestamp_ms);
  const effectiveTimeMs = hasDeviceTime ? (raw.timestamp_ms as number) : receivedAtMs;

  return {
    distanceM,
    waterLevelM,
    capacityPct,
    alertLevel: classifyAlertLevel(capacityPct, siteConfig),
    isSensorFault,
    receivedAtMs: effectiveTimeMs,
    deviceReportedAt: raw.updated_at ?? null,
  };
}

/** Accepts either depth_m (preferred) or depth_cm (legacy field) from the device payload. */
function resolveDistanceMeters(raw: RawWaterMonitorReading): number {
  if (typeof raw.depth_m === "number") return raw.depth_m;
  if (typeof raw.depth_cm === "number") return raw.depth_cm / 100;
  return NaN;
}

export function classifyAlertLevel(capacityPct: number, siteConfig: EditableSiteConfig): AlertLevel {
  if (capacityPct >= siteConfig.criticalThresholdPct) return "critical";
  if (capacityPct >= siteConfig.warningThresholdPct) return "warning";
  return "normal";
}

export function clamp(value: number, min: number, max: number): number {
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
