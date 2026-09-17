/**
 * Compares the A01 ultrasonic feed against the manual staff-gauge logbook,
 * hour by hour, to separate calibration offset from real sensor error.
 *
 * Usage: node tools/compare.mjs [--table]
 *
 * Reads tools/sensor-dump.json (full RTDB export of water_monitor/current).
 */
import fs from "node:fs";
import { FIELD_LOG } from "./fieldLog.mjs";

const MM_TO_FT = 3.28084 / 1000;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
/** Sensor samples within +/- this of the hour mark feed that hour's median. */
const HOUR_HALF_WINDOW_MS = 20 * 60 * 1000;

const raw = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url)));

/** SITE_CONFIG plausibility gate - mirrors the app's classifyDistanceFault. */
const MIN_VALID_MM = 280;
const MAX_VALID_MM = 6500;

const all = Object.values(raw)
  .filter((r) => Number.isFinite(r?.distance) && Number.isFinite(r?.timestamp))
  .map((r) => ({ t: r.timestamp, mm: r.distance, tempC: r.temperature ?? null }))
  .sort((a, b) => a.t - b.t);

/** Sensor samples that survive the app's physical-range gate. */
const samples = all.filter((s) => s.mm >= MIN_VALID_MM && s.mm <= MAX_VALID_MM);
const rejected = all.length - samples.length;

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const stdev = (xs) => {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
};

/** IST wall-clock epoch for a given day + hour index (0 = 1 AM ... 23 = 12 MN). */
const istHourMs = (dayKey, hourIdx) => {
  const utcMidnight = Date.parse(`${dayKey}T00:00:00Z`);
  return utcMidnight - IST_OFFSET_MS + (hourIdx + 1) * 3600 * 1000;
};

const fmtIst = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");

// ---- coverage -------------------------------------------------------------
console.log("=== SENSOR FEED COVERAGE ===");
console.log(`samples: ${samples.length} valid, ${rejected} rejected out-of-range (${((rejected / all.length) * 100).toFixed(1)}%)`);
console.log(`first:   ${fmtIst(samples[0].t)} IST   ${samples[0].mm} mm`);
console.log(`last:    ${fmtIst(samples.at(-1).t)} IST   ${samples.at(-1).mm} mm`);

const perDay = new Map();
for (const s of samples) {
  const key = new Date(s.t + IST_OFFSET_MS).toISOString().slice(0, 10);
  if (!perDay.has(key)) perDay.set(key, []);
  perDay.get(key).push(s);
}
console.log("\nper IST day: count | median mm | min | max");
for (const [key, list] of [...perDay].sort()) {
  const mms = list.map((s) => s.mm);
  console.log(
    `  ${key}  n=${String(list.length).padStart(5)}  med=${String(median(mms)).padStart(6)}  ` +
      `min=${String(Math.min(...mms)).padStart(5)}  max=${String(Math.max(...mms)).padStart(5)}`,
  );
}

// ---- hourly pairing -------------------------------------------------------
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const FROM_DAY = fromArg ? fromArg.slice("--from=".length) : "0000-00-00";
if (fromArg) console.log(`\n[filtered to IST days >= ${FROM_DAY}]`);

let cursor = 0;
const pairs = [];
for (const [dayKey, hours] of Object.entries(FIELD_LOG)) {
  if (dayKey < FROM_DAY) continue;
  hours.forEach((fieldFt, hourIdx) => {
    if (fieldFt == null) return;
    const centre = istHourMs(dayKey, hourIdx);
    const lo = centre - HOUR_HALF_WINDOW_MS;
    const hi = centre + HOUR_HALF_WINDOW_MS;
    while (cursor > 0 && samples[cursor - 1].t >= lo) cursor -= 1;
    while (cursor < samples.length && samples[cursor].t < lo) cursor += 1;
    const window = [];
    for (let i = cursor; i < samples.length && samples[i].t <= hi; i += 1) window.push(samples[i]);
    if (window.length === 0) return;

    // MAD-based rejection inside the hour: a surviving dropout (e.g. a run of
    // 250 mm echoes) would otherwise drag the hour's median hundreds of mm.
    const rough = median(window.map((s) => s.mm));
    const mad = median(window.map((s) => Math.abs(s.mm - rough))) || 0;
    const tol = Math.max(mad * 6, 40);
    const kept = window.filter((s) => Math.abs(s.mm - rough) <= tol);
    if (kept.length === 0) return;

    const mms = kept.map((s) => s.mm);
    const medMm = median(mms);
    const temps = kept.map((s) => s.tempC).filter((t) => Number.isFinite(t));
    pairs.push({
      dayKey,
      hourIdx,
      label: `${dayKey} ${String((hourIdx + 1) % 24).padStart(2, "0")}:00`,
      fieldFt,
      medMm,
      spreadMm: stdev(mms),
      n: kept.length,
      dropped: window.length - kept.length,
      tempC: temps.length ? median(temps) : null,
      impliedElevFt: fieldFt + medMm * MM_TO_FT,
    });
  });
}

