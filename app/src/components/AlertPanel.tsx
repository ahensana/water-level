import { ALERT_LEVEL_ACTION, ALERT_LEVEL_LABEL } from "../lib/waterLevel";
import { FAULT_CODE_LABEL } from "../lib/sensorQuality";
import type { DerivedReading, MonitorQualityState, SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { StatusBadge } from "./ui/StatusBadge";
import { ListSkeleton } from "./Skeletons";

interface AlertPanelProps {
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
  quality: MonitorQualityState;
  onOpenHistory: () => void;
}

export function AlertPanel({ reading, history, loadState, quality, onOpenHistory }: AlertPanelProps) {
  if (loadState === "loading" || !reading) {
    return <ListSkeleton rows={3} />;
  }

  const levelTone = reading.isSensorFault ? "critical" : reading.alertLevel;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert Monitoring</CardTitle>
        <StatusBadge
          level={levelTone === "normal" ? "normal" : levelTone === "warning" ? "warning" : "critical"}
          label={reading.isSensorFault ? "Sensor Fault" : ALERT_LEVEL_LABEL[reading.alertLevel]}
        />
      </CardHeader>
      <CardBody>
        {reading.isSensorFault ? (
          <div className="rounded-lg border border-critical-200 bg-critical-50 p-3 dark:border-critical-500/30 dark:bg-critical-500/10">
            <p className="text-sm font-semibold text-critical-700 dark:text-critical-400">
              No trusted water level
            </p>
            <p className="mt-1 text-sm text-critical-700/90 dark:text-critical-400/90">
              {quality.message ??
                "All recent A01 samples were rejected. Inspect sensor aim, mounting, and wiring."}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                  {ALERT_LEVEL_LABEL[reading.alertLevel]}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Current reading: {reading.waterLevelFt.toFixed(2)} ft / {reading.waterLevelM.toFixed(2)} m
                  ({reading.capacityPct.toFixed(1)}%) · trusted {Math.round(reading.distanceMm)} mm
                </p>
              </div>
              <StatusBadge level={reading.alertLevel} label="Active" pulse />
            </div>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              <span className="font-medium text-neutral-800 dark:text-neutral-100">Recommended action: </span>
              {ALERT_LEVEL_ACTION[reading.alertLevel]}
            </p>
          </div>
        )}

        {quality.faultCodes.length > 0 && (
          <div className="mt-3 rounded-lg border border-warning-200 bg-warning-50/60 px-3 py-2 dark:border-warning-500/20 dark:bg-warning-500/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-400">
              QA filters active
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {quality.faultCodes.map((code) => (
                <li
                  key={code}
                  className="rounded-md bg-white/80 px-2 py-0.5 text-xs font-medium text-warning-800 dark:bg-neutral-900/60 dark:text-warning-300"
                >
                  {FAULT_CODE_LABEL[code]}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-warning-700/80 dark:text-warning-400/80">
              Rejected {Math.round(quality.rejectRate * 100)}% of samples · live median uses{" "}
              {quality.liveSampleCount} point{quality.liveSampleCount === 1 ? "" : "s"}
            </p>
          </div>
        )}

        <div className="mt-3 mb-1.5 flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Trusted reading history
          </p>
          <button
            type="button"
            onClick={onOpenHistory}
            className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            View full history
          </button>
        </div>
        {history.length === 0 ? (
          <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
            No trusted readings yet — waiting for valid A01 samples.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
            {[...history].reverse().slice(0, 80).map((point) => (
              <li key={point.t} className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-sm font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
                  {Math.round(point.distanceMm)} mm
                  <span className="ml-1.5 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                    · {point.waterLevelFt.toFixed(2)} ft / {point.waterLevelM.toFixed(2)} m
                  </span>
                </span>
                <time className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                  {new Date(point.t).toLocaleString(undefined, {
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
        {history.length > 80 && (
          <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
            Showing the latest 80 of {history.length.toLocaleString()} trusted readings in this session — open
            the full history to filter by period, level, or alert band.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
