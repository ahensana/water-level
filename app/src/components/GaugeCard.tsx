import { motion } from "framer-motion";
import type { EditableSiteConfig } from "../config";
import { ALERT_LEVEL_LABEL } from "../lib/waterLevel";
import type { ConnectionState, DerivedReading } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { StatusBadge } from "./ui/StatusBadge";
import { GaugeSkeleton } from "./Skeletons";

interface GaugeCardProps {
  reading: DerivedReading | null;
  connection: ConnectionState;
  loadState: "loading" | "ready" | "error";
  siteConfig: EditableSiteConfig;
}

const SIZE = 260;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Gauge spans 270 degrees (start at -225deg, i.e. bottom-left, sweeping clockwise),
// leaving a gap at the bottom for a clean instrument-panel look.
const ARC_FRACTION = 0.75;
const ARC_LENGTH = CIRCUMFERENCE * ARC_FRACTION;
const ROTATION_DEG = 135; // rotates the start of the arc to the bottom-left gap

const ZONE_COLORS = {
  normal: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
};

export function GaugeCard({ reading, connection, loadState, siteConfig }: GaugeCardProps) {
  if (loadState === "loading" || !reading) {
    return <GaugeSkeleton />;
  }

  const pct = reading.capacityPct;
  const valueArcLength = (pct / 100) * ARC_LENGTH;
  const trackDashArray = `${ARC_LENGTH} ${CIRCUMFERENCE}`;
  const color = ZONE_COLORS[reading.alertLevel];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Real-Time Water Level</CardTitle>
        <StatusBadge
          level={reading.alertLevel}
          label={ALERT_LEVEL_LABEL[reading.alertLevel]}
          pulse={connection.deviceConnectivity === "online"}
        />
      </CardHeader>
      <CardBody className="flex flex-col items-center gap-6 lg:flex-row lg:items-center lg:justify-around">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Water level gauge showing ${pct.toFixed(1)} percent capacity`}>
            <g transform={`rotate(${ROTATION_DEG} ${SIZE / 2} ${SIZE / 2})`}>
              {/* Background track */}
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
              {/* Zone reference ticks: warning + critical thresholds */}
              {[siteConfig.warningThresholdPct, siteConfig.criticalThresholdPct].map((threshold) => {
                const angle = (threshold / 100) * ARC_FRACTION * 360;
                return (
                  <line
                    key={threshold}
                    x1={SIZE / 2}
                    y1={STROKE / 2}
                    x2={SIZE / 2}
                    y2={STROKE / 2 + 10}
                    stroke={threshold >= siteConfig.criticalThresholdPct ? ZONE_COLORS.critical : ZONE_COLORS.warning}
                    strokeWidth={3}
                    transform={`rotate(${angle} ${SIZE / 2} ${SIZE / 2})`}
                  />
                );
              })}
              {/* Value arc */}
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
              className="text-4xl font-extrabold tabular-nums text-neutral-900 dark:text-white"
            >
              {pct.toFixed(1)}%
            </motion.span>
            <span className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Capacity Filled</span>
            <span className="mt-3 text-lg font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">
              {reading.waterLevelM.toFixed(2)} m
            </span>
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:max-w-xs">
          <ZoneRow color={ZONE_COLORS.normal} label="Safe Zone" range={`0% – ${siteConfig.warningThresholdPct}%`} active={reading.alertLevel === "normal"} />
          <ZoneRow
            color={ZONE_COLORS.warning}
            label="Warning Zone"
            range={`${siteConfig.warningThresholdPct}% – ${siteConfig.criticalThresholdPct}%`}
            active={reading.alertLevel === "warning"}
          />
          <ZoneRow
            color={ZONE_COLORS.critical}
            label="Critical Zone"
            range={`Above ${siteConfig.criticalThresholdPct}%`}
            active={reading.alertLevel === "critical"}
          />
          <div className="mt-2 flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-800/60">
            <span className="text-neutral-500 dark:text-neutral-400">Sensor Status</span>
            <span
              className={
                reading.isSensorFault
                  ? "font-semibold text-critical-600 dark:text-critical-500"
                  : "font-semibold text-success-600 dark:text-success-500"
              }
            >
              {reading.isSensorFault ? "Fault Detected" : "Reading Valid"}
            </span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
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
      className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
        active
          ? "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60"
          : "border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{label}</span>
      </div>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">{range}</span>
    </div>
  );
}
