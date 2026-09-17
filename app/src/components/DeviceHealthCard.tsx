import { useMemo } from "react";
import clsx from "clsx";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { ANALYTICS_CONFIG } from "../config";
import { useNow } from "../hooks/useNow";
import {
  classifyBattery,
  classifySignal,
  computeSurfaceDisturbance,
  computeUptimeStats,
  csqToDbm,
  type HealthTier,
  type SignalTier,
  type SurfaceTier,
} from "../lib/analytics";
import type { DerivedReading, RawWaterMonitorReading, SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface DeviceHealthCardProps {
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  rawHistory: RawWaterMonitorReading[];
  loadState: "loading" | "ready" | "error";
}

const HEALTH_TONE: Record<HealthTier, string> = {
  normal: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500",
  low: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500",
  critical: "bg-critical-50 text-critical-700 dark:bg-critical-500/10 dark:text-critical-500",
  unknown: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

const SIGNAL_TONE: Record<SignalTier, string> = {
  excellent: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500",
  good: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500",
  fair: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500",
  poor: "bg-critical-50 text-critical-700 dark:bg-critical-500/10 dark:text-critical-500",
  unknown: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

const SURFACE_TONE: Record<SurfaceTier, string> = {
  calm: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500",
  moderate: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500",
  rough: "bg-critical-50 text-critical-700 dark:bg-critical-500/10 dark:text-critical-500",
  unknown: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

const UPTIME_WINDOW_MS = 24 * 60 * 60 * 1000;

export function DeviceHealthCard({ reading, history, rawHistory, loadState }: DeviceHealthCardProps) {
  const now = useNow();
  const uptime = useMemo(() => computeUptimeStats(rawHistory, UPTIME_WINDOW_MS, now), [rawHistory, now]);
  const surface = useMemo(
    () => computeSurfaceDisturbance(rawHistory, ANALYTICS_CONFIG.surfaceDisturbanceWindowMs, now),
    [rawHistory, now],
  );

  if (loadState === "loading" || !reading) {
    return <ListSkeleton rows={3} />;
  }

  const batteryTier = classifyBattery(reading.batteryVoltage);
  const signalTier = classifySignal(reading.signalStrength);

  const batterySeries = history.filter((p) => p.batteryVoltage !== null);
  const signalSeries = history.filter((p) => p.signalStrength !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Device &amp; Network Health</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">EC200U modem · A01 sensor node</span>
      </CardHeader>
      <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HealthPanel
          label="Battery"
          value={reading.batteryVoltage !== null ? `${reading.batteryVoltage.toFixed(2)} V` : "—"}
          badge={batteryTier === "unknown" ? "No data" : batteryTier.toUpperCase()}
          toneClass={HEALTH_TONE[batteryTier]}
          hint={`Normal ≥ ${reading.batteryVoltage !== null ? "3.70" : "—"} V · Critical below 3.50 V`}
        >
          <Sparkline data={batterySeries} field="batteryVoltage" stroke="#22c55e" />
        </HealthPanel>

        <HealthPanel
          label="Signal Strength"
          value={reading.signalStrength !== null ? `${reading.signalStrength}/31` : "—"}
          badge={signalTier === "unknown" ? "No data" : signalTier.toUpperCase()}
          toneClass={SIGNAL_TONE[signalTier]}
          hint={reading.signalStrength !== null ? `≈ ${csqToDbm(reading.signalStrength)} dBm (GSM CSQ)` : "AT+CSQ not yet reported"}
        >
          <Sparkline data={signalSeries} field="signalStrength" stroke="#0f62fe" />
        </HealthPanel>

        <HealthPanel
          label="Reporting Completeness (24h)"
          value={`${uptime.completenessPct.toFixed(0)}%`}
          badge={uptime.completenessPct >= 90 ? "GOOD" : uptime.completenessPct >= 60 ? "PARTIAL" : "POOR"}
          toneClass={
            uptime.completenessPct >= 90
              ? HEALTH_TONE.normal
              : uptime.completenessPct >= 60
                ? HEALTH_TONE.low
                : HEALTH_TONE.critical
          }
          hint={`${uptime.actualCount} of ~${uptime.expectedCount} expected readings · longest gap ${formatGap(uptime.longestGapMs)}`}
        />

        <HealthPanel
          label="Surface Condition"
          value={surface.tier === "unknown" ? "—" : surface.tier[0].toUpperCase() + surface.tier.slice(1)}
          badge={surface.tier === "unknown" ? "No data" : surface.tier.toUpperCase()}
          toneClass={SURFACE_TONE[surface.tier]}
          hint={
            surface.stdDevMm !== null
              ? `Raw echo spread ${surface.stdDevMm.toFixed(1)} mm σ over last ${Math.round(ANALYTICS_CONFIG.surfaceDisturbanceWindowMs / 60_000)} min — a wind/wave proxy`
              : "Not enough recent raw samples to estimate"
          }
        />
      </CardBody>
    </Card>
  );
}

function HealthPanel({
  label,
  value,
  badge,
  toneClass,
  hint,
  children,
}: {
  label: string;
  value: string;
  badge: string;
  toneClass: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
        <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide", toneClass)}>
          {badge}
        </span>
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900 dark:text-white">{value}</p>
      {children && <div className="mt-1.5 h-8">{children}</div>}
      <p className="mt-1.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">{hint}</p>
    </div>
  );
}

function Sparkline({
  data,
  field,
  stroke,
}: {
  data: SessionHistoryPoint[];
  field: "batteryVoltage" | "signalStrength";
  stroke: string;
}) {
  if (data.length < 2) {
    return <div className="flex h-full items-center text-[11px] text-neutral-400 dark:text-neutral-600">Not enough data yet</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis domain={["dataMin", "dataMax"]} hide />
        <Line type="monotone" dataKey={field} stroke={stroke} strokeWidth={1.75} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function formatGap(ms: number): string {
  if (ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} hr`;
}