console.log(`\n=== HOURLY PAIRS MATCHED: ${pairs.length} ===`);
if (pairs.length === 0) process.exit(0);

// ---- implied sensor elevation (the calibration constant) ------------------
console.log("\n=== IMPLIED SENSOR ELEVATION PER DAY (ft) ===");
console.log("  a stable number = pure calibration offset; drift = sensor/mount problem");
const byDay = new Map();
for (const p of pairs) {
  if (!byDay.has(p.dayKey)) byDay.set(p.dayKey, []);
  byDay.get(p.dayKey).push(p);
}
for (const [dayKey, list] of [...byDay].sort()) {
  const elevs = list.map((p) => p.impliedElevFt);
  const med = median(elevs);
  console.log(
    `  ${dayKey}  n=${String(list.length).padStart(2)}  median=${med.toFixed(3)}  ` +
      `min=${Math.min(...elevs).toFixed(3)}  max=${Math.max(...elevs).toFixed(3)}  ` +
      `std=${(stdev(elevs) ?? 0).toFixed(3)}`,
  );
}
const allElev = pairs.map((p) => p.impliedElevFt);
console.log(
  `  POOLED     n=${allElev.length}  median=${median(allElev).toFixed(3)}  std=${(stdev(allElev) ?? 0).toFixed(3)}`,
);

// ---- shape test: does the sensor track hour-to-hour CHANGE? ---------------
console.log("\n=== SHAPE TEST (calibration-independent) ===");
const deltas = [];
for (let i = 1; i < pairs.length; i += 1) {
  const a = pairs[i - 1];
  const b = pairs[i];
  if (b.hourIdx !== a.hourIdx + 1 || b.dayKey !== a.dayKey) continue;
  deltas.push({
    label: b.label,
    fieldDelta: b.fieldFt - a.fieldFt,
    sensorDelta: -(b.medMm - a.medMm) * MM_TO_FT,
  });
}
const err = deltas.map((d) => d.sensorDelta - d.fieldDelta);
const meanAbs = err.reduce((s, e) => s + Math.abs(e), 0) / (err.length || 1);
const fieldSpan = Math.max(...pairs.map((p) => p.fieldFt)) - Math.min(...pairs.map((p) => p.fieldFt));
const sensorSpan =
  (Math.max(...pairs.map((p) => p.medMm)) - Math.min(...pairs.map((p) => p.medMm))) * MM_TO_FT;
console.log(`  hourly deltas compared: ${deltas.length}`);
console.log(`  mean |sensor delta - field delta| = ${meanAbs.toFixed(3)} ft (${(meanAbs * 304.8).toFixed(0)} mm)`);
console.log(`  total field range over log: ${fieldSpan.toFixed(2)} ft`);
console.log(`  total sensor range (same hours): ${sensorSpan.toFixed(2)} ft`);

// ---- residual with the currently deployed constant ------------------------
const DEPLOYED_ELEV_FT = 3212.21;
console.log(`\n=== RESIDUAL vs DEPLOYED sensorElevationFt=${DEPLOYED_ELEV_FT} ===`);
const residuals = pairs.map((p) => DEPLOYED_ELEV_FT - p.medMm * MM_TO_FT - p.fieldFt);
console.log(
  `  mean=${(residuals.reduce((a, b) => a + b, 0) / residuals.length).toFixed(3)} ft  ` +
    `median=${median(residuals).toFixed(3)} ft  ` +
    `min=${Math.min(...residuals).toFixed(3)}  max=${Math.max(...residuals).toFixed(3)}`,
);
const within = (tol) => residuals.filter((r) => Math.abs(r) <= tol).length;
console.log(
  `  within 0.05 ft: ${within(0.05)}/${residuals.length}   ` +
    `within 0.10 ft: ${within(0.1)}/${residuals.length}   ` +
    `within 0.25 ft: ${within(0.25)}/${residuals.length}`,
);

