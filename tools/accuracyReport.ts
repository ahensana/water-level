/**
 * Cross-check the staff-gauge register against the fitted sensor offset.
 * Prints JSON for the accuracy canvas.
 *
 * Usage: npx tsx tools/accuracyReport.ts
 */
import fs from "node:fs";
import { SITE_CONFIG } from "../app/src/config";
import { getCalibrationOffsetFt } from "../app/src/lib/calibration";
import {
  buildIntervalReport,
  verifyAgainstGauge,
} from "../app/src/lib/intervalReport";
import { processMonitorPipeline } from "../app/src/lib/sensorQuality";
import { resolveDeviceTimeMs } from "../app/src/lib/waterLevel";
import type { RawWaterMonitorReading } from "../app/src/types";
import { FIELD_LOG } from "./fieldLog.mjs";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const HISTORY_LIMIT = 5000;

/** Index 0 = 1 AM IST … index 23 = 12 midnight IST, matching FIELD_LOG. */
const istHourMs = (dayKey: string, hourIdx: number) =>
  Date.parse(`${dayKey}T00:00:00Z`) - IST_OFFSET_MS + (hourIdx + 1) * 3600 * 1000;

const hourLabel = (hourIdx: number) =>
  `${String((hourIdx + 1) % 24).padStart(2, "0")}:00`;

const dump = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8")) as Record<
  string,
  RawWaterMonitorReading
>;

const all = Object.values(dump)
  .filter((r) => r && Number.isFinite(r.distance) && Number.isFinite(r.timestamp))
  .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const mu = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
};

const realNow = Date.now;
const hours: {
  label: string;
  day: string;
  hour: number;
  gaugeFt: number;
  sensorFt: number | null;
  errorFt: number | null;
  quality: string;
  alert: string;
}[] = [];

for (const [day, vals] of Object.entries(FIELD_LOG as Record<string, (number | null)[]>)) {
  for (let i = 0; i < vals.length; i++) {
    const gaugeFt = vals[i];
    if (typeof gaugeFt !== "number" || !Number.isFinite(gaugeFt)) continue;
    const atMs = istHourMs(day, i);
    const window = all.filter((r) => {
      const t = resolveDeviceTimeMs(r);
      return t !== null && t <= atMs;
    }).slice(-HISTORY_LIMIT);
    if (window.length === 0) {
      hours.push({
        label: `${day} ${hourLabel(i)}`,
        day,
        hour: i,
        gaugeFt,
        sensorFt: null,
        errorFt: null,
        quality: "no-data",
        alert: "—",
      });
      continue;
    }
    Date.now = () => atMs;
    try {
      const result = processMonitorPipeline(window, window[window.length - 1], atMs);
      const sensorFt = result.reading ? result.reading.waterLevelFt : null;
      hours.push({
        label: `${day} ${hourLabel(i)}`,
        day,
        hour: i,
        gaugeFt,
        sensorFt,
        errorFt: sensorFt === null ? null : sensorFt - gaugeFt,
        quality: result.report.quality,
        alert: result.reading?.alertLevel ?? "—",
      });
    } finally {
      Date.now = realNow;
    }
  }
}

const comparable = hours.filter((h) => h.errorFt !== null && h.sensorFt !== null && h.quality !== "fault");
const errors = comparable.map((h) => h.errorFt!) as number[];
const abs = errors.map((e) => Math.abs(e));
const within = (lim: number) => errors.filter((e) => Math.abs(e) <= lim).length;

const byDay = Object.entries(
  comparable.reduce<Record<string, number[]>>((acc, h) => {
    (acc[h.day] ??= []).push(h.errorFt!);
    return acc;
  }, {}),
).map(([day, errs]) => ({
  day,
  n: errs.length,
  medianFt: median(errs),
  meanFt: mean(errs),
  stdFt: stdev(errs),
  worstFt: Math.max(...errs.map(Math.abs)),
  within05: errs.filter((e) => Math.abs(e) <= 0.05).length,
  within10: errs.filter((e) => Math.abs(e) <= 0.10).length,
  within30: errs.filter((e) => Math.abs(e) <= 0.30).length,
}));

const byHour = Array.from({ length: 24 }, (_, hour) => {
  const errs = comparable.filter((h) => h.hour === hour).map((h) => h.errorFt!);
  return {
    hour,
    n: errs.length,
    medianFt: median(errs),
    meanFt: mean(errs),
  };
});

const worst = [...comparable]
  .sort((a, b) => Math.abs(b.errorFt!) - Math.abs(a.errorFt!))
  .slice(0, 8)
  .map((h) => ({
    when: h.label,
    gaugeFt: h.gaugeFt,
    sensorFt: h.sensorFt,
    errorFt: h.errorFt,
    quality: h.quality,
  }));

