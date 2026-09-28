/**
 * Regression check for the jump filter's escape hatch (`isSustainedStep`).
 *
 * The jump filter measures every sample against the last accepted one, so a
 * wrong baseline rejects every correct reading that follows. The escape hatch
 * is the only way back, and it has now failed twice in production:
 *   - 3-4 Aug 2026: no escape hatch at all; the gauge froze at 3210.92 ft
 *     ("Critical") for 17 hours.
 *   - 28 Sep 2026: the hatch tested the spread of the whole pending buffer,
 *     which is never trimmed, so one 2529 mm outlier at 13:52 held the spread
 *     at 1526 mm against a 40 mm limit — permanently. The sensor then held
 *     1973-1991 mm for an hour and the gauge stayed latched on an earlier
 *     1003 mm false echo, 3.2 ft off the register.
 *
 * Both failures are silent: the dashboard shows a confident, wrong number.
 * This check asserts the properties that prevent them, against the real feed.
 *
 * Usage: npx tsx tools/resyncCheck.ts
 */
import fs from "node:fs";
import { isSustainedStep } from "../app/src/lib/sensorQuality";
import { SITE_CONFIG } from "../app/src/config";
import type { RawWaterMonitorReading } from "../app/src/types";

type Sample = { t: number; distanceMm: number };

/** The rule as it stood before 28 Sep 2026: spread across the entire buffer. */
function isSustainedStepBufferWide(pending: Sample[]): boolean {
  if (pending.length < SITE_CONFIG.resyncMinSamples) return false;
  if (pending[pending.length - 1].t - pending[0].t < SITE_CONFIG.resyncAfterMs) return false;
  const values = pending.map((p) => p.distanceMm);
  return Math.max(...values) - Math.min(...values) <= SITE_CONFIG.resyncSpreadMm;
}

function main(): void {
  const dump = JSON.parse(
    fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8"),
  ) as Record<string, RawWaterMonitorReading>;

  const samples: Sample[] = Object.values(dump)
    .filter(
      (r) =>
        r &&
        Number.isFinite(r.distance as number) &&
        Number.isFinite(r.timestamp as number) &&
        (r.distance as number) >= SITE_CONFIG.minValidDistanceMm &&
        (r.distance as number) <= SITE_CONFIG.maxValidDistanceMm,
    )
    .map((r) => ({ t: r.timestamp as number, distanceMm: r.distance as number }))
    .sort((a, b) => a.t - b.t);

  console.log(`=== RESYNC CHECK === ${samples.length} physically valid samples\n`);

  let failures = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };

  const hour = SITE_CONFIG.resyncAfterMs;
  const minN = SITE_CONFIG.resyncMinSamples;
  const spread = SITE_CONFIG.resyncSpreadMm;
  const base = 1980;
  const at = (minsAgo: number) => 1_790_000_000_000 - minsAgo * 60_000;

  // A steady run long enough to be a real step.
  const steady: Sample[] = [];
  for (let i = 0; i <= 120; i++) {
    steady.push({ t: at(120 - i), distanceMm: base + (i % 3) * 5 });
  }
  check(isSustainedStep(steady), "an hour of agreeing samples resyncs");

  // The 28 Sep shape: one wild outlier, then an hour of agreement.
  const poisoned: Sample[] = [{ t: at(121), distanceMm: 2529 }, ...steady];
  check(
    isSustainedStep(poisoned),
    "one early outlier does not block a later steady run",
    `old rule: ${isSustainedStepBufferWide(poisoned) ? "resyncs" : "stays latched"}`,
  );
  check(
    !isSustainedStepBufferWide(poisoned),
    "the old buffer-wide rule is what failed on this shape",
  );

  // Guards that must survive the change: a short run, and a drifting one.
  check(!isSustainedStep(steady.slice(-Math.min(minN - 1, 10))), "too few samples never resyncs");
  const brief = steady.filter((s) => s.t >= at(30));
  check(!isSustainedStep(brief), "half an hour of agreement is not enough");
  const drifting = steady.map((s, i) => ({ t: s.t, distanceMm: base + i * (spread / 10) }));
  check(!isSustainedStep(drifting), "a run that drifts past the spread limit never resyncs");

  // Against the live feed: the trailing agreeing run, and when it can resync.
  const recent = samples.filter((s) => s.t >= samples[samples.length - 1].t - 6 * 60 * 60 * 1000);
  if (recent.length > minN) {
    const newest = recent[recent.length - 1];
    let min = newest.distanceMm;
    let max = newest.distanceMm;
    let oldest = newest;
    let count = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const nextMin = Math.min(min, recent[i].distanceMm);
      const nextMax = Math.max(max, recent[i].distanceMm);
      if (nextMax - nextMin > spread) break;
      min = nextMin;
      max = nextMax;
      oldest = recent[i];
      count++;
    }
    const spanMin = (newest.t - oldest.t) / 60_000;
    console.log(
      `\nlive feed: trailing agreeing run ${count} samples, ${spanMin.toFixed(0)} min, ` +
        `${min}-${max} mm (resync at ${hour / 60_000} min)`,
    );
    console.log(`  isSustainedStep now: ${isSustainedStep(recent)}`);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
