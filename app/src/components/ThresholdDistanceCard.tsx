import clsx from "clsx";
import { SITE_CONFIG } from "../config";
import type { DerivedReading } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface ThresholdDistanceCardProps {
  reading: DerivedReading | null;
  loadState: "loading" | "ready" | "error";
}

/** The bar shows this much below the Warning line, so the normal band is visible too (ft). */
const BAR_BELOW_WARNING_FT = 10;

const BOUNDARIES = [
  { label: "Warning", ft: SITE_CONFIG.warningLevelFt, dot: "bg-warning-500" },
  { label: "Critical", ft: SITE_CONFIG.criticalLevelFt, dot: "bg-critical-500" },
  { label: "Full (FRL)", ft: SITE_CONFIG.fullCapacityFt, dot: "bg-neutral-400" },
] as const;

/** Where the current level sits between the alert boundaries, and how far each one is. */
export function ThresholdDistanceCard({ reading, loadState }: ThresholdDistanceCardProps) {
  if (loadState === "loading" || !reading) {
    return <ListSkeleton rows={3} />;
  }

  const barMin = SITE_CONFIG.warningLevelFt - BAR_BELOW_WARNING_FT;
  const barMax = SITE_CONFIG.fullCapacityFt;
  const pct = (ft: number) => Math.min(100, Math.max(0, ((ft - barMin) / (barMax - barMin)) * 100));
  const level = reading.waterLevelFt;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Distance to Alert Levels</CardTitle>
        <span className="text-xs font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
          Now {level.toFixed(2)} ft
        </span>
      </CardHeader>
      <CardBody>
        <div className="relative pt-5" aria-hidden="true">
          <div
            className="absolute top-0 -translate-x-1/2 text-[11px] font-semibold tabular-nums text-neutral-900 dark:text-white"
            style={{ left: `${pct(level)}%` }}
          >
            ▼
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full">
            <div className="bg-primary-500/40" style={{ width: `${pct(SITE_CONFIG.warningLevelFt)}%` }} />
            <div
              className="bg-warning-500/60"
              style={{ width: `${pct(SITE_CONFIG.criticalLevelFt) - pct(SITE_CONFIG.warningLevelFt)}%` }}
            />
            <div className="flex-1 bg-critical-500/60" />
          </div>
          <div className="relative mt-1 h-4 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
            <span className="absolute left-0">{barMin}</span>
            {BOUNDARIES.map((b) => (
              <span
                key={b.label}
                className={clsx("absolute", b.ft === barMax ? "right-0" : "-translate-x-1/2")}
                style={b.ft === barMax ? undefined : { left: `${pct(b.ft)}%` }}
              >
                {b.ft}
              </span>
            ))}
          </div>
        </div>

        <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
          {BOUNDARIES.map((b) => {
            const delta = b.ft - level;
            const above = delta <= 0;
            return (
              <li key={b.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex items-center gap-2 text-neutral-700 dark:text-neutral-200">
                  <span className={clsx("h-2 w-2 rounded-full", b.dot)} />
                  {b.label} <span className="tabular-nums text-neutral-400 dark:text-neutral-500">{b.ft} ft</span>
                </span>
                <span
                  className={clsx(
                    "font-semibold tabular-nums",
                    above ? "text-warning-600 dark:text-warning-500" : "text-neutral-900 dark:text-white",
                  )}
                >
                  {Math.abs(delta).toFixed(2)} ft {above ? "above" : "below"}
                </span>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
