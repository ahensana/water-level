import { ANALYTICS_CONFIG, SITE_CONFIG } from "../config";
import { classifyDistanceFault } from "./sensorQuality";
import {
  distanceToWaterLevelFt,
  METERS_TO_FEET,
  resolveDeviceTimeMs,
  resolveDistanceMm,
} from "./waterLevel";
import type { FaultCode, RawWaterMonitorReading } from "../types";

/**
 * Bucket sizes the interval report can be viewed at (ms).
 *
 * `RAW` shows every reading as its own row — the firmware cadence is ~30 s, so
 * this is the finest resolution that exists. Coarser buckets are medians, which
 * is what makes a comparison against an hourly logbook entry meaningful.
 */
export const RAW_GRANULARITY = 0;

export const GRANULARITIES = [
  { label: "Every reading", ms: RAW_GRANULARITY },
  { label: "1 minute", ms: 60_000 },
  { label: "5 minutes", ms: 5 * 60_000 },
  { label: "15 minutes", ms: 15 * 60_000 },
  { label: "30 minutes", ms: 30 * 60_000 },
  { label: "1 hour", ms: 3_600_000 },
  { label: "6 hours", ms: 6 * 3_600_000 },
  { label: "1 day", ms: 86_400_000 },
] as const;

/** One interval of the report, as an auditable row. */
export interface BucketRow {
  /** Start of the interval (ms since epoch, aligned to the local clock). */
  startMs: number;
  /** Samples that passed physical validation. */
  count: number;
  /** Samples rejected in this interval. */
  rejected: number;
  /** Median air gap across the interval (mm), or null if nothing valid. */
  distanceMm: number | null;
  waterLevelFt: number | null;
  waterLevelM: number | null;
  capacityPct: number | null;
  /** Std. dev. of the interval's raw distances (mm) — chop / echo scatter. */
  spreadMm: number | null;
  temperatureC: number | null;
  /**
   * Why this interval should not be trusted as a calibration reference, or null.
   *
   * The audit view intentionally shows samples the live jump filter suppresses,
   * so a sustained false echo appears here as an ordinary-looking row with a
   * healthy sample count. On the recorded feed that is a real case: one hour
   * reads 8.7 ft high off 72 valid samples. Calibrating to it would put a large
   * permanent error into every level on the dashboard, so suspect intervals are
   * marked and excluded from verification.
   */
  suspectReason: string | null;
}

export interface Stat {
  min: number;
  median: number;
  max: number;
  count: number;
}

export interface IntervalReport {
  fromMs: number;
  toMs: number;
  /** Readings received in the window, before validation. */
  totalSamples: number;
  validSamples: number;
  rejectedSamples: number;
  /** Received vs. what the firmware cadence implies for the span. */
  completenessPct: number;
  faultCounts: Partial<Record<FaultCode, number>>;
  levelFt: Stat | null;
  distanceMm: Stat | null;
  netChangeFt: number | null;
  temperatureC: Stat | null;
  pressureHpa: Stat | null;
  batteryV: Stat | null;
  signalCsq: Stat | null;
  /** Stretches longer than `GAP_MS` with no valid reading. */
  gaps: { fromMs: number; toMs: number }[];
  /** Bucket size these rows were aggregated at (ms); 0 = every reading. */
  bucketMs: number;
  buckets: BucketRow[];
  /**
   * Every physically-valid sample as (time, level), for point lookups.
   *
   * Verification needs the level at an arbitrary instant — whenever the operator
   * happened to read the gauge — which will rarely align with a bucket boundary.
   * Resolving that from buckets would quantise the comparison to the chosen
   * granularity and make the measured error depend on a display setting.
   */
  series: { t: number; levelFt: number }[];
}

const GAP_MS = 10 * 60 * 1000;

/**
 * Full breakdown of an arbitrary time window, for auditing the sensor against
 * the manual staff-gauge register.
 *
 * Deliberately reports the *physically valid* samples rather than the live
 * pipeline's fully-filtered stream. The pipeline's jump filter is tuned to keep
 * a live display stable and will suppress a step it cannot yet distinguish from
 * a false echo; that is right for a gauge and wrong for an audit, where the
 * operator needs to see what the sensor actually reported and judge it against
 * the logbook themselves. Rejected counts and per-interval scatter are surfaced
 * alongside so a suspect interval is still obvious.
 */
