import { ALERT_LEVEL_ACTION, ALERT_LEVEL_LABEL } from "../lib/waterLevel";
import type { AlertLogEntry } from "../hooks/useAlertLog";
import type { DerivedReading } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { StatusBadge } from "./ui/StatusBadge";
import { ListSkeleton } from "./Skeletons";

interface AlertPanelProps {
  reading: DerivedReading | null;
  log: AlertLogEntry[];
  loadState: "loading" | "ready" | "error";
}

export function AlertPanel({ reading, log, loadState }: AlertPanelProps) {
  if (loadState === "loading" || !reading) {
    return <ListSkeleton rows={3} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert Monitoring</CardTitle>
        <StatusBadge level={reading.alertLevel} label={ALERT_LEVEL_LABEL[reading.alertLevel]} />
      </CardHeader>
      <CardBody>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                {ALERT_LEVEL_LABEL[reading.alertLevel]}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                Current reading: {reading.waterLevelM.toFixed(2)} m ({reading.capacityPct.toFixed(1)}%)
              </p>
            </div>
            <StatusBadge level={reading.alertLevel} label="Active" pulse />
          </div>
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
            <span className="font-medium text-neutral-800 dark:text-neutral-100">Recommended action: </span>
            {ALERT_LEVEL_ACTION[reading.alertLevel]}
          </p>
        </div>

        <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Alert History (this session)
        </p>
        {log.length === 0 ? (
          <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
            No alert level changes observed yet during this session.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {log.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <StatusBadge level={entry.level} label={ALERT_LEVEL_LABEL[entry.level]} />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {entry.waterLevelM.toFixed(2)} m &middot; {entry.capacityPct.toFixed(1)}%
                  </span>
                </div>
                <time className="text-xs text-neutral-400 dark:text-neutral-500">
                  {new Date(entry.triggeredAtMs).toLocaleString(undefined, {
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
