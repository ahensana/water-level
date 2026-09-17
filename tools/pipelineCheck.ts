/**
 * Replays the real app pipeline (processMonitorPipeline) over the recorded
 * RTDB feed, hour by hour, and scores it against the staff-gauge logbook.
 *
 * This answers "is it the web app or the sensor" using the exact code the
 * dashboard runs, rather than a re-implementation of it.
 *
 * Usage: npx tsx tools/pipelineCheck.ts
 */
import fs from "node:fs";
import { processMonitorPipeline } from "../app/src/lib/sensorQuality";
import { SITE_CONFIG } from "../app/src/config";
import type { RawWaterMonitorReading } from "../app/src/types";
import { FIELD_LOG } from "./fieldLog.mjs";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const HISTORY_LIMIT = 5000;

const raw = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8")) as Record<
  string,
  RawWaterMonitorReading
>;

const all = Object.values(raw)
  .filter((r) => Number.isFinite(r?.distance) && Number.isFinite(r?.timestamp))
  .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

const istHourMs = (dayKey: string, hourIdx: number) =>
  Date.parse(`${dayKey}T00:00:00Z`) - IST_OFFSET_MS + (hourIdx + 1) * 3600 * 1000;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
};

// Freeze Date.now() to each simulated instant so the pipeline's staleness /
// quality-window logic behaves exactly as it would have live at that moment.
const realNow = Date.now;

interface Row {
  label: string;
  day: string;
  fieldFt: number;
  appFt: number | null;
  quality: string;
  faults: string;
  rejectRate: number;
  liveN: number;
  alert: string;
  distanceMm: number | null;
}

const rows: Row[] = [];
let cursor = 0;

const fromArg = process.argv.find((a) => a.startsWith("--from="));
const FROM_DAY = fromArg ? fromArg.slice("--from=".length) : "0000-00-00";

for (const [dayKey, hours] of Object.entries(FIELD_LOG)) {
  hours.forEach((fieldFt, hourIdx) => {
    if (fieldFt == null) return;
    if (dayKey < FROM_DAY) return;
    const atMs = istHourMs(dayKey, hourIdx);
    if (atMs > (all.at(-1)!.timestamp as number)) return;

    while (cursor < all.length && (all[cursor].timestamp as number) <= atMs) cursor += 1;
    if (cursor === 0) return;
    const window = all.slice(Math.max(0, cursor - HISTORY_LIMIT), cursor);
    if (window.length < 10) return;

    (Date as { now: () => number }).now = () => atMs;
    let result;
    try {
      result = processMonitorPipeline(window, window[window.length - 1], atMs);
    } finally {
      (Date as { now: () => number }).now = realNow;
    }

    rows.push({
      label: `${dayKey} ${String((hourIdx + 1) % 24).padStart(2, "0")}:00`,
      day: dayKey,
      fieldFt,
      appFt: result.reading ? result.reading.waterLevelFt : null,
      quality: result.report.quality,
      faults: result.report.faultCodes.join(","),
      rejectRate: result.report.rejectRate,
      liveN: result.report.liveSampleCount,
      alert: result.reading ? result.reading.alertLevel : "-",
      distanceMm: result.reading ? result.reading.distanceMm : null,
    });
  });
}

console.log(`=== APP PIPELINE REPLAY (${rows.length} hourly checkpoints) ===`);
console.log(`sensorElevationFt in use: ${SITE_CONFIG.sensorElevationFt}\n`);

// Checkpoints the app deliberately reports as unavailable are a correctness
// outcome, not an accuracy one — scoring them as a ~3197 ft miss is meaningless.
const unavailable = rows.filter((r) => r.quality === "fault");
const scored = rows.filter((r) => r.appFt != null && r.quality !== "fault") as (Row & { appFt: number })[];
const errs = scored.map((r) => r.appFt - r.fieldFt);

