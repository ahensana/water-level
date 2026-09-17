import { useMemo } from "react";
import clsx from "clsx";
import { useNow } from "../hooks/useNow";
import { deriveAlertEvents } from "../lib/analytics";
import { ALERT_LEVEL_LABEL } from "../lib/waterLevel";
import type { SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface AlertHistoryCardProps {
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
}

const LEVEL_DOT: Record<string, string> = {
  warning: "bg-warning-500",
  critical: "bg-critical-500",
};

export function AlertHistoryCard({ history, loadState }: AlertHistoryCardProps) {
  const now = useNow();
  const events = useMemo(() => deriveAlertEvents(history), [history]);

  if (loadState === "loading") {
    return <ListSkeleton rows={3} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Threshold Breach History</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
          Derived from loaded history · {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </CardHeader>
      <CardBody>
        {events.length === 0 ? (
          <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
            No Warning/Critical threshold crossings in the currently loaded history.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
            {events.slice(0, 50).map((ev) => (
              <li key={`${ev.level}-${ev.enteredAt}`} className="flex items-start justify-between gap-3 py-1.5">
                <div className="flex items-start gap-2.5">
                  <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", LEVEL_DOT[ev.level])} />
                  <div>
                    <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                      {ALERT_LEVEL_LABEL[ev.level]}
                      {ev.exitedAt === null && (
                        <span className="ml-1.5 rounded-full bg-critical-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-critical-600 dark:bg-critical-500/10 dark:text-critical-500">
                          Ongoing
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Peak {ev.peakFt.toFixed(2)} ft ({ev.peakCapacityPct.toFixed(1)}%) ·{" "}
                      {ev.durationMs !== null ? formatDuration(ev.durationMs) : formatDuration(now - ev.enteredAt) + " so far"}
                    </p>
                  </div>
                </div>
                <time className="shrink-0 text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                  {new Date(ev.enteredAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}
