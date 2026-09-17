/**
 * Derived analytics on top of the QA-trusted pipeline output — trend/forecast,
 * alert-event history, device health, and fault breakdowns. Nothing here
 * touches Firebase or the fault-detection thresholds themselves; it only
 * replays the same exported classifiers (`classifyDistanceFault`,
 * `classifyJumpFault`, `classifyAlertLevel`) over a window of data so the
 * numbers shown to the department always agree with what the live pipeline
 * already decided.
 */
import { ANALYTICS_CONFIG, SITE_CONFIG } from "../config";
import { classifyDistanceFault, classifyJumpFault } from "./sensorQuality";
import { METERS_TO_FEET, classifyAlertLevel, resolveDeviceTimeMs, resolveDistanceMm } from "./waterLevel";
import type { AlertLevel, FaultCode, RawWaterMonitorReading, SessionHistoryPoint } from "../types";

// ---------------------------------------------------------------- trend

export type TrendDirection = "rising" | "falling" | "stable" | "unknown";

export interface TrendResult {
  direction: TrendDirection;
  rateFtPerHour: number | null;
  rateMmPerHour: number | null;
  windowPoints: number;
  windowSpanMs: number;
}

/**
 * Least-squares slope of water level (ft) vs. time over the trend window.
 * A regression instead of a two-point delta so a single noisy sample can't
 * swing the reported rate — the same reasoning as the pipeline's median
 * smoothing, applied to the derivative instead of the level itself.
 */
export function computeTrend(history: SessionHistoryPoint[], now: number): TrendResult {
  const cutoff = now - ANALYTICS_CONFIG.trendWindowMs;
  const pts = history.filter((p) => p.t >= cutoff);

  if (pts.length < ANALYTICS_CONFIG.trendMinPoints) {
    return { direction: "unknown", rateFtPerHour: null, rateMmPerHour: null, windowPoints: pts.length, windowSpanMs: 0 };
  }

  const windowSpanMs = pts[pts.length - 1].t - pts[0].t;
  if (windowSpanMs < ANALYTICS_CONFIG.trendMinSpanMs) {
    return { direction: "unknown", rateFtPerHour: null, rateMmPerHour: null, windowPoints: pts.length, windowSpanMs };
  }

  const t0 = pts[0].t;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of pts) {
    const x = p.t - t0;
    const y = p.waterLevelFt;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const n = pts.length;
  const denom = n * sumXX - sumX * sumX;
  const slopeFtPerMs = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const rateFtPerHour = slopeFtPerMs * 3_600_000;
  const rateMmPerHour = (rateFtPerHour / METERS_TO_FEET) * 1000;

  const direction: TrendDirection =
    Math.abs(rateFtPerHour) < ANALYTICS_CONFIG.stableRateFtPerHour
      ? "stable"
      : rateFtPerHour > 0
        ? "rising"
        : "falling";

  return { direction, rateFtPerHour, rateMmPerHour, windowPoints: n, windowSpanMs };
}

// ------------------------------------------------------- threshold ETA

export interface ThresholdProjection {
  label: string;
  thresholdFt: number;
  etaMs: number;
}

/**
 * Projects the current trend forward to the nearest threshold crossing —
 * either rising into Warning/Critical/FRL, or falling back out of them.
 * Returns null when the trend is stable/unknown, or when no threshold sits
 * ahead of the current level in the direction of travel within
 * `maxProjectionMs` (avoids a near-zero rate producing an absurd "in 400 days").
 */
export function projectThresholdEta(currentFt: number, trend: TrendResult): ThresholdProjection | null {
  if (trend.rateFtPerHour === null || trend.direction === "stable" || trend.direction === "unknown") return null;
  const rate = trend.rateFtPerHour;

  const candidates: { label: string; thresholdFt: number }[] = [
    { label: "Warning Zone", thresholdFt: SITE_CONFIG.warningLevelFt },
    { label: "Critical Zone", thresholdFt: SITE_CONFIG.criticalLevelFt },
    { label: "Full Reservoir Level", thresholdFt: SITE_CONFIG.fullCapacityFt },
  ];

  let best: ThresholdProjection | null = null;
  for (const c of candidates) {
    const deltaFt = c.thresholdFt - currentFt;
    if (deltaFt === 0 || Math.sign(deltaFt) !== Math.sign(rate)) continue;
    const etaHours = deltaFt / rate;
    if (etaHours <= 0) continue;
    const etaMs = etaHours * 3_600_000;
    if (etaMs > ANALYTICS_CONFIG.maxProjectionMs) continue;
    if (!best || etaMs < best.etaMs) best = { label: c.label, thresholdFt: c.thresholdFt, etaMs };
  }
  return best;
}

