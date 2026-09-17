/**
 * Smoke-check the hourly staff-gauge register against one logbook day.
 * Usage: npx tsx tools/hourlyRegisterCheck.ts
 */
import fs from "node:fs";
import { SITE_CONFIG } from "../app/src/config";
import { buildHourlyRegister, GAUGE_HOUR_LABELS, slotStartMs } from "../app/src/lib/hourlyRegister";
import { processMonitorPipeline } from "../app/src/lib/sensorQuality";
import type { RawWaterMonitorReading } from "../app/src/types";
import { FIELD_LOG } from "./fieldLog.mjs";

const dump = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8")) as Record<
  string,
  RawWaterMonitorReading
>;
const all = Object.values(dump)
  .filter((r) => r && Number.isFinite(r.distance) && Number.isFinite(r.timestamp))
  .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

const day = "2026-08-10";
const end = slotStartMs(day, 23) + 3_600_000;
const { history } = processMonitorPipeline(
  all.filter((r) => (r.timestamp as number) <= end),
  null,
  0,
);
const register = buildHourlyRegister(history, day, end);
const log = FIELD_LOG[day];

let n = 0;
let within = 0;
let worst = 0;
for (let i = 0; i < 24; i++) {
  const gauge = log[i];
  const sensor = register.slots[i].waterLevelFt;
  if (typeof gauge !== "number" || sensor === null) continue;
  const err = Math.abs(sensor - gauge);
  n++;
  if (err <= SITE_CONFIG.crossCheckToleranceFt) within++;
  if (err > worst) worst = err;
  console.log(
    `${GAUGE_HOUR_LABELS[i].padEnd(8)}  gauge ${gauge.toFixed(2)}  hourly ${sensor.toFixed(2)}  err ${(sensor - gauge).toFixed(3)}  n=${register.slots[i].sampleCount}`,
  );
}
console.log(`\n${register.filled}/24 hours · ${within}/${n} within ${SITE_CONFIG.crossCheckToleranceFt} ft · worst ${worst.toFixed(3)} ft`);
if (register.slots.length !== 24) {
  console.error("expected 24 slots");
  process.exit(1);
}
if (within !== n) {
  console.error("hourly register exceeded 0.3 ft on this day");
  process.exit(1);
}
console.log("PASS");
