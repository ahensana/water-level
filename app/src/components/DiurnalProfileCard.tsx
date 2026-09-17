import { useMemo } from "react";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { computeDiurnalProfile } from "../lib/analytics";
import type { SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ChartSkeleton } from "./Skeletons";

interface DiurnalProfileCardProps {
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
}

interface DiurnalTooltipPayload {
  hourLabel: string;
  meanFt: number | null;
  minFt: number | null;
  maxFt: number | null;
  count: number;
}

const signedFt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)} ft`;
const signedMm = (v: number) => `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 304.8)} mm`;

function DiurnalTooltip({ active, payload }: { active?: boolean; payload?: { payload: DiurnalTooltipPayload }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  if (p.meanFt === null) return null;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 font-medium text-neutral-500 dark:text-neutral-400">{p.hourLabel}</p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-primary-600 dark:text-primary-400">Deviation</span>
        <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">
          {signedFt(p.meanFt)} ({signedMm(p.meanFt)})
        </span>
      </p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-neutral-500 dark:text-neutral-400">Across days</span>
        <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">
          {p.minFt !== null ? signedFt(p.minFt) : "—"} … {p.maxFt !== null ? signedFt(p.maxFt) : "—"}
        </span>
      </p>
      <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">{p.count} day{p.count === 1 ? "" : "s"}</p>
    </div>
  );
}

/**
 * The repeating daily rhythm in water level, plotted as a deviation from each
 * day's own trend so the reservoir's slow rise or fall does not swamp it.
 *
 * This exists because the A01 shows a consistent oscillation that the manual
 * staff-gauge register does not record, so operators comparing the two need to
 * see its size and timing rather than be surprised by it. See
 * `computeDiurnalProfile` for the method and what the 7-12 Aug data showed.
 */
export function DiurnalProfileCard({ history, loadState }: DiurnalProfileCardProps) {
  const profile = useMemo(() => computeDiurnalProfile(history), [history]);

  if (loadState === "loading") {
    return <ChartSkeleton />;
  }

  const data = profile.buckets.map((b) => ({
    hour: b.hour,
    hourLabel: formatHour(b.hour),
    meanFt: b.meanFt,
    minFt: b.minFt,
    maxFt: b.maxFt,
    count: b.count,
    // Area needs a [low, high] band, not two separate series, to shade between them.
    band: b.minFt !== null && b.maxFt !== null ? [b.minFt, b.maxFt] : null,
  }));
  const withData = data.filter((d) => d.meanFt !== null);
  const { dayCount, swingFt, peakHour } = profile;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diurnal Profile</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
          Deviation from each day's trend · {dayCount} full day{dayCount === 1 ? "" : "s"}
        </span>
      </CardHeader>
      <CardBody>
        {withData.length < 3 || dayCount < 2 ? (
          <div className="flex h-44 items-center justify-center px-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Needs at least two full days of trusted readings before a daily rhythm can be separated
            from the reservoir's own trend.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="hour"
                tickFormatter={(h: number) => formatHour(h)}
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
                interval={3}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={["dataMin - 0.02", "dataMax + 0.02"]}
                tickFormatter={(v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2))}
              />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
              <Tooltip content={<DiurnalTooltip />} />
              <Area type="monotone" dataKey="band" stroke="none" fill="#0f62fe" fillOpacity={0.12} connectNulls />
              <Line
                type="monotone"
                dataKey="meanFt"
                stroke="#0f62fe"
                strokeWidth={2}
                dot={{ r: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {dayCount >= 2 && swingFt !== null && (
          <p className="mt-2 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
            Daily swing of {(swingFt * 304.8).toFixed(0)} mm ({swingFt.toFixed(3)} ft)
            {peakHour !== null && `, peaking around ${formatHour(peakHour)}`}. The manual staff-gauge
            register does not show this rhythm, so expect the sensor and the logbook to disagree by
            about this much at the extremes even when both are working correctly.
            {dayCount < 4 &&
              ` Built from the ${dayCount} full day${dayCount === 1 ? "" : "s"} in the loaded history window, so treat the exact shape as indicative.`}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function formatHour(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}