// --------------------------------------------------------- period stats

export interface PeriodStats {
  windowMs: number;
  count: number;
  minFt: number | null;
  maxFt: number | null;
  meanFt: number | null;
  firstFt: number | null;
  lastFt: number | null;
  netChangeFt: number | null;
}

export function computePeriodStats(history: SessionHistoryPoint[], windowMs: number, now: number): PeriodStats {
  const cutoff = now - windowMs;
  const pts = history.filter((p) => p.t >= cutoff);
  if (pts.length === 0) {
    return { windowMs, count: 0, minFt: null, maxFt: null, meanFt: null, firstFt: null, lastFt: null, netChangeFt: null };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of pts) {
    if (p.waterLevelFt < min) min = p.waterLevelFt;
    if (p.waterLevelFt > max) max = p.waterLevelFt;
    sum += p.waterLevelFt;
  }
  const first = pts[0].waterLevelFt;
  const last = pts[pts.length - 1].waterLevelFt;
  return {
    windowMs,
    count: pts.length,
    minFt: min,
    maxFt: max,
    meanFt: sum / pts.length,
    firstFt: first,
    lastFt: last,
    netChangeFt: last - first,
  };
}

// --------------------------------------------------------- alert events

export interface AlertEvent {
  level: AlertLevel;
  enteredAt: number;
  /** null while the event is still ongoing (has not returned to Normal). */
  exitedAt: number | null;
  /** null while ongoing — caller can compute against "now" for a live duration. */
  durationMs: number | null;
  peakFt: number;
  peakCapacityPct: number;
}

/**
 * Replays `classifyAlertLevel` (the same hysteresis logic the live pipeline
 * uses) over trusted history to reconstruct when the reservoir crossed into
 * and out of Warning/Critical — an audit trail of threshold breaches for the
 * department, not just the instantaneous current state.
 */
export function deriveAlertEvents(history: SessionHistoryPoint[]): AlertEvent[] {
  const events: AlertEvent[] = [];
  let prevLevel: AlertLevel | null = null;
  let current: AlertEvent | null = null;

  for (const p of history) {
    const level = classifyAlertLevel(p.waterLevelFt, prevLevel);

    if (level !== prevLevel) {
      if (current) {
        current.exitedAt = p.t;
        current.durationMs = current.exitedAt - current.enteredAt;
        events.push(current);
        current = null;
      }
      if (level !== "normal") {
        current = {
          level,
          enteredAt: p.t,
          exitedAt: null,
          durationMs: null,
          peakFt: p.waterLevelFt,
          peakCapacityPct: p.capacityPct,
        };
      }
    } else if (current && level !== "normal") {
      current.peakFt = Math.max(current.peakFt, p.waterLevelFt);
      current.peakCapacityPct = Math.max(current.peakCapacityPct, p.capacityPct);
    }

    prevLevel = level;
  }
  if (current) events.push(current);

  return events.reverse();
}

// --------------------------------------------------------- device health

export type HealthTier = "normal" | "low" | "critical" | "unknown";
export type SignalTier = "excellent" | "good" | "fair" | "poor" | "unknown";

export function classifyBattery(voltage: number | null): HealthTier {
  if (voltage === null || !Number.isFinite(voltage)) return "unknown";
  if (voltage >= ANALYTICS_CONFIG.batteryNormalV) return "normal";
  if (voltage >= ANALYTICS_CONFIG.batteryLowV) return "low";
  return "critical";
}

