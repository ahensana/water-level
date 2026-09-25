import { motion } from "framer-motion";
import { SITE_CONFIG } from "../config";
import { ALERT_LEVEL_LABEL, levelToCapacityPct } from "../lib/waterLevel";
import type { ConnectionState, DerivedReading } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { StatusBadge } from "./ui/StatusBadge";
import { GaugeSkeleton } from "./Skeletons";

interface GaugeCardProps {
  reading: DerivedReading | null;
  connection: ConnectionState;
  loadState: "loading" | "ready" | "error";
}

const SIZE = 208;
const STROKE = 15;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ARC_FRACTION = 0.75;
const ARC_LENGTH = CIRCUMFERENCE * ARC_FRACTION;
const ROTATION_DEG = 135;

const ZONE_COLORS = {
  normal: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
};

export function GaugeCard({ reading, connection, loadState }: GaugeCardProps) {
  if (loadState === "loading" || !reading) {
    return <GaugeSkeleton />;
  }

  // Too old to trust: draw the last known level in grey with no zone highlight,
  // so it reads as a record of the last reading rather than the level now.
  const unavailable = reading.isSensorFault;
  const hasLastKnown = Number.isFinite(reading.waterLevelFt) && reading.waterLevelFt > 0;

  const pct = reading.capacityPct;
  const valueArcLength = (pct / 100) * ARC_LENGTH;
  const trackDashArray = `${ARC_LENGTH} ${CIRCUMFERENCE}`;
  const color = unavailable ? "#9ca3af" : ZONE_COLORS[reading.alertLevel];

  const warningPct = levelToCapacityPct(SITE_CONFIG.warningLevelFt);
  const criticalPct = levelToCapacityPct(SITE_CONFIG.criticalLevelFt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Real-Time Water Level</CardTitle>
        {unavailable ? (
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            Not current
          </span>
        ) : (
          <StatusBadge
            level={reading.alertLevel}
            label={ALERT_LEVEL_LABEL[reading.alertLevel]}
            pulse={connection.deviceConnectivity === "online"}
          />
        )}
      </CardHeader>
      <CardBody className="flex flex-col items-center gap-4 lg:flex-row lg:items-center lg:justify-around">
        <div className="flex flex-col items-center">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label={`Water level gauge showing ${pct.toFixed(1)} percent of ${SITE_CONFIG.fullCapacityFt} ft full capacity`}
          >
            <g transform={`rotate(${ROTATION_DEG} ${SIZE / 2} ${SIZE / 2})`}>
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="currentColor"
                className="text-neutral-100 dark:text-neutral-800"
                strokeWidth={STROKE}
                strokeDasharray={trackDashArray}
                strokeLinecap="round"
              />
              {[
                { pct: warningPct, color: ZONE_COLORS.warning },
                { pct: criticalPct, color: ZONE_COLORS.critical },
              ].map((tick) => {
                const angle = (tick.pct / 100) * ARC_FRACTION * 360;
                return (
                  <line
                    key={tick.pct}
                    x1={SIZE / 2}
                    y1={STROKE / 2}
                    x2={SIZE / 2}
                    y2={STROKE / 2 + 10}
                    stroke={tick.color}
                    strokeWidth={3}
                    transform={`rotate(${angle} ${SIZE / 2} ${SIZE / 2})`}
                  />
                );
              })}
              <motion.circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                initial={{ strokeDashoffset: CIRCUMFERENCE }}
                animate={{ strokeDashoffset: CIRCUMFERENCE - valueArcLength }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              key={pct.toFixed(1)}
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 1 }}
              className="text-3xl font-extrabold tabular-nums text-neutral-900 dark:text-white"
            >
              {unavailable && !hasLastKnown ? "—" : `${pct.toFixed(1)}%`}
            </motion.span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              of {SITE_CONFIG.fullCapacityFt} ft FRL
            </span>
            <span className="mt-1.5 text-base font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">
              {unavailable && !hasLastKnown ? "—" : `${reading.waterLevelFt.toFixed(2)} ft`}
            </span>
            <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              {unavailable && !hasLastKnown ? "" : `${reading.waterLevelM.toFixed(2)} m`}
            </span>
          </div>
        </div>
        {/* Below the dial, not inside it: at 208px the caption overlapped the arc. */}
        {unavailable && (
          <p className="mt-2 max-w-64 text-center text-xs font-medium leading-snug text-warning-600 dark:text-warning-500">
            {hasLastKnown ? "Last trusted reading" : "No trusted reading"} ·{" "}
            {formatLastTrusted(reading.receivedAtMs)}
          </p>
        )}
        </div>

        <div className="flex w-full flex-col gap-3 sm:max-w-sm">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Threshold Zones (staff gauge)
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              <ZoneRow
                color={ZONE_COLORS.normal}
                label="Safe Zone"
                range={`Below ${SITE_CONFIG.warningLevelFt} ft`}
                active={!unavailable && reading.alertLevel === "normal"}
              />
              <ZoneRow
                color={ZONE_COLORS.warning}
                label="Warning Zone"
                range={`${SITE_CONFIG.warningLevelFt} – ${SITE_CONFIG.criticalLevelFt} ft`}
                active={!unavailable && reading.alertLevel === "warning"}
              />
              <ZoneRow
                color={ZONE_COLORS.critical}
                label="Critical Zone"
                range={`${SITE_CONFIG.criticalLevelFt} – ${SITE_CONFIG.fullCapacityFt} ft FRL`}
                active={!unavailable && reading.alertLevel === "critical"}
              />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/** "25 Sep, 14:56 (1h 20m ago)" — the age matters as much as the clock time here. */
function formatLastTrusted(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "no timestamp";

  const absolute = new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  const age =
    diffMin < 60
      ? `${diffMin}m ago`
      : diffMin < 1440
        ? `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`
        : `${Math.floor(diffMin / 1440)}d ago`;

  return `${absolute} (${age})`;
}

function ZoneRow({
  color,
  label,
  range,
  active,
}: {
  color: string;
  label: string;
  range: string;
  active: boolean;
}) {
  return (
    <div
      className={`relative flex items-center justify-between overflow-hidden rounded-lg border px-2.5 py-1.5 transition-colors ${
        active
          ? "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60"
          : "border-neutral-200/60 dark:border-neutral-800"
      }`}
    >
      {active && (
        <span className="absolute inset-y-0 left-0 w-1 rounded-r" style={{ backgroundColor: color }} />
      )}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span
          className={`text-sm font-medium ${
            active
              ? "text-neutral-900 dark:text-white"
              : "text-neutral-700 dark:text-neutral-300"
          }`}
        >
          {label}
        </span>
      </div>
      <span className="text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">{range}</span>
    </div>
  );
}