const times = all.map((r) => resolveDeviceTimeMs(r)).filter((t): t is number => t !== null);
const from = Math.max(SITE_CONFIG.dataStartMs, Math.min(...times));
const to = Math.max(...times);
const report = buildIntervalReport(all, from, to, 3_600_000);
const checks: { id: string; atMs: number; gaugeFt: number }[] = [];
for (const [date, vals] of Object.entries(FIELD_LOG as Record<string, (number | null)[]>)) {
  vals.forEach((gaugeFt, hour) => {
    if (typeof gaugeFt !== "number" || !Number.isFinite(gaugeFt)) return;
    const atMs = istHourMs(date, hour);
    if (atMs >= from && atMs <= to) checks.push({ id: `${date}-${hour}`, atMs, gaugeFt });
  });
}
const verification = verifyAgainstGauge(report, checks, SITE_CONFIG.crossCheckToleranceFt);
const overTolerance = verification.usable.filter(
  (r) => r.deviationFt !== null && Math.abs(r.deviationFt) > SITE_CONFIG.crossCheckToleranceFt,
).length;

const loggedHours = hours.length;
const missingSensor = hours.filter((h) => h.sensorFt === null).length;
const preMount = hours.filter((h) => {
  const atMs = istHourMs(h.day, h.hour);
  return atMs < SITE_CONFIG.dataStartMs;
}).length;

const out = {
  generatedAt: new Date().toISOString(),
  offset: {
    sensorElevationFt: SITE_CONFIG.sensorElevationFt,
    operatorTrimFt: getCalibrationOffsetFt(),
    effectiveElevationFt: SITE_CONFIG.sensorElevationFt + getCalibrationOffsetFt(),
    formula: "waterLevelFt = 3212.16 − distanceMm × 0.00328084  (+ operator trim, currently 0)",
  },
  window: {
    logbook: "1–13 Aug 2026 IST",
    livePathFrom: "5 Aug 2026 00:00 IST (commissioning cutoff)",
    sensorFirst: times.length ? new Date(Math.min(...times)).toISOString() : null,
    sensorLast: times.length ? new Date(Math.max(...times)).toISOString() : null,
    rawSamples: all.length,
  },
  coverage: {
    logbookHours: loggedHours,
    comparableHours: comparable.length,
    missingSensor,
    preMountHours: preMount,
  },
  livePath: {
    n: comparable.length,
    medianErrorFt: median(errors),
    meanErrorFt: mean(errors),
    stdFt: stdev(errors),
    maeFt: mean(abs),
    worstAbsFt: Math.max(...abs),
    within05: within(0.05),
    within10: within(0.10),
    within30: within(0.30),
    falseAlarms: comparable.filter((h) => h.alert === "warning" || h.alert === "critical").length,
  },
  auditPath: {
    usable: verification.usable.length,
    excluded: verification.results.length - verification.usable.length,
    medianDeviationFt: verification.medianDeviationFt,
    maxAbsDeviationFt: verification.maxAbsDeviationFt,
    suggestedTrimFt: verification.suggestedOffsetFt,
    verdict: verification.withinTolerance ? "PASS" : "FAIL",
    overTolerance,
    toleranceFt: SITE_CONFIG.crossCheckToleranceFt,
  },
  byDay,
  byHour: byHour.map((h) => ({
    hour: h.hour,
    n: h.n,
    medianFt: h.medianFt,
    meanFt: h.meanFt,
  })),
  worst,
};

fs.writeFileSync(new URL("./accuracy-report.json", import.meta.url), JSON.stringify(out, null, 2));
const lp = out.livePath;
const ap = out.auditPath;
console.log(
  [
    `offset ${out.offset.effectiveElevationFt} ft (trim ${out.offset.operatorTrimFt})`,
    `logbook hours ${out.coverage.logbookHours}  comparable ${out.coverage.comparableHours}  pre-mount ${out.coverage.preMountHours}`,
    `LIVE  n=${lp.n}  median ${lp.medianErrorFt?.toFixed(3)} ft  mean ${lp.meanErrorFt?.toFixed(3)} ft  std ${lp.stdFt.toFixed(3)} ft  MAE ${lp.maeFt?.toFixed(3)} ft  worst ${lp.worstAbsFt.toFixed(3)} ft`,
    `      within 0.05 ${lp.within05}/${lp.n}  0.10 ${lp.within10}/${lp.n}  0.30 ${lp.within30}/${lp.n}  false alarms ${lp.falseAlarms}`,
    `AUDIT n=${ap.usable} usable / ${ap.excluded} excluded  median ${ap.medianDeviationFt?.toFixed(3)} ft  worst ${ap.maxAbsDeviationFt?.toFixed(3)} ft  suggested trim ${ap.suggestedTrimFt?.toFixed(3)} ft  ${ap.verdict} (${ap.overTolerance} over ${ap.toleranceFt} ft)`,
    `days:`,
    ...out.byDay.map(
      (d) =>
        `  ${d.day} n=${d.n} median=${d.medianFt?.toFixed(3)} worst=${d.worstFt.toFixed(3)} within0.10=${d.within10}/${d.n}`,
    ),
    `worst hours:`,
    ...out.worst.map(
      (w) => `  ${w.when}  gauge ${w.gaugeFt.toFixed(2)}  sensor ${w.sensorFt?.toFixed(2)}  err ${w.errorFt?.toFixed(3)}  ${w.quality}`,
    ),
  ].join("\n"),
);