export function classifySignal(csq: number | null): SignalTier {
  if (csq === null || !Number.isFinite(csq) || csq < 0 || csq > 31 || csq === 99) return "unknown";
  if (csq >= ANALYTICS_CONFIG.signalExcellentCsq) return "excellent";
  if (csq >= ANALYTICS_CONFIG.signalGoodCsq) return "good";
  if (csq >= ANALYTICS_CONFIG.signalFairCsq) return "fair";
  return "poor";
}

/** Standard GSM CSQ → dBm mapping (3GPP TS 27.007 AT+CSQ). */
export function csqToDbm(csq: number): number {
  return -113 + 2 * csq;
}

// ------------------------------------------------------------- uptime

export interface UptimeStats {
  windowMs: number;
  actualCount: number;
  expectedCount: number;
  completenessPct: number;
  longestGapMs: number;
  firstT: number | null;
  lastT: number | null;
}

/**
 * Reporting completeness vs. the firmware's nominal 30s upload cadence.
 * This is a coarse estimate (device reboots, clock skew, and Firebase write
 * batching all move the actual count around), meant to flag sustained
 * under-reporting rather than to certify exact uptime.
 */
export function computeUptimeStats(
  rawHistory: RawWaterMonitorReading[],
  windowMs: number,
  now: number,
): UptimeStats {
  const cutoff = now - windowMs;
  const times: number[] = [];
  for (const raw of rawHistory) {
    const t = resolveDeviceTimeMs(raw);
    if (t !== null && t >= cutoff && t <= now) times.push(t);
  }
  times.sort((a, b) => a - b);

  const expectedCount = Math.max(1, Math.round(windowMs / ANALYTICS_CONFIG.expectedSampleIntervalMs));
  const completenessPct = Math.min(100, (times.length / expectedCount) * 100);

  let longestGapMs = 0;
  for (let i = 1; i < times.length; i++) {
    longestGapMs = Math.max(longestGapMs, times[i] - times[i - 1]);
  }

  return {
    windowMs,
    actualCount: times.length,
    expectedCount,
    completenessPct,
    longestGapMs,
    firstT: times[0] ?? null,
    lastT: times[times.length - 1] ?? null,
  };
}

// ------------------------------------------------------- fault breakdown

export interface FaultBreakdown {
  windowMs: number;
  totalSamples: number;
  rejectedSamples: number;
  rejectRatePct: number;
  counts: Partial<Record<FaultCode, number>>;
}

/**
 * Per-fault-type counts over a period, replaying the exact same classifiers
 * the live pipeline uses (`classifyDistanceFault`, `classifyJumpFault`), so
 * "27% rejected, mostly blind-zone" is answerable rather than just a single
 * aggregate reject-rate number.
 */
export function computeFaultBreakdown(
  rawHistory: RawWaterMonitorReading[],
  windowMs: number,
  now: number,
): FaultBreakdown {
  const cutoff = now - windowMs;
  const timed = rawHistory
    .map((raw) => ({ raw, t: resolveDeviceTimeMs(raw) }))
    .filter((r): r is { raw: RawWaterMonitorReading; t: number } => r.t !== null && r.t >= cutoff && r.t <= now)
    .sort((a, b) => a.t - b.t);

  const counts: Partial<Record<FaultCode, number>> = {};
  let rejected = 0;
  const bump = (code: FaultCode) => {
    counts[code] = (counts[code] ?? 0) + 1;
    rejected++;
  };

  let prevOk: { t: number; distanceMm: number } | null = null;
  for (const { raw, t } of timed) {
    const distanceMm = resolveDistanceMm(raw);
    const distFault = classifyDistanceFault(distanceMm);
    if (distFault) {
      bump(distFault);
      continue;
    }
    if (prevOk) {
      const jumpFault = classifyJumpFault(prevOk.distanceMm, distanceMm, t - prevOk.t);
      if (jumpFault) {
        bump(jumpFault);
        continue;
      }
    }
    prevOk = { t, distanceMm };
  }

  return {
    windowMs,
    totalSamples: timed.length,
    rejectedSamples: rejected,
    rejectRatePct: timed.length ? (rejected / timed.length) * 100 : 0,
    counts,
  };
}

