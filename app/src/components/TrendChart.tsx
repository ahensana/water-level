import { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ReferenceLine,
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

interface TrendChartProps {
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
  siteConfig: EditableSiteConfig;
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
          <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
            Live session history recorded since this dashboard was opened. Not a server-side
            historical archive.
          </p>
          {data.length < 2 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                Collecting readings…
              </p>
              <p className="max-w-xs text-xs text-neutral-500 dark:text-neutral-400">
                The trend chart populates as new readings arrive from the sensor. Keep this
                dashboard open to build up a session history.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
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
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, siteConfig.sensorMountHeightM]}
                  width={36}
                />
                <ReferenceLine
                  y={(siteConfig.warningThresholdPct / 100) * siteConfig.sensorMountHeightM}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: "Warning", position: "insideTopRight", fontSize: 10, fill: "#b45309" }}
                />
                <ReferenceLine
                  y={(siteConfig.criticalThresholdPct / 100) * siteConfig.sensorMountHeightM}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  label={{ value: "Critical", position: "insideTopRight", fontSize: 10, fill: "#b91c1c" }}
                />
                <Tooltip
                  formatter={(value) => [`${Number(value).toFixed(2)} m`, "Water Level"]}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="waterLevelM"
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
          )}
        </div>
      </CardBody>
    </Card>
  );
}
