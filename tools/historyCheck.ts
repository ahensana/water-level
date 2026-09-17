/**
 * Validates the in-app Trusted Reading History browser against the recorded
 * RTDB feed.
 *
 * Checks the two things a history browser can get wrong and still look right:
 *  1. It must show the same readings the live gauge trusts — same count, same
 *     levels, same final alert band as `processMonitorPipeline` reports.
 *  2. Every filter must be a strict subset of the unfiltered record, with the
 *     right rows in it (including the hour-of-day window that wraps midnight).
 *
 * Usage: npx tsx tools/historyCheck.ts
 */
import fs from "node:fs";
import { SITE_CONFIG } from "../app/src/config";
import {
  buildTrustedHistory,
  DEFAULT_FILTERS,
  filterTrustedHistory,
  isFilterActive,
  summarizeHistory,
  trustedHistoryToCsv,
} from "../app/src/lib/readingHistory";
import { processMonitorPipeline } from "../app/src/lib/sensorQuality";
import { replayAlertLevels } from "../app/src/lib/waterLevel";
import type { AlertLevel, RawWaterMonitorReading } from "../app/src/types";

const raw = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8")) as Record<
  string,
  RawWaterMonitorReading
>;

const all = Object.values(raw)
  .filter((r) => Number.isFinite(r?.distance) && Number.isFinite(r?.timestamp))
  .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`Raw readings in dump: ${all.length}\n`);

// --- 1. agreement with the live pipeline -----------------------------------

const rows = buildTrustedHistory(all);
const { history, reading } = processMonitorPipeline(all, all[all.length - 1], Date.now());

check("row count matches the pipeline's trusted history", rows.length === history.length,
  `${rows.length} vs ${history.length}`);

const levelMismatch = rows.findIndex(
  (r, i) => r.t !== history[i].t || Math.abs(r.waterLevelFt - history[i].waterLevelFt) > 1e-9,
);
check("every level and timestamp is identical to the pipeline's", levelMismatch === -1,
  levelMismatch === -1 ? "" : `first divergence at index ${levelMismatch}`);

check("all rows are marked trusted", rows.every((r) => r.trusted));

check("rows are chronological", rows.every((r, i) => i === 0 || r.t > rows[i - 1].t));

check(
  "no reading predates the commissioning cutoff",
  rows.every((r) => r.t >= SITE_CONFIG.dataStartMs),
);

// The live gauge holds the last band when stale, so compare against the replay
// rather than the reported band, which is what the panel's rows are built from.
const replayed = replayAlertLevels(history.map((p) => p.waterLevelFt));
check("final row band equals the hysteresis replay", rows[rows.length - 1].alertLevel === replayed[replayed.length - 1],
  `${rows[rows.length - 1].alertLevel}`);
check(
  "live reading agrees with the last row's band (or is stale/faulted)",
  reading === null || reading.isStale || reading.isSensorFault ||
    reading.alertLevel === rows[rows.length - 1].alertLevel,
  reading ? `live=${reading.alertLevel} stale=${reading.isStale}` : "no live reading",
);

// --- 2. summary ------------------------------------------------------------

const summary = summarizeHistory(filterTrustedHistory(rows, DEFAULT_FILTERS));
if (summary === null) {
  check("summary is produced for a non-empty record", false);
} else {
  check("summary counts every row", summary.count === rows.length);
  check("summary bands total the row count",
    summary.bandCounts.normal + summary.bandCounts.warning + summary.bandCounts.critical === rows.length);
  check("median lies inside the min/max span",
    summary.medianFt >= summary.minFt && summary.medianFt <= summary.maxFt);
  console.log(
    `\n      ${summary.count} trusted readings · ${summary.minFt.toFixed(2)}–${summary.maxFt.toFixed(2)} ft ` +
      `(median ${summary.medianFt.toFixed(2)}) · ${new Date(summary.firstMs).toISOString()} → ` +
      `${new Date(summary.lastMs).toISOString()}`,
  );
  console.log(
    `      bands: ${summary.bandCounts.normal} normal, ${summary.bandCounts.warning} warning, ` +
      `${summary.bandCounts.critical} critical\n`,
  );
}

