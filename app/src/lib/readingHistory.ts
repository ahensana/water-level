import { processMonitorPipeline } from "./sensorQuality";
import { ALERT_LEVEL_LABEL, replayAlertLevels } from "./waterLevel";
import { formatIst } from "./csvExport";
import type { SheetSpec } from "./excelExport";
import type { AlertLevel, RawWaterMonitorReading, SessionHistoryPoint } from "../types";

/** A trusted reading with the alert band it fell in. */
export interface TrustedReading extends SessionHistoryPoint {
  alertLevel: AlertLevel;
}

export interface HistoryFilters {
  /** Bands to include. An empty set means "all" rather than "none". */
  alertLevels: AlertLevel[];
  minLevelFt: number | null;
  maxLevelFt: number | null;
  /** Local hour-of-day window, inclusive. Wraps when `from > to`. */
  fromHour: number | null;
  toHour: number | null;
  sort: "newest" | "oldest";
}

export const DEFAULT_FILTERS: HistoryFilters = {
  alertLevels: [],
  minLevelFt: null,
  maxLevelFt: null,
  fromHour: null,
  toHour: null,
  sort: "newest",
};

/**
 * The trusted reading series for a set of raw readings, annotated with alert
 * bands.
 *
 * Runs the real `processMonitorPipeline`, not a re-implementation, so this view
 * shows exactly the readings the dashboard trusts — same physical validation,
 * same jump filter, same median smoothing. A history browser that applied its
 * own rules would be worse than none: it would look authoritative while
 * disagreeing with the gauge it is meant to explain.
 *
 * The pipeline's live-reading and quality outputs are `Date.now()`-relative and
 * meaningless for a historical window, so they are discarded; the trusted series
 * itself is derived only from the readings and is safe to use for any period.
 */
export function buildTrustedHistory(readings: RawWaterMonitorReading[]): TrustedReading[] {
  const { history } = processMonitorPipeline(readings, null, 0);
  const levels = replayAlertLevels(history.map((p) => p.waterLevelFt));
  return history.map((point, i) => ({ ...point, alertLevel: levels[i] }));
}

export function filterTrustedHistory(
  rows: TrustedReading[],
  filters: HistoryFilters,
): TrustedReading[] {
  const bands = filters.alertLevels;
  const filtered = rows.filter((row) => {
    if (bands.length > 0 && !bands.includes(row.alertLevel)) return false;
    if (filters.minLevelFt !== null && row.waterLevelFt < filters.minLevelFt) return false;
    if (filters.maxLevelFt !== null && row.waterLevelFt > filters.maxLevelFt) return false;
    if (filters.fromHour !== null && filters.toHour !== null) {
      const hour = new Date(row.t).getHours();
      // A night shift spans midnight, so the window has to be allowed to wrap.
      const inWindow =
        filters.fromHour <= filters.toHour
          ? hour >= filters.fromHour && hour <= filters.toHour
          : hour >= filters.fromHour || hour <= filters.toHour;
      if (!inWindow) return false;
    }
    return true;
  });
  // `history` arrives oldest-first; only copy when reversing.
  return filters.sort === "newest" ? filtered.slice().reverse() : filtered;
}

export function isFilterActive(filters: HistoryFilters): boolean {
  return (
    filters.alertLevels.length > 0 ||
    filters.minLevelFt !== null ||
    filters.maxLevelFt !== null ||
    (filters.fromHour !== null && filters.toHour !== null)
  );
}

export interface HistorySummary {
  count: number;
  minFt: number;
  maxFt: number;
  medianFt: number;
  firstMs: number;
  lastMs: number;
  bandCounts: Record<AlertLevel, number>;
}

export function summarizeHistory(rows: TrustedReading[]): HistorySummary | null {
  if (rows.length === 0) return null;
  const levels = rows.map((r) => r.waterLevelFt).sort((a, b) => a - b);
  const times = rows.map((r) => r.t);
  const bandCounts: Record<AlertLevel, number> = { normal: 0, warning: 0, critical: 0 };
  for (const row of rows) bandCounts[row.alertLevel]++;
  return {
    count: rows.length,
    minFt: levels[0],
    maxFt: levels[levels.length - 1],
    medianFt: levels[levels.length >> 1],
    firstMs: Math.min(...times),
    lastMs: Math.max(...times),
    bandCounts,
  };
}

const CSV_COLUMNS = [
  "timestamp_utc_iso",
  "timestamp_ist",
  "distance_mm",
  "water_level_ft",
  "water_level_m",
  "capacity_pct",
  "alert_level",
  "temperature_c",
  "pressure_hpa",
  "battery_v",
  "signal_csq",
] as const;

/** Official-record CSV of the filtered trusted history. */
export function trustedHistoryToCsv(rows: TrustedReading[]): string {
  const lines = rows.map((r) =>
    [
      new Date(r.t).toISOString(),
      formatIst(r.t),
      Math.round(r.distanceMm),
      r.waterLevelFt.toFixed(3),
      r.waterLevelM.toFixed(3),
      r.capacityPct.toFixed(2),
      r.alertLevel,
      r.temperatureC ?? "",
      r.pressureHpa ?? "",
      r.batteryVoltage ?? "",
      r.signalStrength ?? "",
    ].join(","),
  );
  return [CSV_COLUMNS.join(","), ...lines].join("\r\n");
}

/**
 * The same record as `trustedHistoryToCsv`, described for Excel.
 *
 * Headers carry their units and values stay numeric, so a filed workbook can be
 * sorted, totalled and charted without anyone retyping it. Kept beside the CSV
 * definition so the two cannot drift into disagreeing about what a column means.
 */
export function trustedHistorySheet(
  rows: TrustedReading[],
  notes: string[] = [],
): SheetSpec<TrustedReading> {
  return {
    sheetName: "Trusted readings",
    notes,
    rows,
    columns: [
      { header: "Time (IST)", value: (r) => formatIst(r.t), align: "left" },
      { header: "Time (UTC)", value: (r) => new Date(r.t).toISOString(), align: "left" },
      { header: "Air gap (mm)", value: (r) => Math.round(r.distanceMm), numFmt: "0" },
      { header: "Water level (ft)", value: (r) => r.waterLevelFt, numFmt: "0.000" },
      { header: "Water level (m)", value: (r) => r.waterLevelM, numFmt: "0.000" },
      { header: "Capacity (%)", value: (r) => r.capacityPct, numFmt: "0.00" },
      {
        header: "Alert band",
        value: (r) => ALERT_LEVEL_LABEL[r.alertLevel],
        align: "center",
      },
      { header: "Temperature (°C)", value: (r) => r.temperatureC, numFmt: "0.0" },
      { header: "Pressure (hPa)", value: (r) => r.pressureHpa, numFmt: "0.00" },
      { header: "Battery (V)", value: (r) => r.batteryVoltage, numFmt: "0.00" },
      { header: "Signal (CSQ 0-31)", value: (r) => r.signalStrength, numFmt: "0" },
    ],
  };
}
