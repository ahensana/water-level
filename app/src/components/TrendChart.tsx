import { useId, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Brush,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from "recharts";
import type { SessionHistoryPoint } from "../types";
import { SITE_CONFIG } from "../config";
import { useNow } from "../hooks/useNow";
import { computePeriodStats } from "../lib/analytics";
// Kept static rather than lazy: it is well under a kilobyte, and the report
// panel imports it statically anyway, so a dynamic import here splits nothing.
import { downloadCsv, historyToCsv } from "../lib/csvExport";
import { effectiveSensorElevationFt } from "../lib/waterLevel";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ChartSkeleton } from "./Skeletons";

type RangeKey = "1h" | "24h" | "7d" | "30d";

const RANGE_OPTIONS: { key: RangeKey; label: string; windowMs: number }[] = [
  { key: "1h", label: "Hourly", windowMs: 60 * 60 * 1000 },
  { key: "24h", label: "Daily", windowMs: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Weekly", windowMs: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "Monthly", windowMs: 30 * 24 * 60 * 60 * 1000 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Y-axis for staff-gauge style levels (feet). Zooms around the observed band so
 * small changes (e.g. 3197.25 → 3197.36 ft) stay visible, instead of 0 → sensor
 * elevation which would flatten the trace.
 */
function buildYAxisFt(
  levelsFt: number[],
  sensorElevationFt: number,
): { yMin: number; yMax: number; yTicks: number[] } {
  const finite = levelsFt.filter(Number.isFinite);
  if (finite.length === 0) {
    const yMax = niceCeil(sensorElevationFt);
    return { yMin: 0, yMax, yTicks: buildTicks(0, yMax) };
  }

  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const v of finite) {
    if (v < dataMin) dataMin = v;
    if (v > dataMax) dataMax = v;
  }

  // At least ±0.5 ft padding, or 20% of the span (min 1 ft total window).
  const span = Math.max(1, dataMax - dataMin);
  const pad = Math.max(0.5, span * 0.2);
  let yMin = dataMin - pad;
  let yMax = Math.min(sensorElevationFt + pad, dataMax + pad);

  // Snap to a nice step so tick labels stay clean.
  const step = niceStep((yMax - yMin) / 4);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;
  if (yMax <= yMin) yMax = yMin + step * 4;

  return { yMin, yMax, yTicks: buildTicks(yMin, yMax, step) };
}

function niceCeil(value: number): number {
  const step = niceStep(value / 5);
  return Math.ceil(value / step) * step;
}

function buildTicks(yMin: number, yMax: number, step?: number): number[] {
  const s = step ?? niceStep((yMax - yMin) / 4);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += s) {
    ticks.push(Number(v.toFixed(2)));
  }
  return ticks;
}

/** Rounds a raw step up to the nearest 1-2-5 x 10^n "nice" value. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * pow;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Midpoint-quadratic smoothing. Each segment is a quadratic curve through the
 * midpoints using the data point itself as the control, which rounds the line
 * without the overshoot a cubic spline produces on flat-then-step data.
 */