// --- 3. filters ------------------------------------------------------------

check("default filters are reported inactive", !isFilterActive(DEFAULT_FILTERS));
check("default filters return the whole record",
  filterTrustedHistory(rows, DEFAULT_FILTERS).length === rows.length);

check("newest-first ordering is honoured",
  filterTrustedHistory(rows, { ...DEFAULT_FILTERS, sort: "newest" })[0].t === rows[rows.length - 1].t);
check("oldest-first ordering is honoured",
  filterTrustedHistory(rows, { ...DEFAULT_FILTERS, sort: "oldest" })[0].t === rows[0].t);

for (const band of ["normal", "warning", "critical"] as AlertLevel[]) {
  const got = filterTrustedHistory(rows, { ...DEFAULT_FILTERS, alertLevels: [band] });
  check(`band filter "${band}" returns only that band`,
    got.every((r) => r.alertLevel === band),
    `${got.length} rows`);
}

const allBands = filterTrustedHistory(rows, {
  ...DEFAULT_FILTERS,
  alertLevels: ["normal", "warning", "critical"],
});
check("selecting every band returns the whole record", allBands.length === rows.length);

const levels = rows.map((r) => r.waterLevelFt).sort((a, b) => a - b);
const lo = levels[Math.floor(levels.length * 0.25)];
const hi = levels[Math.floor(levels.length * 0.75)];
const banded = filterTrustedHistory(rows, { ...DEFAULT_FILTERS, minLevelFt: lo, maxLevelFt: hi });
check("level window excludes nothing inside it and nothing outside it",
  banded.every((r) => r.waterLevelFt >= lo && r.waterLevelFt <= hi) &&
    banded.length === rows.filter((r) => r.waterLevelFt >= lo && r.waterLevelFt <= hi).length,
  `${banded.length} rows in ${lo.toFixed(2)}–${hi.toFixed(2)} ft`);

check("impossible level window returns nothing",
  filterTrustedHistory(rows, { ...DEFAULT_FILTERS, minLevelFt: 9999, maxLevelFt: 10_000 }).length === 0);

const day = filterTrustedHistory(rows, { ...DEFAULT_FILTERS, fromHour: 9, toHour: 17 });
check("daytime window keeps only hours 09–17",
  day.every((r) => {
    const h = new Date(r.t).getHours();
    return h >= 9 && h <= 17;
  }),
  `${day.length} rows`);

const night = filterTrustedHistory(rows, { ...DEFAULT_FILTERS, fromHour: 22, toHour: 4 });
check("night window wraps midnight (22–04)",
  night.length > 0 &&
    night.every((r) => {
      const h = new Date(r.t).getHours();
      return h >= 22 || h <= 4;
    }),
  `${night.length} rows`);

check("day and night windows do not overlap",
  new Set(day.map((r) => r.t)).size + new Set(night.map((r) => r.t)).size ===
    new Set([...day, ...night].map((r) => r.t)).size);

const combined = filterTrustedHistory(rows, {
  alertLevels: ["normal"],
  minLevelFt: lo,
  maxLevelFt: hi,
  fromHour: 9,
  toHour: 17,
  sort: "oldest",
});
check("stacked filters apply as an AND",
  combined.every((r) => {
    const h = new Date(r.t).getHours();
    return r.alertLevel === "normal" && r.waterLevelFt >= lo && r.waterLevelFt <= hi && h >= 9 && h <= 17;
  }),
  `${combined.length} rows`);

// --- 4. export -------------------------------------------------------------

const csv = trustedHistoryToCsv(banded);
const lines = csv.split("\r\n");
check("CSV has one header plus one line per filtered row", lines.length === banded.length + 1,
  `${lines.length} lines for ${banded.length} rows`);
check("CSV header carries the alert band", lines[0].includes("alert_level"));
check("CSV columns are consistent",
  lines.every((l) => l.split(",").length === lines[0].split(",").length));
check("CSV exports the filtered set, not the whole record", banded.length < rows.length);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