console.log("--- accuracy vs staff gauge ---");
console.log(`  reported unavailable (correctly, no level shown): ${unavailable.length}/${rows.length}`);
console.log(`  scored checkpoints: ${scored.length}`);
console.log(`  median error : ${median(errs).toFixed(3)} ft (${(median(errs) * 304.8).toFixed(0)} mm)`);
console.log(`  mean error   : ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(3)} ft`);
console.log(`  std of error : ${stdev(errs).toFixed(3)} ft`);
console.log(`  worst        : ${Math.min(...errs).toFixed(2)} .. ${Math.max(...errs).toFixed(2)} ft`);
for (const tol of [0.05, 0.1, 0.25, 1]) {
  console.log(`  within ${tol} ft: ${errs.filter((e) => Math.abs(e) <= tol).length}/${errs.length}`);
}

console.log("\n--- what the dashboard would have SHOWN as status ---");
const qCount = new Map<string, number>();
for (const r of rows) qCount.set(r.quality, (qCount.get(r.quality) ?? 0) + 1);
for (const [q, n] of [...qCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${q.padEnd(9)} ${n} / ${rows.length}  (${((n / rows.length) * 100).toFixed(0)}%)`);
}
const faultCount = new Map<string, number>();
for (const r of rows) {
  for (const f of r.faults.split(",").filter(Boolean)) {
    faultCount.set(f, (faultCount.get(f) ?? 0) + 1);
  }
}
console.log("  fault codes raised:");
for (const [f, n] of [...faultCount].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${f.padEnd(20)} ${n}`);
}

console.log("\n--- worst 12 checkpoints ---");
console.log("hour(IST)          field ft   app ft    err ft   quality   faults");
for (const r of [...scored].sort((a, b) => Math.abs(b.appFt - b.fieldFt) - Math.abs(a.appFt - a.fieldFt)).slice(0, 12)) {
  console.log(
    `${r.label}   ${r.fieldFt.toFixed(2)}   ${r.appFt.toFixed(2)}  ${(r.appFt - r.fieldFt).toFixed(3).padStart(8)}   ` +
      `${r.quality.padEnd(9)} ${r.faults}`,
  );
}

console.log("\n--- calibration sweep (shifting sensorElevationFt) ---");
console.log("  offset   newElev     median err   within 0.05   within 0.10");
for (const off of [0, -0.02, -0.04, -0.05, -0.06, -0.08, -0.1]) {
  const shifted = errs.map((e) => e + off);
  console.log(
    `  ${off.toFixed(2).padStart(6)}   ${(SITE_CONFIG.sensorElevationFt + off).toFixed(2)}    ` +
      `${median(shifted).toFixed(3).padStart(9)}    ` +
      `${String(shifted.filter((e) => Math.abs(e) <= 0.05).length).padStart(3)}/${shifted.length}` +
      `       ${String(shifted.filter((e) => Math.abs(e) <= 0.1).length).padStart(3)}/${shifted.length}`,
  );
}

console.log("\n--- FALSE ALARMS: checkpoints where the app showed warning/critical ---");
const falseAlarms = scored.filter((r) => r.alert !== "normal" && r.fieldFt < SITE_CONFIG.warningLevelFt);
console.log(`  ${falseAlarms.length} / ${scored.length} checkpoints (real level never exceeded ${SITE_CONFIG.warningLevelFt} ft)`);
if (falseAlarms.length) {
  console.log("  hour(IST)          field ft   app ft    dist mm   alert     quality");
  for (const r of falseAlarms) {
    console.log(
      `  ${r.label}   ${r.fieldFt.toFixed(2)}   ${r.appFt.toFixed(2)}  ${String(r.distanceMm).padStart(8)}   ` +
        `${r.alert.padEnd(9)} ${r.quality}`,
    );
  }
}

console.log("\n--- per-day median error (ft) ---");
const byDay = new Map<string, number[]>();
scored.forEach((r) => {
  if (!byDay.has(r.day)) byDay.set(r.day, []);
  byDay.get(r.day)!.push(r.appFt - r.fieldFt);
});
for (const [day, list] of [...byDay].sort()) {
  console.log(`  ${day}  n=${String(list.length).padStart(2)}  median=${median(list).toFixed(3)}  std=${stdev(list).toFixed(3)}`);
}
