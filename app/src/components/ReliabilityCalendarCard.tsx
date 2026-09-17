import { useMemo, useState } from "react";
import clsx from "clsx";
import { ANALYTICS_CONFIG } from "../config";
import { useNow } from "../hooks/useNow";
import { computeDailyReliability, type DayReliability } from "../lib/analytics";
import type { RawWaterMonitorReading } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface ReliabilityCalendarCardProps {
  rawHistory: RawWaterMonitorReading[];
  loadState: "loading" | "ready" | "error";
}

function cellTone(pct: number): string {
  if (pct >= 90) return "bg-success-500";
  if (pct >= 70) return "bg-success-400";
  if (pct >= 40) return "bg-warning-500";
  if (pct > 0) return "bg-critical-500";
  return "bg-neutral-200 dark:bg-neutral-800";
}

/**
 * One cell per trailing calendar day, shaded by reporting completeness —
 * a device-reliability record at a glance (which days the node was flaky)
 * that a single rolled-up percentage can't show.
 */
export function ReliabilityCalendarCard({ rawHistory, loadState }: ReliabilityCalendarCardProps) {
  const now = useNow();
  const days = useMemo(
    () => computeDailyReliability(rawHistory, ANALYTICS_CONFIG.reliabilityCalendarDays, now),
    [rawHistory, now],
  );
  const [hovered, setHovered] = useState<DayReliability | null>(null);

  if (loadState === "loading") {
    return <ListSkeleton rows={2} />;
  }

  const active = hovered ?? days[days.length - 1] ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporting Reliability</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
          Trailing {ANALYTICS_CONFIG.reliabilityCalendarDays} days
        </span>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <button
              key={d.dateKey}
              type="button"
              onMouseEnter={() => setHovered(d)}
              onFocus={() => setHovered(d)}
              onMouseLeave={() => setHovered(null)}
              onBlur={() => setHovered(null)}
              className={clsx(
                "h-8 w-8 shrink-0 rounded-md transition-transform hover:scale-110 focus-visible:scale-110",
                cellTone(d.completenessPct),
              )}
              aria-label={`${d.dateLabel}: ${d.completenessPct.toFixed(0)}% reporting completeness, ${d.rejectRatePct.toFixed(0)}% rejected`}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-neutral-200 pt-2.5 dark:border-neutral-800">
          {active ? (
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">{active.dateLabel}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {active.completenessPct.toFixed(0)}% reporting · {active.actualCount} readings ·{" "}
                {active.rejectRatePct.toFixed(1)}% rejected
              </p>
            </div>
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">No data in this window yet.</p>
          )}
          <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">
            <span className="h-2.5 w-2.5 rounded-sm bg-critical-500" />
            <span>Poor</span>
            <span className="h-2.5 w-2.5 rounded-sm bg-warning-500" />
            <span>Partial</span>
            <span className="h-2.5 w-2.5 rounded-sm bg-success-500" />
            <span>Good</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
