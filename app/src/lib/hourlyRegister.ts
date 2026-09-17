import { formatIst } from "./csvExport";
import { replayAlertLevels, METERS_TO_FEET } from "./waterLevel";
import type { AlertLevel, SessionHistoryPoint } from "../types";

/** Clock labels matching the field staff-gauge register (index 0 = 1 AM … 23 = 12 MN). */
export const GAUGE_HOUR_LABELS = [
  "1 AM",
  "2 AM",
  "3 AM",
  "4 AM",
  "5 AM",
  "6 AM",
  "7 AM",
  "8 AM",
  "9 AM",
  "10 AM",
  "11 AM",
  "12 Noon",
  "1 PM",
  "2 PM",
  "3 PM",
  "4 PM",
  "5 PM",
  "6 PM",
  "7 PM",
  "8 PM",
  "9 PM",
  "10 PM",
  "11 PM",
  "12 MN",
] as const;

const IST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day in IST as `YYYY-MM-DD`. */
export function istDateKey(ms: number): string {
  return IST_DATE.format(ms);
}

export function istDayStartMs(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00+05:30`);
}

/**
 * Start of a register slot. Index 0 is 1 AM IST on `dateKey`; index 23 is
 * midnight ending that day (00:00 the next morning).
 */
export function slotStartMs(dateKey: string, hourIdx: number): number {
  return istDayStartMs(dateKey) + (hourIdx + 1) * 3_600_000;
}

export interface HourlySlot {
  hourIdx: number;
  label: string;
  startMs: number;
  endMs: number;
  sampleCount: number;
  waterLevelFt: number | null;
  waterLevelM: number | null;
  capacityPct: number | null;
  distanceMm: number | null;
  temperatureC: number | null;
  alertLevel: AlertLevel | null;
  /** Change from the previous filled hour (ft). */
  deltaFt: number | null;
  /** Wall clock sits inside this slot. */
  isLive: boolean;
  /** Slot has not started yet. */
  isFuture: boolean;
}

export interface HourlyRegister {
  dateKey: string;
  slots: HourlySlot[];
  filled: number;
  minFt: number | null;
  maxFt: number | null;
  medianFt: number | null;
  /** Last filled hour minus first filled hour (ft). */
  netChangeFt: number | null;
}

/**
 * 24-row staff-gauge register for one IST day, from trusted pipeline history.
 *
 * Each hour is the median of trusted samples in that clock hour — the same
 * numbers the live gauge is built from — so an operator comparing this card to
 * the field book is comparing like with like. Future hours stay empty; the
 * in-progress hour is marked live rather than treated as a completed entry.
 */
export function buildHourlyRegister(
  history: SessionHistoryPoint[],
  dateKey: string,
  nowMs: number,
): HourlyRegister {
  const slots: HourlySlot[] = GAUGE_HOUR_LABELS.map((label, hourIdx) => {
    const startMs = slotStartMs(dateKey, hourIdx);
    const endMs = startMs + 3_600_000;
    const samples = history.filter((p) => p.t >= startMs && p.t < endMs && p.trusted);
    const levels = samples.map((p) => p.waterLevelFt);
    const waterLevelFt = median(levels);
    const isFuture = nowMs < startMs;
    const isLive = nowMs >= startMs && nowMs < endMs;
    return {
      hourIdx,
      label,
      startMs,
      endMs,
      sampleCount: samples.length,
      waterLevelFt,
      waterLevelM: waterLevelFt === null ? null : waterLevelFt / METERS_TO_FEET,
      capacityPct: waterLevelFt === null ? null : samples.length
        ? median(samples.map((p) => p.capacityPct))
        : null,
      distanceMm: samples.length ? median(samples.map((p) => p.distanceMm)) : null,
      temperatureC: median(samples.map((p) => p.temperatureC).filter((v): v is number => v !== null)),
      alertLevel: null,
      deltaFt: null,
      isLive,
      isFuture,
    };
  });

  const filledLevels = slots
    .filter((s) => s.waterLevelFt !== null)
    .map((s) => s.waterLevelFt as number);
  const replayed = replayAlertLevels(filledLevels);
  let filledI = 0;
  let prevFt: number | null = null;
  for (const slot of slots) {
    if (slot.waterLevelFt === null) continue;
    slot.alertLevel = replayed[filledI++];
    slot.deltaFt = prevFt === null ? null : slot.waterLevelFt - prevFt;
    prevFt = slot.waterLevelFt;
  }

  const sorted = [...filledLevels].sort((a, b) => a - b);
  return {
    dateKey,
    slots,
    filled: filledLevels.length,
    minFt: sorted.length ? sorted[0] : null,
    maxFt: sorted.length ? sorted[sorted.length - 1] : null,
    medianFt: sorted.length ? sorted[sorted.length >> 1] : null,
    netChangeFt:
      filledLevels.length >= 2 ? filledLevels[filledLevels.length - 1] - filledLevels[0] : null,
  };
}

/** Whether session history already covers this IST day enough to skip a fetch. */
export function historyCoversDay(history: SessionHistoryPoint[], dateKey: string, nowMs: number): boolean {
  if (history.length === 0) return false;
  const today = istDateKey(nowMs);
  const dayStart = slotStartMs(dateKey, 0);
  const dayEnd = slotStartMs(dateKey, 23) + 3_600_000;
  const first = history[0].t;
  const last = history[history.length - 1].t;
  if (dateKey === today) return first <= nowMs && last >= dayStart;
  return first <= dayStart && last >= dayEnd - 60_000;
}

export function hourlyRegisterToCsv(register: HourlyRegister): string {
  const header = [
    "date_ist",
    "hour",
    "slot_start_ist",
    "samples",
    "distance_mm",
    "water_level_ft",
    "water_level_m",
    "capacity_pct",
    "delta_ft",
    "alert_level",
    "status",
  ].join(",");
  const rows = register.slots.map((s) =>
    [
      register.dateKey,
      s.label,
      formatIst(s.startMs),
      s.sampleCount,
      s.distanceMm === null ? "" : Math.round(s.distanceMm),
      s.waterLevelFt === null ? "" : s.waterLevelFt.toFixed(3),
      s.waterLevelM === null ? "" : s.waterLevelM.toFixed(3),
      s.capacityPct === null ? "" : s.capacityPct.toFixed(2),
      s.deltaFt === null ? "" : s.deltaFt.toFixed(3),
      s.alertLevel ?? "",
      s.isLive ? "in_progress" : s.isFuture ? "future" : s.waterLevelFt === null ? "no_data" : "complete",
    ].join(","),
  );
  return [header, ...rows].join("\r\n");
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