// ------------------------------------------------------- diurnal profile

export interface HourBucket {
  hour: number;
  /** Days contributing to this hour. */
  count: number;
  /** Mean deviation from that day's own level, in feet. Null when no data. */
  meanFt: number | null;
  minFt: number | null;
  maxFt: number | null;
}

export interface DiurnalProfile {
  buckets: HourBucket[];
  /** Whole calendar days that survived detrending and fed the profile. */
  dayCount: number;
  /** Largest mean deviation minus the smallest, in feet. */
  swingFt: number | null;
  /** Hour with the highest mean level, or null when the profile is empty. */
  peakHour: number | null;
}

/**
 * Repeating daily rhythm in water level, as a deviation from each day's own
 * mean rather than an absolute level.
 *
 * Averaging raw levels by hour-of-day does not work here: over any window
 * short enough to load, the reservoir's own trend is far larger than the daily
 * rhythm, so an "hour-of-day" curve computed that way mostly plots the trend
 * and puts its peak on whichever hour happens to sit at the end of the window.
 *
 * Detrending each day separately — subtract a straight line fitted through
 * that day's hourly means before bucketing — cancels the trend and leaves only
 * what repeats at the same clock time. Run over 7-12 Aug 2026 this isolates a
 * ~36 mm (0.119 ft) oscillation peaking at 17:00-19:00 IST that the manual
 * staff-gauge log does not record. It is not thermal (see SITE_CONFIG), so it
 * is reported rather than corrected: either an evening operation the observer
 * is smoothing over, or an environmental echo effect worth investigating.
 *
 * Only days with at least `MIN_HOURS_PER_DAY` distinct hours are used — a
 * partial day cannot be detrended without the fit absorbing the trend itself —
 * and an hour is only reported once `MIN_DAYS_PER_HOUR` days agree on it, so a
 * single noisy evening cannot masquerade as a daily rhythm.
 */
const MIN_HOURS_PER_DAY = 12;
const MIN_DAYS_PER_HOUR = 2;

