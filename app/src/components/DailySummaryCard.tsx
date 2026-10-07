import { useMemo } from "react";
import clsx from "clsx";
import type { SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface DailySummaryCardProps {
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
}

const DAYS_SHOWN = 7;

interface DaySummary {
  key: string;
  label: string;
  lowFt: number;
  highFt: number;
  closeFt: number;
  count: number;
  changeFt: number | null;
}

/** Low / high / closing level per local day, newest first — the register's view of the trusted feed. */
function summariseDays(history: SessionHistoryPoint[]): DaySummary[] {
  const byDay = new Map<string, SessionHistoryPoint[]>();
  for (const p of history) {
    if (!p.trusted) continue;
    const d = new Date(p.t);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = byDay.get(key);
    if (list) list.push(p);
    else byDay.set(key, [p]);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, pts]) => {
      const sorted = [...pts].sort((a, b) => a.t - b.t);
      const levels = sorted.map((p) => p.waterLevelFt);
      return {
        key,
        label: new Date(sorted[0].t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
        lowFt: Math.min(...levels),
        highFt: Math.max(...levels),
        closeFt: levels[levels.length - 1],
        count: sorted.length,
        changeFt: null as number | null,
      };
    });

  // Change is against the previous day that has data, which may not be yesterday if the feed was down.
  for (let i = 1; i < days.length; i++) days[i].changeFt = days[i].closeFt - days[i - 1].closeFt;

  return days.slice(-DAYS_SHOWN).reverse();
}

export function DailySummaryCard({ history, loadState }: DailySummaryCardProps) {
  const days = useMemo(() => summariseDays(history), [history]);

  if (loadState === "loading") {
    return <ListSkeleton rows={4} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Summary</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
          Last {days.length} day{days.length === 1 ? "" : "s"} with data · ft
        </span>
      </CardHeader>
      <CardBody>
        {days.length === 0 ? (
          <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
            No trusted readings in the loaded history yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  <th className="pb-1.5 font-medium">Day</th>
                  <th className="pb-1.5 text-right font-medium">Low</th>
                  <th className="pb-1.5 text-right font-medium">High</th>
                  <th className="pb-1.5 text-right font-medium">Close</th>
                  <th className="pb-1.5 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {days.map((d, i) => (
                  <tr key={d.key} className="text-neutral-800 dark:text-neutral-100">
                    <td className="py-1.5">
                      {d.label}
                      {i === 0 && <span className="ml-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">so far</span>}
                      <span className="ml-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">{d.count} pts</span>
                    </td>
                    <td className="py-1.5 text-right">{d.lowFt.toFixed(2)}</td>
                    <td className="py-1.5 text-right">{d.highFt.toFixed(2)}</td>
                    <td className="py-1.5 text-right font-semibold">{d.closeFt.toFixed(2)}</td>
                    <td
                      className={clsx(
                        "py-1.5 text-right",
                        d.changeFt === null || Math.abs(d.changeFt) < 0.005
                          ? "text-neutral-400 dark:text-neutral-500"
                          : d.changeFt > 0
                            ? "text-warning-600 dark:text-warning-500"
                            : "text-primary-600 dark:text-primary-400",
                      )}
                    >
                      {d.changeFt === null
                        ? "—"
                        : `${d.changeFt > 0.005 ? "+" : d.changeFt < -0.005 ? "−" : "±"}${Math.abs(d.changeFt).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
