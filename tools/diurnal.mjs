/**
 * Isolates the daily oscillation the A01 shows but the staff-gauge log does not.
 *
 * Method: for each clean day, fit and remove a straight line through the day's
 * sensor distances (that removes the genuine reservoir trend), then average the
 * leftover by hour of day. A real level change would not repeat at the same
 * clock time every day; an environmental/thermal artefact would.
 *
 * Usage: node tools/diurnal.mjs
 */
import fs from "node:fs";

const MM_TO_FT = 3.28084 / 1000;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const CLEAN_DAYS = ["2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"];

const raw = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url)));
const samples = Object.values(raw)
  .filter((r) => Number.isFinite(r?.distance) && Number.isFinite(r?.timestamp))
  .filter((r) => r.distance >= 280 && r.distance <= 6500)
  .map((r) => ({ t: r.timestamp, mm: r.distance, tempC: r.temperature ?? null }))
  .sort((a, b) => a.t - b.t);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const istDay = (t) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
const istHour = (t) => new Date(t + IST_OFFSET_MS).getUTCHours();

/** hour -> array of detrended residuals (mm), and hour -> temps */
const byHour = new Map();
const tempByHour = new Map();

for (const day of CLEAN_DAYS) {
  const list = samples.filter((s) => istDay(s.t) === day);
  if (list.length < 100) continue;

  // Hourly medians first, so echo dither doesn't dominate the line fit.
  const hourly = [];
  for (let h = 0; h < 24; h += 1) {
    const inHour = list.filter((s) => istHour(s.t) === h);
    if (inHour.length < 10) continue;
    hourly.push({ h, mm: median(inHour.map((s) => s.mm)), tempC: median(inHour.map((s) => s.tempC).filter(Number.isFinite)) });
  }
  if (hourly.length < 18) continue;

  const mh = hourly.reduce((a, b) => a + b.h, 0) / hourly.length;
  const mm = hourly.reduce((a, b) => a + b.mm, 0) / hourly.length;
  const cov = hourly.reduce((a, b) => a + (b.h - mh) * (b.mm - mm), 0);
  const varH = hourly.reduce((a, b) => a + (b.h - mh) ** 2, 0);
  const slope = cov / varH;

  for (const p of hourly) {
    const resid = p.mm - (mm + slope * (p.h - mh));
    if (!byHour.has(p.h)) byHour.set(p.h, []);
    byHour.get(p.h).push(resid);
    if (Number.isFinite(p.tempC)) {
      if (!tempByHour.has(p.h)) tempByHour.set(p.h, []);
      tempByHour.get(p.h).push(p.tempC);
    }
  }
}

console.log("=== DETRENDED SENSOR DISTANCE BY HOUR OF DAY ===");
console.log(`(${CLEAN_DAYS.length} clean days; positive mm = sensor reads FARTHER = level appears LOWER)`);
console.log("\nhour  n   resid mm   as ft     air degC   profile");
const rows = [];
for (let h = 0; h < 24; h += 1) {
  const rs = byHour.get(h);
  if (!rs) continue;
  const med = median(rs);
  const temp = tempByHour.has(h) ? median(tempByHour.get(h)) : null;
  rows.push({ h, med, n: rs.length, temp });
}
const maxAbs = Math.max(...rows.map((r) => Math.abs(r.med)));
for (const r of rows) {
  const width = Math.round((r.med / maxAbs) * 20);
  const bar = width >= 0 ? " ".repeat(20) + "|" + "#".repeat(width) : " ".repeat(20 + width) + "#".repeat(-width) + "|";
  console.log(
    `${String(r.h).padStart(2, "0")}:00 ${String(r.n).padStart(2)}  ${r.med.toFixed(1).padStart(7)}  ` +
      `${(-r.med * MM_TO_FT).toFixed(3).padStart(7)}  ${(r.temp ?? NaN).toFixed(1).padStart(7)}   ${bar}`,
  );
}

const swingMm = Math.max(...rows.map((r) => r.med)) - Math.min(...rows.map((r) => r.med));
console.log(`\npeak-to-peak daily swing: ${swingMm.toFixed(1)} mm (${(swingMm * MM_TO_FT).toFixed(3)} ft)`);

const hottest = rows.reduce((a, b) => ((b.temp ?? -99) > (a.temp ?? -99) ? b : a));
const nearest = rows.reduce((a, b) => (b.med < a.med ? b : a));
console.log(`hottest hour: ${String(hottest.h).padStart(2, "0")}:00 (${hottest.temp?.toFixed(1)} degC)`);
console.log(`hour sensor reads NEAREST (level looks highest): ${String(nearest.h).padStart(2, "0")}:00`);

// Correlate the two hour-of-day profiles, and with lag.
const withTemp = rows.filter((r) => Number.isFinite(r.temp));
const corr = (a, b) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  const cov = a.reduce((s, _, i) => s + (a[i] - ma) * (b[i] - mb), 0);
  return cov / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
};
console.log("\ncorrelation of residual profile vs temperature profile, by lag:");
for (let lag = 0; lag <= 6; lag += 1) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < withTemp.length; i += 1) {
    const src = withTemp[(i - lag + withTemp.length) % withTemp.length];
    xs.push(src.temp);
    ys.push(withTemp[i].med);
  }
  console.log(`  temp lagged ${lag} h -> r = ${corr(xs, ys).toFixed(3)}`);
}