export function buildIntervalReport(
  readings: RawWaterMonitorReading[],
  fromMs: number,
  toMs: number,
  bucketMs: number = 3_600_000,
): IntervalReport {
  interface Sample {
    t: number;
    mm: number;
    fault: FaultCode | null;
    tempC: number | null;
    hPa: number | null;
    battV: number | null;
    csq: number | null;
  }

  const samples: Sample[] = [];
  for (const raw of readings) {
    const t = resolveDeviceTimeMs(raw);
    if (t == null || t < fromMs || t > toMs) continue;
    if (t < SITE_CONFIG.dataStartMs) continue;
    const mm = resolveDistanceMm(raw);
    samples.push({
      t,
      mm,
      fault: classifyDistanceFault(mm),
      tempC: finite(raw.temperature),
      hPa: finite(raw.pressure),
      battV: finite(raw.battery_voltage),
      csq: finite(raw.signal_strength),
    });
  }
  samples.sort((a, b) => a.t - b.t);

  const valid = samples.filter((s) => s.fault === null);

  const faultCounts: Partial<Record<FaultCode, number>> = {};
  for (const s of samples) {
    if (s.fault) faultCounts[s.fault] = (faultCounts[s.fault] ?? 0) + 1;
  }

  const levels = valid.map((s) => distanceToWaterLevelFt(s.mm));
  const expected = Math.max(1, Math.round((toMs - fromMs) / ANALYTICS_CONFIG.expectedSampleIntervalMs));

  const gaps: { fromMs: number; toMs: number }[] = [];
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].t - valid[i - 1].t >= GAP_MS) {
      gaps.push({ fromMs: valid[i - 1].t, toMs: valid[i].t });
    }
  }

  // Grouped by interval, aligned to the local clock so rows line up with the
  // register. At RAW granularity each reading is its own row.
  const grouped = new Map<number, Sample[]>();
  for (const s of samples) {
    const key = bucketMs === RAW_GRANULARITY ? s.t : bucketStart(s.t, bucketMs);
    const list = grouped.get(key);
    if (list) list.push(s);
    else grouped.set(key, [s]);
  }

  const buckets: BucketRow[] = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startMs, list]) => {
      const ok = list.filter((s) => s.fault === null);
      const mms = ok.map((s) => s.mm);
      const distance = mms.length ? median(mms) : null;
      const levelFt = distance === null ? null : distanceToWaterLevelFt(distance);
      const temps = ok.map((s) => s.tempC).filter(isNum);
      return {
        startMs,
        count: ok.length,
        rejected: list.length - ok.length,
        distanceMm: distance,
        waterLevelFt: levelFt,
        waterLevelM: levelFt === null ? null : levelFt / METERS_TO_FEET,
        capacityPct: levelFt === null ? null : (levelFt / SITE_CONFIG.fullCapacityFt) * 100,
        spreadMm: mms.length > 1 ? stdev(mms) : null,
        temperatureC: temps.length ? median(temps) : null,
        suspectReason: null as string | null,
      };
    });

  flagSuspectBuckets(buckets);

  return {
    fromMs,
    toMs,
    totalSamples: samples.length,
    validSamples: valid.length,
    rejectedSamples: samples.length - valid.length,
    completenessPct: Math.min(100, (samples.length / expected) * 100),
    faultCounts,
    levelFt: stat(levels),
    distanceMm: stat(valid.map((s) => s.mm)),
    netChangeFt: levels.length >= 2 ? levels[levels.length - 1] - levels[0] : null,
    temperatureC: stat(samples.map((s) => s.tempC).filter(isNum)),
    pressureHpa: stat(samples.map((s) => s.hPa).filter(isNum)),
    batteryV: stat(samples.map((s) => s.battV).filter(isNum)),
    signalCsq: stat(samples.map((s) => s.csq).filter(isNum)),
    gaps,
    bucketMs,
    buckets,
    series: valid.map((s, i) => ({ t: s.t, levelFt: levels[i] })),
  };
}

