import { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EditableSiteConfig } from "../config";
import type { SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ChartSkeleton } from "./Skeletons";

type RangeKey = "1h" | "24h" | "7d" | "30d";

const RANGE_OPTIONS: { key: RangeKey; label: string; windowMs: number }[] = [
  { key: "1h", label: "Hourly", windowMs: 60 * 60 * 1000 },
  { key: "24h", label: "Daily", windowMs: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Weekly", windowMs: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "Monthly", windowMs: 30 * 24 * 60 * 60 * 1000 },
];

/**
 * Produces a clean Y axis: a domain max with headroom above the mount height,
 * rounded up to a "nice" step, plus evenly-spaced ticks at that step. This keeps
 * the axis ordered and readable for any mount height (3 m, 20 m, etc.).
 */
function buildYAxis(mountHeightM: number): { yMax: number; yTicks: number[] } {
  const withHeadroom = mountHeightM * 1.35;
  const step = niceStep(withHeadroom / 4); // aim for ~4-5 ticks
  const yMax = Math.ceil(withHeadroom / step) * step;
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    yTicks.push(Number(v.toFixed(2)));
  }
  return { yMax, yTicks };
}

/** Rounds a raw step up to the nearest 1-2-5 x 10^n "nice" value. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * pow;
}

interface TrendChartProps {
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
  siteConfig: EditableSiteConfig;
}

interface TooltipPoint {
  label: string;
  waterLevelM: number;
  distanceM: number;
}

/** Custom tooltip: hovering the Water Level line also reveals the sensor distance. */
function LevelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TooltipPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const fmt = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)} m` : "—");
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 font-medium text-neutral-500 dark:text-neutral-400">{point.label}</p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-primary-600 dark:text-primary-400">Water Level</span>
        <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">
          {fmt(point.waterLevelM)}
        </span>
      </p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-neutral-500 dark:text-neutral-400">Sensor Distance</span>
        <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">
          {fmt(point.distanceM)}
        </span>
      </p>
    </div>
  );
}

export function TrendChart({ history, loadState, siteConfig }: TrendChartProps) {
  const [range, setRange] = useState<RangeKey>("1h");
  const containerRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const windowMs = RANGE_OPTIONS.find((r) => r.key === range)!.windowMs;

  const data = useMemo(() => {
    const cutoff = Date.now() - windowMs;
    return history
      .filter((p) => p.t >= cutoff)
      .map((p) => ({
        ...p,
        label: new Date(p.t).toLocaleString(undefined, {
          ...(windowMs <= 24 * 60 * 60 * 1000
            ? { hour: "2-digit", minute: "2-digit" }
            : { month: "short", day: "numeric" }),
        }),
      }));
  }, [history, windowMs]);

  // Build an explicit, evenly-spaced, round Y-axis instead of letting Recharts
  // auto-pick ticks - with a non-round domain max (e.g. mountHeight * 1.45) its
  // tick generator can produce out-of-order / uneven labels.
  const { yMax, yTicks } = useMemo(() => buildYAxis(siteConfig.sensorMountHeightM), [
    siteConfig.sensorMountHeightM,
  ]);

  const handleExport = async (type: "png" | "pdf") => {
    if (!containerRef.current) return;
    setExporting(true);
    try {
      const filename = `water-level-trend-${range}-${Date.now()}`;
      // Loaded on demand: html2canvas + jsPDF are only needed when the user
      // actually exports, so keep them out of the main bundle.
      const { exportNodeAsPdf, exportNodeAsPng } = await import("../lib/exportChart");
      if (type === "png") {
        await exportNodeAsPng(containerRef.current, filename);
      } else {
        await exportNodeAsPdf(containerRef.current, filename);
      }
    } finally {
      setExporting(false);
    }
  };

  if (loadState === "loading") {
    return <ChartSkeleton />;
  }

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <CardTitle>Water Level Trend</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRange(opt.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  range === opt.key
                    ? "bg-primary-500 text-white"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={exporting || data.length === 0}
              onClick={() => handleExport("png")}
              className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Export PNG
            </button>
            <button
              type="button"
              disabled={exporting || data.length === 0}
              onClick={() => handleExport("pdf")}
              className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Export PDF
            </button>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <div ref={containerRef} className="bg-white dark:bg-neutral-900">
          {data.length < 2 ? (
            <div className="flex h-105 flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                {history.length === 0 ? "No readings yet" : "Not enough data in this range"}
              </p>
              <p className="max-w-xs text-xs text-neutral-500 dark:text-neutral-400">
                {history.length === 0
                  ? "The trend chart populates automatically as the sensor reports readings."
                  : "Fewer than two readings fall within the selected time range. Try a wider range, or wait for more readings to arrive."}
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Sensor is mounted at the top of the water column (max level), so its
                  marker sits at the top-left of the plot, by the highest Y value. */}
              <div
                className="pointer-events-none absolute left-12 top-1 z-10 flex items-center gap-1 text-neutral-400 dark:text-neutral-500"
                title={`Sensor mounted at ${siteConfig.sensorMountHeightM.toFixed(2)} m`}
              >
                <SensorIcon className="h-4 w-4" />
                <span className="text-[10px] font-medium uppercase tracking-wide">Sensor</span>
              </div>
              <ResponsiveContainer width="100%" height={420}>
                <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="levelFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f62fe" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#0f62fe" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-neutral-200 dark:text-neutral-800" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  minTickGap={24}
                />
                <YAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, yMax]}
                  ticks={yTicks}
                  allowDecimals={false}
                  interval={0}
                  tickFormatter={(value: number) => `${value} m`}
                  width={52}
                />
                <Tooltip content={<LevelTooltip />} />
                <Area
                  type="monotone"
                  dataKey="waterLevelM"
                  name="Water Level"
                  stroke="#0f62fe"
                  strokeWidth={2}
                  fill="url(#levelFill)"
                />
                <Brush
                  dataKey="label"
                  height={22}
                  stroke="#0f62fe"
                  travellerWidth={8}
                  fill="#f8fafc"
                />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function SensorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="6" y="3" width="12" height="7" rx="1.5" />
      <path d="M9 10v2M12 10v2M15 10v2" strokeLinecap="round" />
      <path d="M8 16c1.2 1 2.8 1 4 0s2.8-1 4 0" strokeLinecap="round" />
      <path d="M7 19.5c1.4 1.2 3.2 1.2 5 0s3.6-1.2 5 0" strokeLinecap="round" />
    </svg>
  );
}
