import { motion } from "framer-motion";
import clsx from "clsx";
import type { ReactNode } from "react";
import { SITE_CONFIG } from "../config";
import type { DerivedReading, MonitorQualityState } from "../types";
import { ALERT_LEVEL_LABEL } from "../lib/waterLevel";
import { Card } from "./ui/Card";
import { StatCardSkeleton } from "./Skeletons";

interface HeroStatsProps {
  reading: DerivedReading | null;
  loadState: "loading" | "ready" | "error";
  quality: MonitorQualityState;
}

const ACCENT_BG: Record<string, string> = {
  primary: "bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400",
  success: "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500",
  warning: "bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500",
  critical: "bg-critical-50 text-critical-600 dark:bg-critical-500/10 dark:text-critical-500",
  neutral: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

function StatCard({
  label,
  value,
  unit,
  icon,
  accent,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  accent: keyof typeof ACCENT_BG;
  hint?: string;
  /** Overrides the default value typography (e.g. a smaller size for long text like a date). */
  valueClassName?: string;
}) {
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {label}
        </p>
        <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", ACCENT_BG[accent])}>
          {icon}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <motion.span
          key={value}
          initial={{ opacity: 0.4, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={clsx(
            "font-bold text-neutral-900 dark:text-white",
            valueClassName ?? "text-2xl tabular-nums",
          )}
        >
          {value}
        </motion.span>
        {unit && <span className="text-sm font-medium text-neutral-400">{unit}</span>}
      </div>
      {hint && <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400" title={hint}>{hint}</p>}
    </Card>
  );
}

export function HeroStats({ reading, loadState, quality }: HeroStatsProps) {
  if (loadState === "loading" || !reading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const lastUpdatedAbsolute = formatAbsoluteTime(reading.receivedAtMs);
  const lastUpdatedRelative = formatRelativeTime(reading.receivedAtMs);

  // A reading too old to trust still answers the question operators actually
  // ask - "what did it last say, and when?" - so it is shown rather than
  // blanked. It must never look live, though: zone colours and the alert label
  // are dropped, every card is badged with the age, and the pipeline has
  // already barred a stale value from raising an alert.
  const unavailable = reading.isSensorFault;
  const hasLastKnown = Number.isFinite(reading.waterLevelFt) && reading.waterLevelFt > 0;

  // "Last Updated" means the last reading that ARRIVED. Anchoring it to the last
  // trusted sample instead made a device that was uploading rejected readings
  // look like a device that had stopped uploading, which sends an engineer to
  // check power and signal when the real fault is at the sensor.
  const lastUploadMs = quality.lastRawAtMs;
  const uploadsOutlastTrusted =
    typeof lastUploadMs === "number" && lastUploadMs - reading.receivedAtMs > 60_000;
  const lastUploadAbsolute = uploadsOutlastTrusted
    ? formatAbsoluteTime(lastUploadMs as number)
    : lastUpdatedAbsolute;
  const staleHint = hasLastKnown
    ? `Last trusted reading · ${lastUpdatedRelative}`
    : "No trusted reading in the loaded history";

  const qualityHint =
    quality.quality === "good"
      ? reading.isSmoothed
        ? `Median of ${quality.liveSampleCount} samples · trusted`
        : "Trusted reading"
      : quality.message ?? "Degraded — filtered sensor noise";

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {unavailable && (
        <p className="col-span-2 -mb-1 text-xs font-semibold text-warning-600 dark:text-warning-500 lg:col-span-5">
          Not current — {hasLastKnown ? "last trusted reading" : "no trusted reading"} shown below,{" "}
          {lastUpdatedAbsolute} ({lastUpdatedRelative}).
        </p>
      )}
      <StatCard
        label="Water Level"
        value={unavailable && !hasLastKnown ? "—" : reading.waterLevelFt.toFixed(2)}
        unit="ft"
        accent={unavailable ? "neutral" : "primary"}
        icon={<GaugeIcon className="h-5 w-5" />}
        hint={
          unavailable
            ? staleHint
            : `${reading.waterLevelM.toFixed(2)} m · of ${SITE_CONFIG.fullCapacityFt} ft full capacity`
        }
      />
      <StatCard
        label="Sensor Distance"
        value={Number.isFinite(reading.distanceMm) ? Math.round(reading.distanceMm).toString() : "—"}
        unit="mm"
        accent={quality.quality === "good" ? "neutral" : "warning"}
        icon={<RulerIcon className="h-5 w-5" />}
        hint={
          unavailable
            ? Number.isFinite(reading.rawDistanceMm) &&
              Math.round(reading.rawDistanceMm) !== Math.round(reading.distanceMm)
              ? `${staleHint} · raw ${Math.round(reading.rawDistanceMm)} mm`
              : staleHint
            : Number.isFinite(reading.rawDistanceMm) &&
                Math.round(reading.rawDistanceMm) !== Math.round(reading.distanceMm)
              ? `Trusted median · raw ${Math.round(reading.rawDistanceMm)} mm`
              : "A01 · sensor face to water surface"
        }
      />
      <StatCard
        label="Capacity"
        value={unavailable && !hasLastKnown ? "—" : reading.capacityPct.toFixed(1)}
        unit="%"
        accent={
          unavailable
            ? "neutral"
            : reading.alertLevel === "critical"
              ? "critical"
              : reading.alertLevel === "warning"
                ? "warning"
                : "success"
        }
        icon={<PercentIcon className="h-5 w-5" />}
        hint={unavailable ? staleHint : ALERT_LEVEL_LABEL[reading.alertLevel]}
      />
      <StatCard
        label="Data Quality"
        value={quality.quality === "good" ? "Good" : quality.quality === "degraded" ? "Degraded" : "Fault"}
        accent={
          quality.quality === "good" ? "success" : quality.quality === "degraded" ? "warning" : "critical"
        }
        icon={<PercentIcon className="h-5 w-5" />}
        hint={qualityHint}
      />
      <StatCard
        label="Last Updated"
        value={lastUploadAbsolute}
        accent={unavailable ? "critical" : reading.isStale ? "warning" : "neutral"}
        icon={<ClockIcon className="h-5 w-5" />}
        hint={
          uploadsOutlastTrusted
            ? `${formatRelativeTime(quality.lastRawAtMs as number)} · last TRUSTED ${lastUpdatedAbsolute}`
            : lastUpdatedRelative
        }
        valueClassName="text-base leading-snug tabular-nums"
      />
    </div>
  );
}

/**
 * Formats an epoch-ms timestamp as an exact local date and time, e.g.
 * "23 Jul 2026, 10:21:07". Returns "No data" for missing/implausible values.
 */
function formatAbsoluteTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "No data";
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelativeTime(ms: number): string {
  // Guard against missing / zero / implausible timestamps (e.g. epoch 1970 from
  // a malformed reading), which would otherwise render as "494918h ago".
  if (!Number.isFinite(ms) || ms <= 0) return "No data";

  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 0) return "Just now"; // clock skew / future timestamp
  if (diffSec < 5) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return "Over a month ago";
}

function GaugeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4 14a8 8 0 1 1 16 0" strokeLinecap="round" />
      <path d="M12 14 16 9" strokeLinecap="round" />
      <path d="M4 14h16" strokeLinecap="round" />
    </svg>
  );
}
function RulerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="3" y="9" width="18" height="6" rx="1" />
      <path d="M7 9v3M11 9v3M15 9v3" />
    </svg>
  );
}
function PercentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