function smoothLine(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  }
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x} ${last.y}`;
}

/**
 * Water-surface height (pixels) at an arbitrary x, linearly interpolated between
 * the two nearest readings and held flat beyond either end. Wave layers are
 * sampled on a fixed pixel grid rather than at reading positions, so they need
 * the surface at x values that fall between readings.
 */
function surfaceYAt(surface: Pt[], x: number): number {
  const first = surface[0];
  const last = surface[surface.length - 1];
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;

  let lo = 0;
  let hi = surface.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (surface[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = surface[lo];
  const b = surface[hi];
  const span = b.x - a.x;
  return span <= 0 ? a.y : a.y + ((x - a.x) / span) * (b.y - a.y);
}

const WAVE_AMPLITUDE = 5;
const WAVE_WAVELENGTH = 170;
const WAVE_DURATION = 9;
const WAVE_DIRECTION = -1;

/**
 * The water's own top edge, with the swell applied.
 *
 * The wave is the boundary of the fill rather than a line drawn beneath a flat
 * top: with a separate line, the fill's straight top edge stays visible as a
 * hard dark-to-blue contrast line sitting above the wave.
 *
 * Sampled one wavelength past each side so the whole shape can slide by exactly
 * one wavelength and still cover the plot; the caller clips it back.
 */
function buildSurfacePoints(surface: Pt[], left: number, right: number): Pt[] {
  const pts: Pt[] = [];
  // 5px sampling keeps the wave smooth without producing a path long enough
  // to matter for render cost.
  for (let x = left - WAVE_WAVELENGTH; x <= right + WAVE_WAVELENGTH; x += 5) {
    const swell = WAVE_AMPLITUDE * Math.sin((2 * Math.PI * x) / WAVE_WAVELENGTH);
    pts.push({ x, y: surfaceYAt(surface, x) + swell });
  }
  return pts;
}

/**
 * Renders the plot as a body of water rather than a line graph: a shaded air gap
 * from the sensor down to the surface (this gap *is* the sensor distance), the
 * water column below it, and animated swells riding the surface.
 *
 * Rendered as a chart child so it can use the axis scales - the surface has to
 * land on exactly the same pixels Recharts uses for the axes and tooltip.
 */
function WaterColumn({
  points,
  sensorElevationFt,
  yMin,
}: {
  points: SessionHistoryPoint[];
  sensorElevationFt: number;
  yMin: number;
}) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  // useId embeds colons, which are not valid in an SVG url(#...) reference.
  const uid = useId().replace(/:/g, "");

  if (!plot || !xScale || !yScale) return null;

  const surface: Pt[] = [];
  for (const p of points) {
    const x = xScale(p.t);
    const y = yScale(p.waterLevelFt);
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      surface.push({ x, y });
    }
  }
  if (surface.length < 2) return null;

  const bed = yScale(yMin);
  const mountY = yScale(sensorElevationFt);
  if (typeof bed !== "number" || typeof mountY !== "number") return null;

  const left = plot.x;
  const right = plot.x + plot.width;

  // The fill and its highlight share one wavy edge, so there is exactly one
  // line at the top of the water rather than a fill edge plus a wave.
  const surfacePts = buildSurfacePoints(surface, left, right);
  const surfaceLine = smoothLine(surfacePts);
  const firstPt = surfacePts[0];
  const lastPt = surfacePts[surfacePts.length - 1];
  const waterPath = `${surfaceLine} L${lastPt.x} ${bed} L${firstPt.x} ${bed} Z`;

  return (
    <g className="pointer-events-none">
      <defs>
        {/* Light blue at the surface deepening to dark blue at the bed, so the
            column reads as depth rather than as a flat sheet. */}
        <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8FB6EE" />
          <stop offset="50%" stopColor="#4A79C9" />
          <stop offset="100%" stopColor="#16336B" />
        </linearGradient>
        <linearGradient id={`${uid}-air`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.12" />
        </linearGradient>
        {/* The water is drawn wider than the plot so it can slide; clip it back
            to the plot so it never spills over the axes. */}
        <clipPath id={`${uid}-plot`}>
          <rect x={left} y={plot.y} width={plot.width} height={plot.height} />
        </clipPath>
      </defs>

      {/* Air gap: sensor face down to the visible window floor. */}
      <rect
        x={left}
        y={Math.min(mountY, bed)}
        width={plot.width}
        height={Math.max(0, Math.abs(bed - mountY))}
        fill={`url(#${uid}-air)`}
      />

      <g clipPath={`url(#${uid}-plot)`}>
        {/* Fill and highlight drift together as one shape. Only the wavy top
            edge reads as moving - the fill below it is uniform and the bed is
            flat, so sliding horizontally is invisible there. */}
        <g
          style={{
            // Custom property drives the keyframe; see water-drift in index.css.
            ["--wave-shift" as string]: `${WAVE_DIRECTION * WAVE_WAVELENGTH}px`,
            animation: `water-drift ${WAVE_DURATION}s linear infinite`,
          }}
        >
          <path d={waterPath} fill={`url(#${uid}-water)`} />
          <path
            d={surfaceLine}
            fill="none"
            stroke="#ffffff"
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.5}
          />
        </g>
      </g>
    </g>
  );
}

interface TrendChartProps {
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
}

interface TooltipPoint {
  label: string;
  waterLevelM: number;
  waterLevelFt: number;
  distanceMm: number;
}