/** Start of the local-clock interval containing `t`. */
function bucketStart(t: number, bucketMs: number): number {
  // Shift by the zone offset before flooring so day and hour buckets begin at
  // local midnight / the local hour rather than at a UTC boundary.
  const offsetMs = new Date(t).getTimezoneOffset() * 60_000;
  return Math.floor((t - offsetMs) / bucketMs) * bucketMs + offsetMs;
}

/**
 * How far either side of an interval to look when establishing what the level
 * "should" be there.
 *
 * Measured in time, not in rows, which matters: a neighbourhood of ±3 rows spans
 * three minutes at raw granularity, so an echo lasting an hour sits entirely
 * inside its own neighbours, they agree with each other, and nothing is flagged.
 * On the recorded feed that let a +11.3 ft artefact through at raw granularity
 * while the same artefact was caught at hourly. A fixed time span makes the
 * verdict independent of the display setting, which is the behaviour an operator
 * needs — zooming in must not make a bad interval look acceptable.
 */
const NEIGHBOUR_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Marks intervals that must not be used as a calibration reference.
 *
 * Two independent signals, because they catch different failures:
 *
 *  - A level far from the local trend. The baseline is the median over
 *    `NEIGHBOUR_WINDOW_MS` either side, which a sustained artefact cannot
 *    dominate, and which moves with genuine inflow so real level changes are not
 *    flagged.
 *  - Scatter far above the window's own norm, which is what a stilling well
 *    picking up two competing echoes looks like even when the median is stable.
 */
/** Fallback context width, in rows, when the time window falls in a data gap. */
const MIN_NEIGHBOURS = 8;

/**
 * Smallest deviation that can ever be called suspect (ft).
 *
 * Comfortably above the ~0.119 ft daily oscillation the sensor shows and the
 * register does not, so the known artefact is never flagged as a fault.
 */
const STEP_LIMIT_FLOOR_FT = 0.4;

function flagSuspectBuckets(buckets: BucketRow[]): void {
  const withLevel = buckets.filter((b) => b.waterLevelFt !== null);
  if (withLevel.length < 4) return;

  const spreads = withLevel.map((b) => b.spreadMm).filter(isNum);
  // Robust scatter ceiling: typical interval, tripled, with a floor so a very
  // quiet window does not flag ordinary surface chop.
  const spreadLimit = spreads.length ? Math.max(25, median(spreads) * 3) : Infinity;

  // Ceiling on the step limit: the fastest the reservoir could legitimately
  // move across the neighbourhood. The limit never exceeds this, so a genuine
  // filling event is never called an echo.
  const maxStepLimit = Math.max(
    STEP_LIMIT_FLOOR_FT,
    (SITE_CONFIG.maxLevelChangeFtPerHour * NEIGHBOUR_WINDOW_MS) / 3_600_000,
  );

  // Two pointers over the time-sorted rows keep this linear rather than
  // quadratic, which matters at raw granularity over a month (~89k rows).
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < withLevel.length; i++) {
    const bucket = withLevel[i];
    while (lo < withLevel.length && withLevel[lo].startMs < bucket.startMs - NEIGHBOUR_WINDOW_MS) lo++;
    while (hi < withLevel.length && withLevel[hi].startMs <= bucket.startMs + NEIGHBOUR_WINDOW_MS) hi++;

    // Widen by row count when the time window lands in an outage. Without this,
    // an interval bordered by a gap gets too little context to judge and escapes
    // unflagged — which is precisely where echoes cluster, since the same fault
    // that drops uploads also produces bad returns.
    let lowIndex = lo;
    let highIndex = hi;
    if (highIndex - lowIndex - 1 < MIN_NEIGHBOURS) {
      lowIndex = Math.max(0, i - MIN_NEIGHBOURS);
      highIndex = Math.min(withLevel.length, i + MIN_NEIGHBOURS + 1);
    }

    const neighbours: number[] = [];
    for (let j = lowIndex; j < highIndex; j++) {
      if (j !== i) neighbours.push(withLevel[j].waterLevelFt!);
    }

    // Scatter is judged on the interval's own samples, so it stands on its own
    // even where there is no usable neighbourhood.
    if (bucket.spreadMm !== null && bucket.spreadMm > spreadLimit) {
      bucket.suspectReason = `Echo scatter ${bucket.spreadMm.toFixed(0)} mm — unstable return`;
    }

    if (neighbours.length < 3) continue;
    const local = median(neighbours);
    const delta = Math.abs(bucket.waterLevelFt! - local);

    // Scale the limit to how much the neighbourhood is itself moving, via its
    // median absolute deviation. A flat reservoir makes any sizeable excursion
    // obviously an echo; one that is genuinely filling widens the limit so its
    // real trend is not mistaken for one. Fixing the limit at the worst-case
    // fill rate instead left ~1.4 ft spikes unflagged against a dead-flat
    // record, which is the opposite of what an operator would call suspect.
    const mad = median(neighbours.map((n) => Math.abs(n - local)));
    const stepLimit = Math.min(maxStepLimit, Math.max(STEP_LIMIT_FLOOR_FT, mad * 8));

    if (delta > stepLimit) {
      bucket.suspectReason = `${delta.toFixed(2)} ft from surrounding readings — likely false echo`;
    }
  }
}

