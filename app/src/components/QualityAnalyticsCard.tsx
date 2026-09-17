import { useMemo } from "react";
import { SITE_CONFIG } from "../config";
import { useNow } from "../hooks/useNow";
import { computeFaultBreakdown } from "../lib/analytics";
import { FAULT_CODE_LABEL } from "../lib/sensorQuality";
import type { RawWaterMonitorReading } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface QualityAnalyticsCardProps {
  rawHistory: RawWaterMonitorReading[];
  loadState: "loading" | "ready" | "error";
}

const BREAKDOWN_WINDOW_MS = 24 * 60 * 60 * 1000;

export function QualityAnalyticsCard({ rawHistory, loadState }: QualityAnalyticsCardProps) {
  const now = useNow();
  const breakdown = useMemo(() => computeFaultBreakdown(rawHistory, BREAKDOWN_WINDOW_MS, now), [rawHistory, now]);

  if (loadState === "loading") {
    return <ListSkeleton rows={3} />;
  }

  const faultRows = Object.entries(breakdown.counts).sort((a, b) => b[1] - a[1]);
  const maxCount = faultRows.length ? faultRows[0][1] : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sensor QA &amp; Calibration</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">Last 24h · {breakdown.totalSamples} samples replayed</span>
      </CardHeader>
      <CardBody className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Rejected samples by cause ({breakdown.rejectRatePct.toFixed(1)}% overall)
          </p>
          {faultRows.length === 0 ? (
            <p className="rounded-lg bg-success-50 px-3 py-3 text-center text-sm text-success-700 dark:bg-success-500/10 dark:text-success-500">
              No rejected samples in the last 24 hours.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {faultRows.map(([code, count]) => (
                <li key={code} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-xs text-neutral-600 dark:text-neutral-300">
                    {FAULT_CODE_LABEL[code as keyof typeof FAULT_CODE_LABEL]}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-warning-500"
                      style={{ width: `${maxCount ? (count / maxCount) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Calibration reference
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <CalRow label="Sensor Elevation" value={`${SITE_CONFIG.sensorElevationFt.toFixed(2)} ft`} />
            <CalRow label="Full Capacity (FRL)" value={`${SITE_CONFIG.fullCapacityFt} ft`} />
            <CalRow label="Calibration Basis" value={SITE_CONFIG.calibration.basis} />
            <CalRow
              label="Residual vs Logbook"
              value={`${SITE_CONFIG.calibration.medianErrorFt >= 0 ? "+" : "−"}${Math.abs(SITE_CONFIG.calibration.medianErrorFt).toFixed(3)} ft median, ±${SITE_CONFIG.calibration.residualStdFt.toFixed(3)} ft`}
            />
            <CalRow
              label="Worst Deviation"
              value={`${SITE_CONFIG.calibration.worstDeviationFt.toFixed(2)} ft (limit ${SITE_CONFIG.crossCheckToleranceFt.toFixed(2)} ft)`}
            />
            <CalRow label="Valid Distance Range" value={`${SITE_CONFIG.minValidDistanceMm}–${SITE_CONFIG.maxValidDistanceMm} mm`} />
            <CalRow label="Max Plausible Rate" value={`${SITE_CONFIG.maxLevelChangeFtPerHour} ft/hr`} />
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
            Sensor elevation is fitted against the field logbook in{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] dark:bg-neutral-800">RealDataFromSite/</code>.
            The A01NYUB's onboard temperature compensation was verified against BMP280 telemetry (r ≈ 0.09,
            R² ≈ 0.003 across 22–35 °C), so no separate speed-of-sound correction is applied. A repeating{" "}
            {(SITE_CONFIG.calibration.diurnalSwingFt * 304.8).toFixed(0)} mm daily oscillation peaking in the
            early evening is present in the sensor but absent from the logbook — see the Diurnal Profile
            card. Expect disagreement of about that much at the extremes even when both are correct. To
            re-check this against fresh manual readings, use Gauge Verification in the interval report. See{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] dark:bg-neutral-800">src/config.ts</code>{" "}
            for the full methodology.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function CalRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</dt>
      <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{value}</dd>
    </div>
  );
}
