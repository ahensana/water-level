import type { SessionHistoryPoint } from "../types";

const CSV_COLUMNS = [
  "timestamp_utc_iso",
  "timestamp_ist",
  "distance_mm",
  "water_level_ft",
  "water_level_m",
  "capacity_pct",
  "temperature_c",
  "pressure_hpa",
  "battery_v",
  "signal_csq",
] as const;

/** Official-record CSV of trusted readings — for departmental filing/audit, not the chart. */
export function historyToCsv(points: SessionHistoryPoint[]): string {
  const rows = points.map((p) =>
    [
      new Date(p.t).toISOString(),
      formatIst(p.t),
      Math.round(p.distanceMm),
      p.waterLevelFt.toFixed(3),
      p.waterLevelM.toFixed(3),
      p.capacityPct.toFixed(2),
      p.temperatureC ?? "",
      p.pressureHpa ?? "",
      p.batteryVoltage ?? "",
      p.signalStrength ?? "",
    ].join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n");
}

const IST_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * IST wall-clock stamp — the timezone the field register is kept in.
 *
 * Assembled as `YYYY-MM-DD HH:mm:ss` rather than taken from `toLocaleString`,
 * whose output embeds a comma between the date and the time. Unquoted, that
 * comma split the stamp across two columns and shifted every field after it,
 * silently corrupting an export filed as an official record.
 */
export function formatIst(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of IST_PARTS.formatToParts(ms)) p[part.type] = part.value;
  // en-GB renders midnight as hour 24; the ISO-style stamp needs 00.
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