function isNum(v: number | null): v is number {
  return v !== null;
}

function finite(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stat(values: number[]): Stat | null {
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values),
    count: values.length,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
}

/** How far either side of a manual reading to look for sensor samples. */
const MATCH_WINDOW_MS = 15 * 60 * 1000;

export interface CheckResult {
  id: string;
  atMs: number;
  gaugeFt: number;
  /** Median sensor level around `atMs`, or null if nothing valid was near. */
  sensorFt: number | null;
  /** sensor − gauge (ft). Positive means the sensor reads high. */
  deviationFt: number | null;
  /** Valid samples that went into `sensorFt`. */
  sampleCount: number;
  /** Set when the surrounding data is not fit to calibrate against. */
  suspectReason: string | null;
}

export interface VerificationSummary {
  results: CheckResult[];
  /** Checks that produced a usable, non-suspect comparison. */
  usable: CheckResult[];
  medianDeviationFt: number | null;
  /** Largest absolute deviation — the figure the tolerance is judged on. */
  maxAbsDeviationFt: number | null;
  /** True when every usable check is inside `toleranceFt`. */
  withinTolerance: boolean;
  toleranceFt: number;
  /** Trim that would centre the usable checks on zero. */
  suggestedOffsetFt: number | null;
}

/**
 * Scores manual gauge readings against the sensor record.
 *
 * The offset is suggested from the MEDIAN deviation, not the mean: a single
 * mis-transcribed logbook entry or an unnoticed echo would drag a mean and
 * silently bias the calibration, whereas the median ignores it. The verdict, by
 * contrast, is judged on the WORST deviation — an average inside tolerance tells
 * you nothing useful if individual hours are far outside it.
 */
export function verifyAgainstGauge(
  report: IntervalReport,
  checks: { id: string; atMs: number; gaugeFt: number }[],
  toleranceFt: number,
): VerificationSummary {
  const results: CheckResult[] = checks.map((check) => {
    if (!Number.isFinite(check.gaugeFt) || !Number.isFinite(check.atMs)) {
      return {
        id: check.id,
        atMs: check.atMs,
        gaugeFt: check.gaugeFt,
        sensorFt: null,
        deviationFt: null,
        sampleCount: 0,
        suspectReason: "Reading is not a valid number",
      };
    }

    const near = report.series.filter((p) => Math.abs(p.t - check.atMs) <= MATCH_WINDOW_MS);
    const sensorFt = near.length ? median(near.map((p) => p.levelFt)) : null;

    // Exclude if ANY interval overlapping the match window was flagged, rather
    // than only the one containing the instant. At fine granularities an
    // interval is shorter than a second of clock time, so a check would often
    // fall between two rows and inherit no verdict at all — silently readmitting
    // exactly the false echoes the flag exists to keep out.
    const flagged = report.buckets.find(
      (b) => Math.abs(b.startMs - check.atMs) <= MATCH_WINDOW_MS && b.suspectReason !== null,
    );

    return {
      id: check.id,
      atMs: check.atMs,
      gaugeFt: check.gaugeFt,
      sensorFt,
      deviationFt: sensorFt === null ? null : sensorFt - check.gaugeFt,
      sampleCount: near.length,
      suspectReason:
        sensorFt === null
          ? "No sensor data within 15 minutes of this reading"
          : (flagged?.suspectReason ?? null),
    };
  });

  const usable = results.filter((r) => r.deviationFt !== null && !r.suspectReason);
  const deviations = usable.map((r) => r.deviationFt!);
  const medianDeviationFt = deviations.length ? median(deviations) : null;
  const maxAbsDeviationFt = deviations.length ? Math.max(...deviations.map(Math.abs)) : null;

  return {
    results,
    usable,
    medianDeviationFt,
    maxAbsDeviationFt,
    withinTolerance: maxAbsDeviationFt !== null && maxAbsDeviationFt <= toleranceFt,
    toleranceFt,
    suggestedOffsetFt: medianDeviationFt === null ? null : -medianDeviationFt,
  };
}

