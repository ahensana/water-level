import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { SITE_CONFIG } from "../config";
import { useNow } from "../hooks/useNow";
import { downloadCsv } from "../lib/csvExport";
import { fetchReadingsBetween } from "../lib/firebase";
import {
  buildHourlyRegister,
  historyCoversDay,
  hourlyRegisterToCsv,
  istDateKey,
  istDayStartMs,
  type HourlyRegister,
  type HourlySlot,
} from "../lib/hourlyRegister";
import { buildTrustedHistory } from "../lib/readingHistory";
import { ALERT_LEVEL_SHORT } from "../lib/waterLevel";
import type { DerivedReading, SessionHistoryPoint } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { StatusBadge } from "./ui/StatusBadge";
import { ListSkeleton } from "./Skeletons";

interface HourlyGaugeCardProps {
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  loadState: "loading" | "ready" | "error";
  onOpenReport: () => void;
}

const COMMISSIONING = istDateKey(SITE_CONFIG.dataStartMs);

export function HourlyGaugeCard({ reading, history, loadState, onOpenReport }: HourlyGaugeCardProps) {
  const now = useNow(15_000);
  const today = istDateKey(now);
  const [dateKey, setDateKey] = useState(today);
  const viewDate = dateKey > today ? today : dateKey;
  const [fetched, setFetched] = useState<{ date: string; rows: SessionHistoryPoint[] } | null>(null);
  const [fetchError, setFetchError] = useState<{ date: string; message: string } | null>(null);
  const covered = historyCoversDay(history, viewDate, now);

  useEffect(() => {
    if (loadState !== "ready" || covered) return;
    let cancelled = false;
    void fetchReadingsBetween(
      SITE_CONFIG.firebaseDataPath,
      istDayStartMs(viewDate),
      istDayStartMs(viewDate) + 25 * 3_600_000,
    )
      .then((raw) => {
        if (cancelled) return;
        setFetched({ date: viewDate, rows: buildTrustedHistory(raw) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFetchError({
          date: viewDate,
          message: e instanceof Error ? e.message : "Could not load that day's readings.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [viewDate, loadState, covered]);

  const register = useMemo(() => {
    const series = covered ? history : fetched?.date === viewDate ? fetched.rows : [];
    return buildHourlyRegister(series, viewDate, now);
  }, [covered, history, fetched, viewDate, now]);

  if (loadState === "loading") return <ListSkeleton rows={8} />;

  const error = fetchError?.date === viewDate ? fetchError.message : null;
  const waiting = !covered && fetched?.date !== viewDate && !error;
  const canPrev = viewDate > COMMISSIONING;
  const canNext = viewDate < today;
  const isToday = viewDate === today;

  const shiftDay = (delta: number) => {
    const start = istDayStartMs(dateKey) + delta * 86_400_000;
    const next = istDateKey(start + 12 * 3_600_000);
    if (next < COMMISSIONING || next > today) return;
    setDateKey(next);
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Hourly Gauge Register</CardTitle>
          <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
            Same 24-hour book as the field staff gauge · IST
          </p>
        </div>
        {reading && !reading.isSensorFault ? (
          <StatusBadge
            level={reading.alertLevel}
            label={`Live ${reading.waterLevelFt.toFixed(2)} ft`}
            pulse={!reading.isStale}
          />
        ) : (
          <span className="text-xs font-medium text-neutral-400">No live level</span>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {reading && !reading.isSensorFault && (
          <LiveStrip reading={reading} now={now} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => shiftDay(-1)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200"
            >
              Previous
            </button>
            <input
              type="date"
              min={COMMISSIONING}
              max={today}
              value={viewDate}
              onChange={(e) => {
                if (e.target.value) setDateKey(e.target.value);
              }}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              type="button"
              disabled={!canNext}
              onClick={() => shiftDay(1)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200"
            >
              Next
            </button>
            {!isToday && (
              <button
                type="button"
                onClick={() => setDateKey(today)}
                className="rounded-md bg-primary-500 px-2.5 py-1 text-xs font-semibold text-white"
              >
                Today
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={register.filled === 0}
              onClick={() => downloadCsv(`hourly-gauge-${viewDate}`, hourlyRegisterToCsv(register))}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-600 dark:text-neutral-200"
            >
              Export day
            </button>
            <button
              type="button"
              onClick={onOpenReport}
              className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              Full interval report
            </button>
          </div>
        </div>

        <DaySummary register={register} fetching={waiting} />

        {error && (
          <p className="rounded-lg bg-critical-50 px-3 py-2 text-sm text-critical-700 dark:bg-critical-500/10 dark:text-critical-500">
            {error}
          </p>
        )}

        {waiting ? (
          <p className="py-6 text-center text-sm text-neutral-500">Loading hourly record for {viewDate}…</p>
        ) : (
          <HourTable register={register} liveFt={reading && !reading.isSensorFault ? reading.waterLevelFt : null} />
        )}
      </CardBody>
    </Card>
  );
}

function LiveStrip({ reading, now }: { reading: DerivedReading; now: number }) {
  const ageSec = Math.max(0, Math.round((now - reading.receivedAtMs) / 1000));
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 dark:border-primary-500/20 dark:bg-primary-500/10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-400">
          Real-time
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900 dark:text-white">
          {reading.waterLevelFt.toFixed(2)}{" "}
          <span className="text-sm font-medium text-neutral-500">ft</span>
          <span className="ml-2 text-sm font-normal text-neutral-500 dark:text-neutral-400">
            / {reading.waterLevelM.toFixed(2)} m · {reading.capacityPct.toFixed(1)}% · trusted{" "}
            {Math.round(reading.distanceMm)} mm
          </span>
        </p>
      </div>
      <p className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
        {ageSec < 90 ? `Updated ${ageSec}s ago` : reading.isStale ? "Stale" : "Live"}
      </p>
    </div>
  );
}

function DaySummary({ register, fetching }: { register: HourlyRegister; fetching: boolean }) {
  if (fetching && register.filled === 0) return null;
  if (register.filled === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        No trusted hourly readings for this date.
      </p>
    );
  }
  return (
    <p className="text-xs text-neutral-600 dark:text-neutral-300">
      <span className="font-semibold tabular-nums">{register.filled}</span>/24 hours ·{" "}
      {register.minFt !== null && register.maxFt !== null && (
        <>
          <span className="tabular-nums">
            {register.minFt.toFixed(2)}–{register.maxFt.toFixed(2)} ft
          </span>
          {register.medianFt !== null && (
            <>
              {" "}
              (median <span className="tabular-nums">{register.medianFt.toFixed(2)}</span>)
            </>
          )}
        </>
      )}
      {register.netChangeFt !== null && (
        <>
          {" "}
          · day {register.netChangeFt >= 0 ? "+" : "−"}
          <span className="tabular-nums">{Math.abs(register.netChangeFt).toFixed(2)}</span> ft
        </>
      )}
    </p>
  );
}

function HourTable({ register, liveFt }: { register: HourlyRegister; liveFt: number | null }) {
  const am = register.slots.slice(0, 12);
  const pm = register.slots.slice(12);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <SlotColumn title="1 AM – 12 Noon" slots={am} liveFt={liveFt} />
      <SlotColumn title="1 PM – 12 MN" slots={pm} liveFt={liveFt} />
    </div>
  );
}

function SlotColumn({
  title,
  slots,
  liveFt,
}: {
  title: string;
  slots: HourlySlot[];
  liveFt: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <table className="w-full text-left text-xs">
        <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
          <tr>
            <th className="px-2.5 py-1.5 font-semibold">{title}</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Level (ft)</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Δ</th>
            <th className="px-2.5 py-1.5 font-semibold">Band</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {slots.map((s) => (
            <tr
              key={s.hourIdx}
              className={clsx(
                s.isLive && "bg-primary-50/80 dark:bg-primary-500/10",
                s.isFuture && "opacity-50",
              )}
            >
              <td className="px-2.5 py-1.5">
                <span className="font-medium text-neutral-800 dark:text-neutral-100">{s.label}</span>
                {s.isLive && (
                  <span className="ml-1.5 rounded bg-primary-500 px-1 py-px text-[10px] font-semibold uppercase text-white">
                    Now
                  </span>
                )}
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-neutral-900 dark:text-white">
                {s.waterLevelFt === null ? (
                  <span className="font-normal text-neutral-400">{s.isFuture ? "—" : "No data"}</span>
                ) : (
                  <>
                    {s.waterLevelFt.toFixed(2)}
                    {s.isLive && liveFt !== null && (
                      <span className="mt-0.5 block text-[10px] font-normal text-primary-700 dark:text-primary-400">
                        live {liveFt.toFixed(2)}
                      </span>
                    )}
                  </>
                )}
              </td>
              <td
                className={clsx(
                  "px-2.5 py-1.5 text-right tabular-nums",
                  s.deltaFt === null
                    ? "text-neutral-400"
                    : s.deltaFt > 0
                      ? "text-success-700 dark:text-success-500"
                      : s.deltaFt < 0
                        ? "text-neutral-500"
                        : "text-neutral-400",
                )}
              >
                {s.deltaFt === null
                  ? "—"
                  : `${s.deltaFt >= 0 ? "+" : "−"}${Math.abs(s.deltaFt).toFixed(2)}`}
              </td>
              <td className="px-2.5 py-1.5">
                {s.alertLevel ? (
                  <span
                    className={clsx(
                      "rounded px-1.5 py-px text-[10px] font-semibold uppercase",
                      s.alertLevel === "critical"
                        ? "bg-critical-100 text-critical-700 dark:bg-critical-500/20 dark:text-critical-500"
                        : s.alertLevel === "warning"
                          ? "bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-500"
                          : "bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-500",
                    )}
                  >
                    {ALERT_LEVEL_SHORT[s.alertLevel]}
                  </span>
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
