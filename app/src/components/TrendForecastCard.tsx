import { useMemo } from "react";
import clsx from "clsx";
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

  if (loadState === "loading" || !reading) {
    return <ListSkeleton rows={2} />;
  }

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
      <CardBody className="flex flex-1 flex-col justify-center">
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
                  : `${Math.abs(trend.rateMmPerHour ?? 0).toFixed(1)} mm/hr · ${trend.windowPoints} pts / ${(trend.windowSpanMs / 60_000).toFixed(0)} min`}
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
      </CardBody>
    </Card>
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