// ---- is the leftover error diurnal (speed-of-sound / thermal)? ------------
console.log("\n=== RESIDUAL BY HOUR OF DAY (ft, deployed constant) ===");
const byHour = new Map();
pairs.forEach((p, i) => {
  const hour = (p.hourIdx + 1) % 24;
  if (!byHour.has(hour)) byHour.set(hour, []);
  byHour.get(hour).push(residuals[i]);
});
for (const hour of [...byHour.keys()].sort((a, b) => a - b)) {
  const rs = byHour.get(hour);
  const bar = "#".repeat(Math.max(0, Math.round(Math.abs(median(rs)) * 100)));
  console.log(
    `  ${String(hour).padStart(2, "0")}:00  n=${String(rs.length).padStart(2)}  ` +
      `median=${median(rs).toFixed(3).padStart(7)}  ${bar}`,
  );
}

const slope = (xs) => {
  const mt = xs.reduce((a, b) => a + b.t, 0) / xs.length;
  const mr = xs.reduce((a, b) => a + b.r, 0) / xs.length;
  const cov = xs.reduce((a, b) => a + (b.t - mt) * (b.r - mr), 0);
  const varT = xs.reduce((a, b) => a + (b.t - mt) ** 2, 0);
  const m = cov / varT;
  const c = mr - m * mt;
  const ssTot = xs.reduce((a, b) => a + (b.r - mr) ** 2, 0);
  const ssRes = xs.reduce((a, b) => a + (b.r - (m * b.t + c)) ** 2, 0);
  return { m, c, r2: 1 - ssRes / ssTot };
};

const withTemp = pairs
  .map((p, i) => ({ t: p.tempC, r: residuals[i], day: p.dayKey }))
  .filter((x) => x.t != null);
if (withTemp.length > 5) {
  const raw = slope(withTemp);
  console.log(
    `\n  residual vs BMP280 temp (raw):       slope=${raw.m.toFixed(4)} ft/degC  ` +
      `R2=${raw.r2.toFixed(3)}  n=${withTemp.length}  ` +
      `span ${Math.min(...withTemp.map((x) => x.t)).toFixed(1)}-${Math.max(...withTemp.map((x) => x.t)).toFixed(1)} degC`,
  );

  // Day-detrended: removes slow calibration drift so only the WITHIN-day
  // thermal response remains.
  const dayMeans = new Map();
  for (const x of withTemp) {
    if (!dayMeans.has(x.day)) dayMeans.set(x.day, []);
    dayMeans.get(x.day).push(x);
  }
  const detrended = [];
  for (const list of dayMeans.values()) {
    if (list.length < 4) continue;
    const mt = list.reduce((a, b) => a + b.t, 0) / list.length;
    const mr = list.reduce((a, b) => a + b.r, 0) / list.length;
    for (const x of list) detrended.push({ t: x.t - mt, r: x.r - mr });
  }
  if (detrended.length > 5) {
    const dt = slope(detrended);
    console.log(
      `  residual vs temp (day-detrended):   slope=${dt.m.toFixed(4)} ft/degC  ` +
        `R2=${dt.r2.toFixed(3)}  n=${detrended.length}`,
    );
    const meanDist = pairs.reduce((a, p) => a + p.medMm, 0) / pairs.length;
    const theoretical = ((meanDist * 0.0017) / 1000) * 3.28084;
    console.log(
      `  fully-uncompensated speed-of-sound would be ~${theoretical.toFixed(4)} ft/degC ` +
        `at the mean ${Math.round(meanDist)} mm air gap`,
    );
    const resid2 = detrended.map((x) => x.r - dt.m * x.t);
    console.log(
      `  scatter after removing temp term: std=${(stdev(resid2) ?? 0).toFixed(3)} ft ` +
        `(was ${(stdev(detrended.map((x) => x.r)) ?? 0).toFixed(3)} ft)`,
    );
  }
}

if (process.argv.includes("--table")) {
  console.log("\n=== HOURLY TABLE ===");
  console.log("hour(IST)          field ft   sensor mm  n   spread  app ft    err ft   impliedElev");
  for (const p of pairs) {
    const appFt = DEPLOYED_ELEV_FT - p.medMm * MM_TO_FT;
    console.log(
      `${p.label}   ${p.fieldFt.toFixed(2)}   ${String(p.medMm).padStart(7)}  ` +
        `${String(p.n).padStart(3)}  ${(p.spreadMm ?? 0).toFixed(1).padStart(6)}  ` +
        `${appFt.toFixed(2)}  ${(appFt - p.fieldFt).toFixed(3).padStart(7)}   ${p.impliedElevFt.toFixed(3)}`,
    );
  }
}