/** CSV of the interval rows — the format the site files against the register. */
export function intervalReportToCsv(report: IntervalReport): string {
  const header = [
    "interval_start_local",
    "interval_start_iso",
    "samples",
    "rejected",
    "distance_mm",
    "water_level_ft",
    "water_level_m",
    "capacity_pct",
    "scatter_mm",
    "temperature_c",
    "suspect_reason",
  ].join(",");
  const rows = report.buckets.map((h) =>
    [
      // Locale formats embed a comma between date and time.
      `"${new Date(h.startMs).toLocaleString("en-IN", { hour12: false })}"`,
      new Date(h.startMs).toISOString(),
      h.count,
      h.rejected,
      h.distanceMm === null ? "" : Math.round(h.distanceMm),
      h.waterLevelFt?.toFixed(3) ?? "",
      h.waterLevelM?.toFixed(3) ?? "",
      h.capacityPct?.toFixed(2) ?? "",
      h.spreadMm?.toFixed(1) ?? "",
      h.temperatureC?.toFixed(1) ?? "",
      // Reasons contain commas and would otherwise break the column layout.
      h.suspectReason ? `"${h.suspectReason.replace(/"/g, '""')}"` : "",
    ].join(","),
  );
  return [header, ...rows].join("\r\n");
}

/** CSV of the gauge-verification register, for filing with the calibration record. */
export function verificationToCsv(summary: VerificationSummary): string {
  const header = [
    "reading_local",
    "reading_iso",
    "gauge_ft",
    "sensor_ft",
    "deviation_ft",
    "deviation_mm",
    "samples_matched",
    "within_tolerance",
    "excluded_reason",
  ].join(",");
  const rows = summary.results.map((r) =>
    [
      `"${new Date(r.atMs).toLocaleString("en-IN", { hour12: false })}"`,
      new Date(r.atMs).toISOString(),
      r.gaugeFt.toFixed(2),
      r.sensorFt?.toFixed(3) ?? "",
      r.deviationFt?.toFixed(3) ?? "",
      r.deviationFt === null ? "" : (r.deviationFt * 304.8).toFixed(0),
      r.sampleCount,
      r.deviationFt === null || r.suspectReason
        ? ""
        : Math.abs(r.deviationFt) <= summary.toleranceFt
          ? "yes"
          : "no",
      r.suspectReason ? `"${r.suspectReason.replace(/"/g, '""')}"` : "",
    ].join(","),
  );
  const verdict = [
    "",
    `"Tolerance",${summary.toleranceFt.toFixed(2)} ft`,
    `"Checks used",${summary.usable.length} of ${summary.results.length}`,
    `"Median deviation",${summary.medianDeviationFt?.toFixed(3) ?? ""} ft`,
    `"Max absolute deviation",${summary.maxAbsDeviationFt?.toFixed(3) ?? ""} ft`,
    `"Verdict",${summary.usable.length === 0 ? "NOT VERIFIED" : summary.withinTolerance ? "PASS" : "FAIL"}`,
  ];
  return [header, ...rows, ...verdict].join("\r\n");
}
