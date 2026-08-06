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

const SIZE = 260;
const STROKE = 18;
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
  if (loadState === "loading" || !reading || reading.isSensorFault) {
    return <GaugeSkeleton />;
  }

  const pct = reading.capacityPct;
  const valueArcLength = (pct / 100) * ARC_LENGTH;
  const trackDashArray = `${ARC_LENGTH} ${CIRCUMFERENCE}`;
  const color = ZONE_COLORS[reading.alertLevel];

  const warningPct = levelToCapacityPct(SITE_CONFIG.warningLevelFt);
  const criticalPct = levelToCapacityPct(SITE_CONFIG.criticalLevelFt);

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
              className="text-4xl font-extrabold tabular-nums text-neutral-900 dark:text-white"
            >
              {pct.toFixed(1)}%
            </motion.span>
            <span className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              of {SITE_CONFIG.fullCapacityFt} ft FRL
            </span>
            <span className="mt-3 text-lg font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">
              {reading.waterLevelFt.toFixed(2)} ft
            </span>
            <span className="text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
              {reading.waterLevelM.toFixed(2)} m
            </span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-5 sm:max-w-sm">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Threshold Zones (staff gauge)
            </p>
            <div className="grid grid-cols-1 gap-2">
              <ZoneRow
                color={ZONE_COLORS.normal}
                label="Safe Zone"
                range={`Below ${SITE_CONFIG.warningLevelFt} ft`}
                active={reading.alertLevel === "normal"}
              />
              <ZoneRow
                color={ZONE_COLORS.warning}
                label="Warning Zone"
                range={`${SITE_CONFIG.warningLevelFt} – ${SITE_CONFIG.criticalLevelFt} ft`}
                active={reading.alertLevel === "warning"}
              />
              <ZoneRow
                color={ZONE_COLORS.critical}
                label="Critical Zone"
                range={`${SITE_CONFIG.criticalLevelFt} – ${SITE_CONFIG.fullCapacityFt} ft FRL`}
                active={reading.alertLevel === "critical"}
              />
            </div>
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
      className={`relative flex items-center justify-between overflow-hidden rounded-lg border px-3 py-2 transition-colors ${
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
