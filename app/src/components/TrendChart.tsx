import { useId, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Brush,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Produces a clean Y axis: a domain max with headroom above the mount height,
 * rounded up to a "nice" step, plus evenly-spaced ticks at that step. This keeps
 * the axis ordered and readable for any mount height (3 m, 20 m, etc.).
 *
 * Headroom is kept tight because the water level is clamped to the mount height
 * - nothing can ever be drawn above the sensor line except its own label, so a
 * taller domain just shrinks the water column into the bottom of the frame.
 */
function buildYAxis(mountHeightM: number): { yMax: number; yTicks: number[] } {
  const withHeadroom = mountHeightM * 1.15;
  // Try a few tick counts and keep whichever lands on the tightest round domain.
  let best = { yMax: Infinity, step: 1 };
  for (const divisor of [5, 4, 3]) {
    const step = niceStep(withHeadroom / divisor);
    const yMax = Math.ceil(withHeadroom / step) * step;
    if (yMax < best.yMax) best = { yMax, step };
  }
  const yTicks: number[] = [];
  for (let v = 0; v <= best.yMax + 1e-9; v += best.step) {
    yTicks.push(Number(v.toFixed(2)));
  }
  return { yMax: best.yMax, yTicks };
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
  mountHeightM,
}: {
  points: SessionHistoryPoint[];
  mountHeightM: number;
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
    const y = yScale(p.waterLevelM);
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      surface.push({ x, y });
    }
  }
  if (surface.length < 2) return null;

  const bed = yScale(0);
  const mountY = yScale(mountHeightM);
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

      {/* Air gap: sensor face down to the bed. The water column is painted over
          the lower part of it, leaving only the true gap visible. */}
      <rect
        x={left}
        y={mountY}
        width={plot.width}
        height={Math.max(0, bed - mountY)}
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
  siteConfig: EditableSiteConfig;
}

interface TooltipPoint {
  label: string;
  waterLevelM: number;
  distanceM: number;
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
    const cutoff = Date.now() - windowMs;
    return history.filter((p) => p.t >= cutoff).map((p) => ({ ...p, label: formatTime(p.t) }));
  }, [history, windowMs, formatTime]);

  // Build an explicit, evenly-spaced, round Y-axis instead of letting Recharts
  // auto-pick ticks - with a non-round domain max (e.g. mountHeight * 1.45) its
  // tick generator can produce out-of-order / uneven labels.
  const { yMax, yTicks } = useMemo(() => buildYAxis(siteConfig.sensorMountHeightM), [
    siteConfig.sensorMountHeightM,
  ]);

  // Size the axis to its longest label. A fixed width wraps "1500 m" onto two
  // lines once the mount height reaches four digits.
  const yAxisWidth = useMemo(() => {
    let longest = 0;
    for (const t of yTicks) longest = Math.max(longest, `${t} m`.length);
    return Math.max(52, longest * 8 + 12);
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
            <ResponsiveContainer width="100%" height={420}>
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
                  domain={[0, yMax]}
                  ticks={yTicks}
                  allowDecimals={false}
                  interval={0}
                  tickFormatter={(value: number) => `${value} m`}
                  width={yAxisWidth}
                />
                <WaterColumn points={data} mountHeightM={siteConfig.sensorMountHeightM} />
                {/* cursor=false: Recharts' default hover cursor is a straight
                    vertical line, which cuts across the wave. The activeDot
                    on the invisible Area below is enough of a hover cue. */}
                <Tooltip content={<LevelTooltip />} cursor={false} />
                {/* The water is drawn by WaterColumn; this Area is invisible and
                    exists so the tooltip and hover dot still track the series. */}
                <Area
                  type="monotone"
                  dataKey="waterLevelM"
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
