import { useMemo } from "react";
import clsx from "clsx";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { ANALYTICS_CONFIG } from "../config";
import { useNow } from "../hooks/useNow";
import { computeTrend, projectThresholdEta } from "../lib/analytics";
import type { DerivedReading, SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface TrendForecastCardProps {
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
}

export function TrendForecastCard({ reading, history, loadState }: TrendForecastCardProps) {
  const now = useNow();
  const trend = useMemo(() => computeTrend(history, now), [history, now]);
  const projection = useMemo(
    () => (reading ? projectThresholdEta(reading.waterLevelFt, trend) : null),
    [reading, trend],
  );
  const windowPoints = useMemo(() => {
    const cutoff = now - ANALYTICS_CONFIG.trendWindowMs;
    return history.filter((p) => p.t >= cutoff).map((p) => ({ t: p.t, ft: p.waterLevelFt }));
  }, [history, now]);
  const change24hFt = useMemo(
    () => (reading ? levelChangeSince(history, reading.waterLevelFt, now - DAY_MS) : null),
    [history, reading, now],
  );

  if (loadState === "loading" || !reading) {
    return <ListSkeleton rows={2} />;
  }

  const levels = windowPoints.map((p) => p.ft);
  const windowChangeFt = levels.length >= 2 ? levels[levels.length - 1] - levels[0] : null;
  const windowRangeFt = levels.length >= 2 ? Math.max(...levels) - Math.min(...levels) : null;

  // A "stable" rate is still a direction — say which way it leans rather than hiding it.
  const lean =
    trend.direction === "stable" && trend.rateFtPerHour !== null && trend.rateFtPerHour !== 0
      ? trend.rateFtPerHour > 0
        ? "Slowly rising · "
        : "Slowly falling · "
      : "";

  const toneClass =
    trend.direction === "rising"
      ? "text-warning-600 dark:text-warning-500"
      : trend.direction === "falling"
        ? "text-primary-600 dark:text-primary-400"
        : "text-neutral-700 dark:text-neutral-200";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Trend &amp; Forecast</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
          Last {Math.round(ANALYTICS_CONFIG.trendWindowMs / 60_000)} min
        </span>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col justify-center gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={clsx(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                trend.direction === "rising"
                  ? "bg-warning-50 dark:bg-warning-500/10"
                  : trend.direction === "falling"
                    ? "bg-primary-50 dark:bg-primary-500/10"
                    : "bg-neutral-100 dark:bg-neutral-800",
              )}
            >
              <TrendIcon direction={trend.direction} className={clsx("h-4.5 w-4.5", toneClass)} />
            </span>
            <div>
              <p className={clsx("text-base font-bold tabular-nums", toneClass)}>
                {trend.direction === "unknown"
                  ? "Insufficient data"
                  : trend.direction === "stable"
                    ? "Stable"
                    : `${trend.direction === "rising" ? "Rising" : "Falling"} ${Math.abs(trend.rateFtPerHour ?? 0).toFixed(3)} ft/hr`}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {trend.direction === "unknown"
                  ? `Need ${ANALYTICS_CONFIG.trendMinPoints}+ points spanning ${Math.round(ANALYTICS_CONFIG.trendMinSpanMs / 60_000)}+ min`
                  : `${lean}${Math.abs(trend.rateMmPerHour ?? 0).toFixed(1)} mm/hr · ${trend.windowPoints} pts / ${(trend.windowSpanMs / 60_000).toFixed(0)} min`}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 px-3 py-2 sm:min-w-60 dark:border-neutral-700">
            {projection ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Projected next crossing
                </p>
                <p className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-white">
                  {projection.label} ({projection.thresholdFt} ft)
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  in ~{formatEta(projection.etaMs)}, at the current rate
                </p>
              </>
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {trend.direction === "rising" || trend.direction === "falling"
                  ? "No threshold crossing projected within 30 days at the current rate."
                  : "No threshold crossing to project — level is stable."}
              </p>
            )}
          </div>
        </div>

        {windowPoints.length >= 2 && (
          <div className="h-24" aria-label="Water level over the trend window">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={windowPoints} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <YAxis hide domain={sparkDomain} />
                <Tooltip content={<SparkTooltip />} />
                <Line
                  type="monotone"
                  dataKey="ft"
                  stroke="#0f62fe"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat label={`Change, ${Math.round(ANALYTICS_CONFIG.trendWindowMs / 60_000)} min`} value={formatDelta(windowChangeFt)} />
          <Stat label="Change, 24 h" value={formatDelta(change24hFt)} />
          <Stat
            label={`Range, ${Math.round(ANALYTICS_CONFIG.trendWindowMs / 60_000)} min`}
            value={windowRangeFt === null ? "—" : `${windowRangeFt.toFixed(2)} ft`}
          />
        </div>
      </CardBody>
    </Card>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far from the target time a history point may sit and still stand in for it. */
const CHANGE_TOLERANCE_MS = 30 * 60 * 1000;

/** Current level minus the level nearest `atMs`, or null if nothing was recorded near then. */
function levelChangeSince(history: SessionHistoryPoint[], currentFt: number, atMs: number): number | null {
  let nearest: SessionHistoryPoint | null = null;
  for (const p of history) {
    if (!nearest || Math.abs(p.t - atMs) < Math.abs(nearest.t - atMs)) nearest = p;
  }
  if (!nearest || Math.abs(nearest.t - atMs) > CHANGE_TOLERANCE_MS) return null;
  return currentFt - nearest.waterLevelFt;
}

/** Pads the sparkline's y-range so a near-flat line isn't stretched into dramatic swings. */
function sparkDomain([min, max]: readonly [number, number]): [number, number] {
  const pad = Math.max(0.05 - (max - min), 0) / 2 + 0.01;
  return [min - pad, max + pad];
}

function formatDelta(ft: number | null): string {
  if (ft === null) return "—";
  const sign = ft > 0.005 ? "+" : ft < -0.005 ? "−" : "±";
  return `${sign}${Math.abs(ft).toFixed(2)} ft`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
      <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-white">{value}</p>
    </div>
  );
}

function SparkTooltip({ active, payload }: { active?: boolean; payload?: { payload: { t: number; ft: number } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-neutral-500 dark:text-neutral-400">
        {new Date(p.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </p>
      <p className="font-semibold tabular-nums text-neutral-900 dark:text-white">{p.ft.toFixed(2)} ft</p>
    </div>
  );
}

function formatEta(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)} min`;
  if (hours < 48) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

function TrendIcon({ direction, className }: { direction: string; className?: string }) {
  if (direction === "rising") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
        <path d="M4 17 10 11 14 15 20 7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (direction === "falling") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
        <path d="M4 7 10 13 14 9 20 17" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 17h6v-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path d="M4 12h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
