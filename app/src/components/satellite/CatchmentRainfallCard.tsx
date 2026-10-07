import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { JobStatus, RainfallSnapshot, SiteFacts } from "../../lib/satellite";
import { useNow } from "../../hooks/useNow";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Attribution, Freshness, NotYet, Stat } from "./parts";
import { axisTick, fmtMm, fmtTime } from "./format";

interface DayRow {
  key: string;
  label: string;
  mm: number;
  hours: number;
}

/** Hourly catchment-mean rainfall summed into local days, oldest first. */
function byDay(hours: [number, number][]): DayRow[] {
  const days = new Map<string, DayRow>();
  for (const [t, mm] of hours) {
    const d = new Date(t);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const row = days.get(key) ?? {
      key,
      label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
      mm: 0,
      hours: 0,
    };
    row.mm += mm;
    row.hours += 1;
    days.set(key, row);
  }
  return [...days.values()].map((r) => ({ ...r, mm: Math.round(r.mm * 10) / 10 }));
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload: DayRow }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="font-medium text-neutral-800 dark:text-neutral-100">{r.label}</div>
      <div className="text-neutral-600 dark:text-neutral-300">
        {fmtMm(r.mm)} catchment average
        {r.hours < 24 && ` · ${r.hours} of 24 h available`}
      </div>
    </div>
  );
}

export function CatchmentRainfallCard({ rainfall, site, job }: { rainfall: RainfallSnapshot | null; site: SiteFacts; job?: JobStatus }) {
  const now = useNow();
  const days = useMemo(() => (rainfall ? byDay(rainfall.hours) : []), [rainfall]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catchment Rainfall (Satellite)</CardTitle>
        {rainfall && <Freshness at={rainfall.updatedAt} now={now} staleAfterH={3} source="JAXA GSMaP" />}
      </CardHeader>
      <CardBody>
        {!rainfall || rainfall.latestDataAt == null ? (
          <NotYet job={job} what="satellite rainfall" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="24 h" value={fmtMm(rainfall.totals.h24)} />
              <Stat label="72 h" value={fmtMm(rainfall.totals.h72)} />
              <Stat label="7 days" value={fmtMm(rainfall.totals.d7)} />
            </div>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Totals run back from the newest satellite hour, <span className="font-medium">{fmtTime(rainfall.latestDataAt)}</span>
              {rainfall.lagHours != null && ` (${Math.round(rainfall.lagHours)} h behind real time)`}. Use Rain at the Dam for the
              last few hours.
            </p>

            <div className="mt-3 text-right text-xs text-neutral-400 dark:text-neutral-500">mm per day, catchment average</div>
            <div className="mt-1 h-44" role="img" aria-label="Daily satellite rainfall averaged over the catchment">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={days} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--viz-grid)" }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <Tooltip content={<DayTooltip />} cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }} />
                  <Bar dataKey="mm" fill="var(--viz-obs)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>Daily catchment rainfall</caption>
              <tbody>
                {days.map((d) => (
                  <tr key={d.key}>
                    <th scope="row">{d.label}</th>
                    <td>{fmtMm(d.mm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Attribution>
              Data: JAXA Global Satellite Mapping of Precipitation (GSMaP), hourly, 0.1°, via Google Earth Engine. Provisional
              near-real-time values, revised later by JAXA.
              {site.catchmentKm2 != null &&
                ` Catchment ${site.catchmentKm2.toFixed(0)} km² traced from HydroBASINS` +
                  (site.publishedCatchmentKm2 != null ? ` (published figure ${site.publishedCatchmentKm2.toFixed(0)} km²).` : ".")}
            </Attribution>
          </>
        )}
      </CardBody>
    </Card>
  );
}