/** Custom tooltip: hovering the water surface also reveals the sensor distance. */
function LevelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TooltipPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const fmtM = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)} m` : "—");
  const fmtFt = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)} ft` : "—");
  const fmtMm = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} mm` : "—");
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 font-medium text-neutral-500 dark:text-neutral-400">{point.label}</p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-primary-600 dark:text-primary-400">Water Level</span>
        <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">
          {fmtFt(point.waterLevelFt)} / {fmtM(point.waterLevelM)}
        </span>
      </p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-neutral-500 dark:text-neutral-400">Sensor Distance</span>
        <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">
          {fmtMm(point.distanceMm)}
        </span>
      </p>
    </div>
  );
}

export function TrendChart({ history, loadState }: TrendChartProps) {
  const [range, setRange] = useState<RangeKey>("1h");
  const containerRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const now = useNow();

  const windowMs = RANGE_OPTIONS.find((r) => r.key === range)!.windowMs;

  // Format a timestamp for the axis and brush: clock time for intraday ranges,
  // calendar date for the multi-day ones.
  const formatTime = useMemo(() => {
    const opts: Intl.DateTimeFormatOptions =
      windowMs <= DAY_MS
        ? { hour: "2-digit", minute: "2-digit" }
        : { month: "short", day: "numeric" };
    return (t: number) => new Date(t).toLocaleString(undefined, opts);
  }, [windowMs]);

  const data = useMemo(() => {
    const cutoff = now - windowMs;
    return history.filter((p) => p.t >= cutoff).map((p) => ({ ...p, label: formatTime(p.t) }));
  }, [history, windowMs, formatTime, now]);

  const periodStats = useMemo(() => computePeriodStats(history, windowMs, now), [history, windowMs, now]);

  // Build an explicit, evenly-spaced Y-axis in feet (field staff-gauge unit),
  // zoomed to the observed band so small level changes remain visible.
  // Trim-adjusted, so the plotted mount line stays consistent with the levels.
  const sensorElevationFt = effectiveSensorElevationFt();
  const { yMin, yMax, yTicks } = useMemo(
    () => buildYAxisFt(
      data.map((p) => p.waterLevelFt),
      Math.max(sensorElevationFt, SITE_CONFIG.fullCapacityFt),
    ),
    [data, sensorElevationFt],
  );

  // Size the axis to its longest label (e.g. "3197.50 ft").
  const yAxisWidth = useMemo(() => {
    let longest = 0;
    for (const t of yTicks) longest = Math.max(longest, `${t} ft`.length);
    return Math.max(64, longest * 8 + 12);
  }, [yTicks]);

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

  const handleExportCsv = () => {
    downloadCsv(`water-level-readings-${range}-${Date.now()}`, historyToCsv(data));
  };

  if (loadState === "loading") {
    return <ChartSkeleton />;
  }

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <CardTitle>Water Level Trend</CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
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
          <div className="flex gap-1.5 print:hidden">
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
            <button
              type="button"
              disabled={data.length === 0}
              onClick={handleExportCsv}
              title="Download trusted readings in this range as CSV, for departmental records"
              className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Export CSV
            </button>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {periodStats.count > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PeriodStat label="Min" value={`${periodStats.minFt!.toFixed(2)} ft`} />
            <PeriodStat label="Max" value={`${periodStats.maxFt!.toFixed(2)} ft`} />
            <PeriodStat label="Mean" value={`${periodStats.meanFt!.toFixed(2)} ft`} />
            <PeriodStat
              label="Net Change"
              value={`${periodStats.netChangeFt! >= 0 ? "+" : ""}${periodStats.netChangeFt!.toFixed(2)} ft`}
              tone={periodStats.netChangeFt! > 0 ? "rising" : periodStats.netChangeFt! < 0 ? "falling" : undefined}
            />
          </div>
        )}
        <div ref={containerRef} className="bg-white dark:bg-neutral-900">
          {data.length < 2 ? (
            <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
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
            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                {/* No CartesianGrid: its horizontal lines sit inside the water
                    body whenever headroom is thin, cutting across the wave. */}
                {/* A real time axis, not one category per reading: readings arrive
                    every ~30s, so categorical ticks collided and repeated. */}
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={formatTime}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  minTickGap={40}
                />
                <YAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[yMin, yMax]}
                  ticks={yTicks}
                  allowDecimals
                  interval={0}
                  tickFormatter={(value: number) => `${value} ft`}
                  width={yAxisWidth}
                />
                <WaterColumn points={data} sensorElevationFt={sensorElevationFt} yMin={yMin} />
                {/* Only drawn when the threshold actually falls inside the
                    current zoom — usually off-screen during normal safe-zone
                    operation, and that's correct: they matter when the level
                    approaches them, not as permanent chart furniture. */}
                {SITE_CONFIG.warningLevelFt >= yMin && SITE_CONFIG.warningLevelFt <= yMax && (
                  <ReferenceLine
                    y={SITE_CONFIG.warningLevelFt}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{ value: "Warning", position: "insideTopLeft", fill: "#f59e0b", fontSize: 11 }}
                  />
                )}
                {SITE_CONFIG.criticalLevelFt >= yMin && SITE_CONFIG.criticalLevelFt <= yMax && (
                  <ReferenceLine
                    y={SITE_CONFIG.criticalLevelFt}
                    stroke="#ef4444"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{ value: "Critical", position: "insideTopLeft", fill: "#ef4444", fontSize: 11 }}
                  />
                )}
                {/* cursor=false: Recharts' default hover cursor is a straight
                    vertical line, which cuts across the wave. The activeDot
                    on the invisible Area below is enough of a hover cue. */}
                <Tooltip content={<LevelTooltip />} cursor={false} />
                {/* The water is drawn by WaterColumn; this Area is invisible and
                    exists so the tooltip and hover dot still track the series. */}
                <Area
                  type="monotone"
                  dataKey="waterLevelFt"
                  name="Water Level"
                  stroke="none"
                  fill="none"
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: "#e0f2fe", stroke: "#0284c7", strokeWidth: 2 }}
                />
                <Brush
                  dataKey="t"
                  tickFormatter={formatTime}
                  height={22}
                  stroke="#7fa2e4"
                  travellerWidth={8}
                  fill="rgba(100,116,139,0.12)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function PeriodStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "rising" | "falling";
}) {
  const toneClass =
    tone === "rising"
      ? "text-warning-600 dark:text-warning-500"
      : tone === "falling"
        ? "text-primary-600 dark:text-primary-400"
        : "text-neutral-900 dark:text-white";
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-1.5 dark:border-neutral-700">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}
