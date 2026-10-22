import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { AreaPoint, JobStatus, ReservoirSnapshot, SiteFacts } from "../../lib/satellite";
import { useNow } from "../../hooks/useNow";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Attribution, Freshness, LegendItem, NotYet, Stat } from "./parts";
import { axisTick, fmtDate } from "./format";

const SOURCE_LABEL: Record<AreaPoint["source"], string> = {
  S1: "Radar (Sentinel-1)",
  S2: "Optical (Sentinel-2)",
};

function AreaTooltip({ active, payload }: { active?: boolean; payload?: { payload: AreaPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="font-medium text-neutral-800 dark:text-neutral-100">{fmtDate(p.t)}</div>
      <div className="text-neutral-600 dark:text-neutral-300">
        {SOURCE_LABEL[p.source]}: {p.km2.toFixed(2)} km²
      </div>
    </div>
  );
}

export function ReservoirAreaCard({ reservoir, site, job }: { reservoir: ReservoirSnapshot | null; site: SiteFacts; job?: JobStatus }) {
  const now = useNow();
  const { radar, optical, latest, previous } = useMemo(() => {
    const series = reservoir?.series ?? [];
    const radar = series.filter((p) => p.source === "S1");
    const optical = series.filter((p) => p.source === "S2");
    return { radar, optical, latest: radar.at(-1), previous: radar.at(-2) };
  }, [reservoir]);

  const change = latest && previous ? latest.km2 - previous.km2 : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reservoir Water Area (Satellite)</CardTitle>
        {reservoir && <Freshness at={reservoir.updatedAt} now={now} staleAfterH={14} source="Copernicus Sentinel" />}
      </CardHeader>
      <CardBody>
        {!reservoir || reservoir.series.length === 0 ? (
          <NotYet job={job} what="reservoir area estimates" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Latest (radar)" value={latest ? `${latest.km2.toFixed(2)} km²` : "–"} sub={latest && fmtDate(latest.t)} />
              <Stat
                label="Change"
                value={change == null ? "–" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)} km²`}
                sub={previous && `since ${fmtDate(previous.t)}`}
              />
              <Stat label="Mapped max" value={site.reservoirMaxKm2 != null ? `${site.reservoirMaxKm2.toFixed(2)} km²` : "–"} sub="1984–2021 extent" />
            </div>

            <div className="mt-4 flex items-center gap-4">
              <LegendItem color="var(--viz-obs)" label={SOURCE_LABEL.S1} shape="dot" />
              <LegendItem color="var(--viz-alt)" label={SOURCE_LABEL.S2} shape="square" />
              <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">km²</span>
            </div>
            <div className="mt-2 h-48" role="img" aria-label="Reservoir water area over time from radar and optical satellites">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                  <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={{ stroke: "var(--viz-grid)" }}
                    tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  />
                  <YAxis
                    dataKey="km2"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip content={<AreaTooltip />} />
                  <Line
                    data={radar}
                    dataKey="km2"
                    stroke="var(--viz-obs)"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "var(--viz-obs)", stroke: "var(--viz-surface)", strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                    isAnimationActive={false}
                  />
                  <Scatter data={optical} dataKey="km2" fill="var(--viz-alt)" shape="square" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
              An independent check on the gauge: surface area rises and falls with level, and it does not depend on where the sensor is
              mounted. Radar sees through cloud; wind-roughened water can read slightly small.
            </p>
            <Attribution>Contains modified Copernicus Sentinel data {new Date().getFullYear()}, processed with Google Earth Engine.</Attribution>
          </>
        )}
      </CardBody>
    </Card>
  );
}
