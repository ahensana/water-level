import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNow } from "../hooks/useNow";
import type { SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ChartSkeleton } from "./Skeletons";

interface EnvironmentalCardProps {
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

interface EnvTooltipPayload {
  label: string;
  temperatureC: number | null;
  pressureHpa: number | null;
}

function EnvTooltip({ active, payload }: { active?: boolean; payload?: { payload: EnvTooltipPayload }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 font-medium text-neutral-500 dark:text-neutral-400">{p.label}</p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-critical-600 dark:text-critical-400">Temperature</span>
        <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">
          {p.temperatureC !== null ? `${p.temperatureC.toFixed(1)} °C` : "—"}
        </span>
      </p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-primary-600 dark:text-primary-400">Pressure</span>
        <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">
          {p.pressureHpa !== null ? `${p.pressureHpa.toFixed(1)} hPa` : "—"}
        </span>
      </p>
    </div>
  );
}

/**
 * Onboard BMP280 temperature/pressure over the last 24h — a diagnostic view,
 * not a water-level input. It exists so an engineer can visually confirm the
 * A01's distance reading isn't drifting with temperature (see the
 * calibration note in config.ts: regression showed no meaningful
 * correlation, so this chart is what "no meaningful correlation" looks like
 * in practice, kept visible rather than asserted).
 */
export function EnvironmentalCard({ history, loadState }: EnvironmentalCardProps) {
  const now = useNow();
  const data = useMemo(() => {
    const cutoff = now - WINDOW_MS;
    return history
      .filter((p) => p.t >= cutoff && (p.temperatureC !== null || p.pressureHpa !== null))
      .map((p) => ({
        t: p.t,
        label: new Date(p.t).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" }),
        temperatureC: p.temperatureC,
        pressureHpa: p.pressureHpa,
      }));
  }, [history, now]);

  if (loadState === "loading") {
    return <ChartSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Environmental Diagnostics</CardTitle>
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">BMP280 · last 24h · not a water-level input</span>
      </CardHeader>
      <CardBody>
        {data.length < 2 ? (
          <div className="flex h-44 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
            Not enough environmental telemetry in the loaded window yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
                minTickGap={40}
              />
              <YAxis
                yAxisId="temp"
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => `${v}°`}
              />
              <YAxis
                yAxisId="pressure"
                orientation="right"
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v: number) => `${v}`}
              />
              <Tooltip content={<EnvTooltip />} />
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperatureC"
                stroke="#ef4444"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                yAxisId="pressure"
                type="monotone"
                dataKey="pressureHpa"
                stroke="#0f62fe"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div className="mt-2 flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-critical-500" /> Temperature (°C, left axis)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-primary-500" /> Pressure (hPa, right axis)
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
