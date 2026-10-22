import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { JobStatus, WeatherHour, WeatherSnapshot } from "../../lib/satellite";
import { useNow } from "../../hooks/useNow";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Attribution, Freshness, LegendItem, NotYet, Stat } from "./parts";
import { axisTick, fmtMm, fmtTime } from "./format";

interface Row {
  t: number;
  past: number | null;
  forecast: number | null;
  prob: number | null;
  cond: string | null;
}

function toRows(hours: WeatherHour[]): Row[] {
  return hours.map((h) => ({
    t: h.t,
    past: h.kind === "past" ? (h.rainMm ?? 0) : null,
    forecast: h.kind === "forecast" ? (h.rainMm ?? 0) : null,
    prob: h.probPct,
    cond: h.cond,
  }));
}

function RainTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const mm = r.past ?? r.forecast;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="font-medium text-neutral-800 dark:text-neutral-100">{fmtTime(r.t)}</div>
      <div className="text-neutral-600 dark:text-neutral-300">
        {r.past != null ? "Observed" : "Forecast"}: {fmtMm(mm)}
        {r.forecast != null && r.prob != null && ` · ${r.prob}% chance`}
      </div>
      {r.cond && <div className="text-neutral-500 dark:text-neutral-400">{r.cond}</div>}
    </div>
  );
}

export function WeatherRainCard({ weather, job }: { weather: WeatherSnapshot | null; job?: JobStatus }) {
  const now = useNow();
  const rows = useMemo(() => (weather ? toRows(weather.hours) : []), [weather]);
  const nowTick = useMemo(() => rows.find((r) => r.forecast != null)?.t, [rows]);
  // One label per local midnight: hourly labels collide on a phone.
  const midnights = useMemo(() => rows.filter((r) => new Date(r.t).getHours() === 0).map((r) => r.t), [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rain at the Dam</CardTitle>
        {weather && <Freshness at={weather.updatedAt} now={now} staleAfterH={3} source="Google Weather" />}
      </CardHeader>
      <CardBody>
        {!weather ? (
          <NotYet job={job} what="weather data" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Now"
                value={weather.current.tempC != null ? `${weather.current.tempC.toFixed(0)}°C` : "–"}
                sub={[weather.current.cond, weather.current.humidityPct != null && `${weather.current.humidityPct}% RH`].filter(Boolean).join(" · ")}
              />
              <Stat label="Past 24 h" value={fmtMm(weather.totals.past24hMm ?? weather.current.rainLast24hMm)} />
              <Stat label="Next 24 h" value={fmtMm(weather.totals.next24hMm)} sub="forecast" />
              <Stat label="Next 72 h" value={fmtMm(weather.totals.next72hMm)} sub="forecast" />
            </div>

            <div className="mt-4 flex items-center gap-4">
              <LegendItem color="var(--viz-obs)" label="Observed (past 24 h)" />
              <LegendItem color="var(--viz-fcst)" label="Forecast (next 72 h)" />
              <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">mm per hour</span>
            </div>
            <div className="mt-2 h-48" role="img" aria-label="Hourly rainfall at the dam: past 24 hours and 72-hour forecast">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} barCategoryGap="12%" margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
                  <XAxis
                    dataKey="t"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={{ stroke: "var(--viz-grid)" }}
                    ticks={midnights}
                    interval={0}
                    tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                  />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <Tooltip content={<RainTooltip />} cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }} />
                  {nowTick != null && (
                    <ReferenceLine x={nowTick} stroke="var(--viz-axis)" label={{ value: "Now", position: "insideTopLeft", fill: "var(--viz-axis)", fontSize: 11 }} />
                  )}
                  <Bar dataKey="past" stackId="rain" fill="var(--viz-obs)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                  <Bar dataKey="forecast" stackId="rain" fill="var(--viz-fcst)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {weather.days.length > 0 && (
              <table className="mt-4 w-full text-[13px] tabular-nums sm:text-sm">
                <caption className="sr-only">Daily forecast</caption>
                <thead>
                  <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    <th className="pb-1.5 font-medium">Day</th>
                    <th className="pb-1.5 text-right font-medium">Rain</th>
                    <th className="pb-1.5 text-right font-medium">Chance</th>
                    <th className="pb-1.5 text-right font-medium">Temp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {weather.days.map((d) => (
                    <tr key={d.date} className="text-neutral-800 dark:text-neutral-100">
                      <td className="py-1.5">
                        {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                        {d.cond && <span className="ml-1.5 hidden text-[11px] text-neutral-400 sm:inline dark:text-neutral-500">{d.cond}</span>}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right font-semibold">{fmtMm(d.rainMm)}</td>
                      <td className="py-1.5 text-right">{d.probPct != null ? `${d.probPct}%` : "–"}</td>
                      <td className="whitespace-nowrap py-1.5 pl-2 text-right">
                        {d.minC != null && d.maxC != null ? `${d.minC.toFixed(0)}–${d.maxC.toFixed(0)}°C` : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Attribution>Point forecast at the reservoir from the Google Maps Platform Weather API.</Attribution>
          </>
        )}
      </CardBody>
    </Card>
  );
}
