/**
 * Sanity-checks the app's computeDiurnalProfile against the standalone
 * analysis in diurnal.mjs — both should find the same daily oscillation.
 *
 * Usage: npx tsx tools/diurnalCheck.ts
 */
import fs from "node:fs";
import { processMonitorPipeline } from "../app/src/lib/sensorQuality";
import { computeDiurnalProfile } from "../app/src/lib/analytics";
import type { RawWaterMonitorReading } from "../app/src/types";

const raw = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8")) as Record<
  string,
  RawWaterMonitorReading
>;
const all = Object.values(raw)
  .filter((r) => Number.isFinite(r?.distance) && Number.isFinite(r?.timestamp))
  .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

const realNow = Date.now;
const at = all[all.length - 1].timestamp as number;
(Date as { now: () => number }).now = () => at;
const { history } = processMonitorPipeline(all.slice(-5000), all[all.length - 1], at);
(Date as { now: () => number }).now = realNow;

const profile = computeDiurnalProfile(history);
console.log(`trusted history points: ${history.length}`);
console.log(`full days used: ${profile.dayCount}`);
console.log(`swing: ${profile.swingFt?.toFixed(3)} ft (${((profile.swingFt ?? 0) * 304.8).toFixed(0)} mm)`);
console.log(`peak hour: ${profile.peakHour}:00\n`);

console.log("hour  days   dev ft     dev mm   profile");
const means = profile.buckets.map((b) => b.meanFt).filter((v): v is number => v !== null);
const scale = Math.max(...means.map(Math.abs)) || 1;
for (const b of profile.buckets) {
  if (b.meanFt === null) {
    console.log(`${String(b.hour).padStart(2, "0")}:00    -        -          -`);
    continue;
  }
  const w = Math.round((b.meanFt / scale) * 18);
  const bar = w >= 0 ? " ".repeat(18) + "|" + "#".repeat(w) : " ".repeat(18 + w) + "#".repeat(-w) + "|";
  console.log(
    `${String(b.hour).padStart(2, "0")}:00  ${String(b.count).padStart(3)}  ${b.meanFt.toFixed(3).padStart(7)}  ` +
      `${(b.meanFt * 304.8).toFixed(1).padStart(7)}   ${bar}`,
  );
}