export function computeDiurnalProfile(history: SessionHistoryPoint[]): DiurnalProfile {
  // day -> hour -> levels
  const days = new Map<string, Map<number, number[]>>();
  for (const p of history) {
    const d = new Date(p.t);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let hours = days.get(dayKey);
    if (!hours) {
      hours = new Map();
      days.set(dayKey, hours);
    }
    const hour = d.getHours();
    const list = hours.get(hour);
    if (list) list.push(p.waterLevelFt);
    else hours.set(hour, [p.waterLevelFt]);
  }

  const buckets: number[][] = Array.from({ length: 24 }, () => []);
  let dayCount = 0;

  for (const hours of days.values()) {
    const points = [...hours.entries()]
      .map(([hour, levels]) => ({ hour, ft: mean(levels) }))
      .sort((a, b) => a.hour - b.hour);
    if (points.length < MIN_HOURS_PER_DAY) continue;

    const meanHour = mean(points.map((p) => p.hour));
    const meanFt = mean(points.map((p) => p.ft));
    let cov = 0;
    let varHour = 0;
    for (const p of points) {
      cov += (p.hour - meanHour) * (p.ft - meanFt);
      varHour += (p.hour - meanHour) ** 2;
    }
    const slope = varHour === 0 ? 0 : cov / varHour;

    for (const p of points) {
      buckets[p.hour].push(p.ft - (meanFt + slope * (p.hour - meanHour)));
    }
    dayCount++;
  }

  const result: HourBucket[] = buckets.map((values, hour) => {
    if (values.length < MIN_DAYS_PER_HOUR) {
      return { hour, count: values.length, meanFt: null, minFt: null, maxFt: null };
    }
    return {
      hour,
      count: values.length,
      meanFt: mean(values),
      minFt: Math.min(...values),
      maxFt: Math.max(...values),
    };
  });

  const means = result.map((b) => b.meanFt).filter((v): v is number => v !== null);
  const swingFt = means.length >= 2 ? Math.max(...means) - Math.min(...means) : null;
  const peak = result.reduce<HourBucket | null>(
    (best, b) => (b.meanFt !== null && (best === null || b.meanFt > best.meanFt!) ? b : best),
    null,
  );

  return { buckets: result, dayCount, swingFt, peakHour: peak ? peak.hour : null };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------- daily reliability

export interface DayReliability {
  /** Local calendar date, YYYY-MM-DD. */
  dateKey: string;
  dateLabel: string;
  completenessPct: number;
  rejectRatePct: number;
  actualCount: number;
}

/**
 * Per-calendar-day completeness and reject-rate, for the trailing N days —
 * a bird's-eye reliability record (which days had a flaky device / noisy
 * signal) that a single "reject rate" number can't show.
 */
export function computeDailyReliability(
  rawHistory: RawWaterMonitorReading[],
  days: number,
  now: number,
): DayReliability[] {
  const byDay = new Map<string, { raw: RawWaterMonitorReading; t: number }[]>();
  for (const raw of rawHistory) {
    const t = resolveDeviceTimeMs(raw);
    if (t === null) continue;
    const key = dayKey(t);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push({ raw, t });
  }

  const results: DayReliability[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = startOfLocalDay(now - i * 86_400_000);
    const key = dayKey(dayStart);
    const rows = (byDay.get(key) ?? []).sort((a, b) => a.t - b.t);

    const dayEnd = Math.min(dayStart + 86_400_000, now);
    const expected = Math.max(1, Math.round((dayEnd - dayStart) / ANALYTICS_CONFIG.expectedSampleIntervalMs));
    const completenessPct = Math.min(100, (rows.length / expected) * 100);

    let rejected = 0;
    let prevOk: { t: number; distanceMm: number } | null = null;
    for (const { raw, t } of rows) {
      const distanceMm = resolveDistanceMm(raw);
      const distFault = classifyDistanceFault(distanceMm);
      if (distFault) {
        rejected++;
        continue;
      }
      if (prevOk) {
        const jumpFault = classifyJumpFault(prevOk.distanceMm, distanceMm, t - prevOk.t);
        if (jumpFault) {
          rejected++;
          continue;
        }
      }
      prevOk = { t, distanceMm };
    }

    results.push({
      dateKey: key,
      dateLabel: new Date(dayStart).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      completenessPct,
      rejectRatePct: rows.length ? (rejected / rows.length) * 100 : 0,
      actualCount: rows.length,
    });
  }
  return results;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ------------------------------------------------- surface disturbance

export type SurfaceTier = "calm" | "moderate" | "rough" | "unknown";

export interface SurfaceDisturbance {
  tier: SurfaceTier;
  stdDevMm: number | null;
  sampleCount: number;
}

/**
 * How choppy the water surface currently is, from the spread of RAW
 * (pre-median, pre-fault-filter) distance samples in a short recent window —
 * a real wind/wave proxy, not an estimate: physical wave action is exactly
 * what makes consecutive echo distances disagree. This is diagnostic
 * context for why the QA filters might be busier than usual, not itself a
 * fault signal — see SITE_CONFIG's surfaceCalmMm/surfaceModerateMm for the
 * band derivation.
 */
export function computeSurfaceDisturbance(
  rawHistory: RawWaterMonitorReading[],
  windowMs: number,
  now: number,
): SurfaceDisturbance {
  const cutoff = now - windowMs;
  const values: number[] = [];
  for (const raw of rawHistory) {
    const t = resolveDeviceTimeMs(raw);
    if (t === null || t < cutoff || t > now) continue;
    const distanceMm = resolveDistanceMm(raw);
    if (classifyDistanceFault(distanceMm)) continue; // exclude outright faults, not just noise
    values.push(distanceMm);
  }
  if (values.length < 3) return { tier: "unknown", stdDevMm: null, sampleCount: values.length };

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  const stdDevMm = Math.sqrt(variance);

  const tier: SurfaceTier =
    stdDevMm < ANALYTICS_CONFIG.surfaceCalmMm
      ? "calm"
      : stdDevMm < ANALYTICS_CONFIG.surfaceModerateMm
        ? "moderate"
        : "rough";

  return { tier, stdDevMm, sampleCount: values.length };
}
