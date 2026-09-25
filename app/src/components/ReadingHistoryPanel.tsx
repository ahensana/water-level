import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { SITE_CONFIG } from "../config";
import { downloadCsv } from "../lib/csvExport";
import { downloadXlsx } from "../lib/excelExport";
import { fetchReadingsBetween } from "../lib/firebase";
import {
  buildTrustedHistory,
  DEFAULT_FILTERS,
  filterTrustedHistory,
  isFilterActive,
  summarizeHistory,
  trustedHistorySheet,
  trustedHistoryToCsv,
  type HistoryFilters,
  type TrustedReading,
} from "../lib/readingHistory";
import { ALERT_LEVEL_SHORT, replayAlertLevels } from "../lib/waterLevel";
import type { AlertLevel, RawWaterMonitorReading, SessionHistoryPoint } from "../types";

interface ReadingHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  /** Already-loaded session history, shown until a wider range is requested. */
  sessionHistory: SessionHistoryPoint[];
}

type Status = "session" | "loading" | "ready" | "error";

const PRESETS = [
  { label: "Last 24 h", ms: 24 * 3600_000 },
  { label: "Last 3 days", ms: 3 * 86_400_000 },
  { label: "Last 7 days", ms: 7 * 86_400_000 },
  { label: "Last 30 days", ms: 30 * 86_400_000 },
] as const;

const MAX_RANGE_MS = 31 * 86_400_000;
const PAGE_SIZE = 300;
const BANDS: AlertLevel[] = ["normal", "warning", "critical"];

export function ReadingHistoryPanel({ open, onClose, sessionHistory }: ReadingHistoryPanelProps) {
  const headingId = useId();

  const [fromLocal, setFromLocal] = useState(() => toLocalInput(Date.now() - 24 * 3600_000));
  const [toLocal, setToLocal] = useState(() => toLocalInput(Date.now()));
  const [status, setStatus] = useState<Status>("session");
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<RawWaterMonitorReading[] | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const load = useCallback(async (fromMs: number, toMs: number) => {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      setStatus("error");
      setError("End time must be after the start time.");
      return;
    }
    if (toMs - fromMs > MAX_RANGE_MS) {
      setStatus("error");
      setError(`Range is limited to ${MAX_RANGE_MS / 86_400_000} days per load.`);
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchReadingsBetween(SITE_CONFIG.firebaseDataPath, fromMs, toMs);
      setFetched(data);
      setVisible(PAGE_SIZE);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not load readings for that period.");
    }
  }, []);

  const runRange = (from: number, to: number) => {
    setFromLocal(toLocalInput(from));
    setToLocal(toLocalInput(to));
    void load(from, to);
  };

  // Until a range is pulled, browse what the dashboard already holds — the panel
  // is useful the instant it opens rather than after a round trip.
  const allRows = useMemo<TrustedReading[]>(() => {
    if (fetched) return buildTrustedHistory(fetched);
    return annotateSessionHistory(sessionHistory);
  }, [fetched, sessionHistory]);

  const rows = useMemo(() => filterTrustedHistory(allRows, filters), [allRows, filters]);
  const summary = useMemo(() => summarizeHistory(rows), [rows]);

  // Narrowing the result set should return the operator to the top of the list
  // rather than leaving them paged deep into rows that no longer exist.
  const changeFilters = (next: HistoryFilters) => {
    setFilters(next);
    setVisible(PAGE_SIZE);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-950/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="my-4 w-full max-w-5xl rounded-xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-xl border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
          <div>
            <h2 id={headingId} className="text-sm font-semibold text-neutral-900 dark:text-white">
              Trusted Reading History
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Every reading the dashboard trusts, for any period
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reading history"
            className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <PeriodPicker
            fromLocal={fromLocal}
            toLocal={toLocal}
            onFromChange={setFromLocal}
            onToChange={setToLocal}
            onRunRange={runRange}
            onRun={() => void load(fromLocalToMs(fromLocal), fromLocalToMs(toLocal))}
            busy={status === "loading"}
            usingSession={!fetched}
          />

          <FilterBar filters={filters} onChange={changeFilters} />

          {status === "error" && (
            <p className="rounded-lg bg-critical-50 px-3 py-2 text-sm text-critical-700 dark:bg-critical-500/10 dark:text-critical-500">
              {error}
            </p>
          )}

          {status === "loading" ? (
            <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Loading readings for the selected period…
            </p>
          ) : (
            <>
              <SummaryBar summary={summary} total={allRows.length} filters={filters} rows={rows} />
              <HistoryTable rows={rows} visible={visible} onShowMore={() => setVisible((v) => v + PAGE_SIZE)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Session points are already trusted output of the same pipeline, so they only
 * need the alert band attaching — re-deriving them would mean re-fetching raw
 * readings the app has already processed.
 */
function annotateSessionHistory(history: SessionHistoryPoint[]): TrustedReading[] {
  const levels = replayAlertLevels(history.map((p) => p.waterLevelFt));
  return history.map((point, i) => ({ ...point, alertLevel: levels[i] }));
}

// ------------------------------------------------------------------ period

function PeriodPicker({
  fromLocal,
  toLocal,
  onFromChange,
  onToChange,
  onRunRange,
  onRun,
  busy,
  usingSession,
}: {
  fromLocal: string;
  toLocal: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onRunRange: (from: number, to: number) => void;
  onRun: () => void;
  busy: boolean;
  usingSession: boolean;
}) {
  const [day, setDay] = useState("");

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => {
              setDay("");
              const to = Date.now();
              onRunRange(to - p.ms, to);
            }}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-600" />
        <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Single day
          <input
            type="date"
            value={day}
            disabled={busy}
            onChange={(e) => {
              setDay(e.target.value);
              if (!e.target.value) return;
              const [y, m, d] = e.target.value.split("-").map(Number);
              const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
              onRunRange(start, start + 86_400_000 - 1);
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">From</span>
          <input
            type="datetime-local"
            value={fromLocal}
            onChange={(e) => onFromChange(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">To</span>
          <input
            type="datetime-local"
            value={toLocal}
            onChange={(e) => onToChange(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="rounded-md bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-50"
        >
          {busy ? "Loading…" : "Load period"}
        </button>
      </div>

      {usingSession && (
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
          Currently showing the history already loaded in this session. Pick a period above to pull the full
          record from the server.
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- filters

function FilterBar({
  filters,
  onChange,
}: {
  filters: HistoryFilters;
  onChange: (f: HistoryFilters) => void;
}) {
  const toggleBand = (band: AlertLevel) => {
    const next = filters.alertLevels.includes(band)
      ? filters.alertLevels.filter((b) => b !== band)
      : [...filters.alertLevels, band];
    onChange({ ...filters, alertLevels: next });
  };

  const numberOrNull = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Filters
        </h3>
        {isFilterActive(filters) && (
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
            className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Alert band
          </span>
          <div className="flex gap-1.5">
            {BANDS.map((band) => {
              const active = filters.alertLevels.includes(band);
              return (
                <button
                  key={band}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleBand(band)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? "border-primary-500 bg-primary-500 text-white"
                      : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  }`}
                >
                  {ALERT_LEVEL_SHORT[band]}
                </button>
              );
            })}
          </div>
        </div>

        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">Level from (ft)</span>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={filters.minLevelFt ?? ""}
            placeholder="3197.00"
            onChange={(e) => onChange({ ...filters, minLevelFt: numberOrNull(e.target.value) })}
            className="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm tabular-nums text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">Level to (ft)</span>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={filters.maxLevelFt ?? ""}
            placeholder="3220.00"
            onChange={(e) => onChange({ ...filters, maxLevelFt: numberOrNull(e.target.value) })}
            className="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm tabular-nums text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Time of day
          </span>
          <div className="flex items-center gap-1.5">
            <HourSelect
              value={filters.fromHour}
              label="Any"
              onChange={(h) => onChange({ ...filters, fromHour: h })}
            />
            <span className="text-xs text-neutral-400">to</span>
            <HourSelect
              value={filters.toHour}
              label="Any"
              onChange={(h) => onChange({ ...filters, toHour: h })}
            />
          </div>
        </div>

        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">Order</span>
          <select
            value={filters.sort}
            onChange={(e) => onChange({ ...filters, sort: e.target.value as HistoryFilters["sort"] })}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      {filters.fromHour !== null &&
        filters.toHour !== null &&
        filters.fromHour > filters.toHour && (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Window wraps past midnight — including {pad(filters.fromHour)}:00–23:59 and 00:00–
            {pad(filters.toHour)}:59.
          </p>
        )}
    </div>
  );
}

function HourSelect({
  value,
  label,
  onChange,
}: {
  value: number | null;
  label: string;
  onChange: (h: number | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm tabular-nums text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <option value="">{label}</option>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {pad(h)}:00
        </option>
      ))}
    </select>
  );
}

// ----------------------------------------------------------------- results

function SummaryBar({
  summary,
  total,
  filters,
  rows,
}: {
  summary: ReturnType<typeof summarizeHistory>;
  total: number;
  filters: HistoryFilters;
  rows: TrustedReading[];
}) {
  // Writing the workbook is off the main thread only after ExcelJS loads, and
  // the library is ~1 MB on a site connection, so the button says what it is doing.
  const [exporting, setExporting] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900/60">
      <div className="text-xs text-neutral-600 dark:text-neutral-300">
        {summary === null ? (
          <span>No trusted readings match the current filters.</span>
        ) : (
          <>
            <strong className="tabular-nums">{summary.count.toLocaleString()}</strong>
            {isFilterActive(filters) && <> of {total.toLocaleString()}</>} trusted reading
            {summary.count === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums">
              {summary.minFt.toFixed(2)}–{summary.maxFt.toFixed(2)} ft
            </span>{" "}
            (median <span className="tabular-nums">{summary.medianFt.toFixed(2)}</span>) ·{" "}
            {formatStamp(summary.firstMs)} → {formatStamp(summary.lastMs)}
            {(summary.bandCounts.warning > 0 || summary.bandCounts.critical > 0) && (
              <>
                {" "}
                ·{" "}
                <span className="font-semibold text-warning-700 dark:text-warning-500">
                  {summary.bandCounts.warning} warning
                </span>
                {summary.bandCounts.critical > 0 && (
                  <span className="font-semibold text-critical-700 dark:text-critical-500">
                    , {summary.bandCounts.critical} critical
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={rows.length === 0 || exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadXlsx(
                `trusted-reading-history-${new Date().toISOString().slice(0, 10)}`,
                trustedHistorySheet(rows),
              );
            } finally {
              setExporting(false);
            }
          }}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          {exporting ? "Preparing…" : `Export ${rows.length.toLocaleString()} rows to Excel`}
        </button>
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              `trusted-reading-history-${new Date().toISOString().slice(0, 10)}`,
              trustedHistoryToCsv(rows),
            )
          }
          title="Plain CSV, for importing into another system"
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-700"
        >
          CSV
        </button>
      </div>
    </div>
  );
}

function HistoryTable({
  rows,
  visible,
  onShowMore,
}: {
  rows: TrustedReading[];
  visible: number;
  onShowMore: () => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg bg-neutral-50 px-3 py-8 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
        Nothing to show. Widen the period or clear the filters.
      </p>
    );
  }

  return (
    <>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <tr>
              <Th>Time</Th>
              <Th right>Air gap</Th>
              <Th right>Level (ft)</Th>
              <Th right>Level (m)</Th>
              <Th right>Capacity</Th>
              <Th>Band</Th>
              <Th right>Temp</Th>
              <Th right>Battery</Th>
              <Th right>Signal</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {rows.slice(0, visible).map((r) => (
              <tr key={r.t} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/40">
                <Td>{formatStamp(r.t, true)}</Td>
                <Td right>{Math.round(r.distanceMm)} mm</Td>
                <Td right strong>
                  {r.waterLevelFt.toFixed(2)}
                </Td>
                <Td right>{r.waterLevelM.toFixed(2)}</Td>
                <Td right>{r.capacityPct.toFixed(2)}%</Td>
                <Td>
                  <BandBadge level={r.alertLevel} />
                </Td>
                <Td right>{r.temperatureC === null ? "—" : `${r.temperatureC.toFixed(1)}°`}</Td>
                <Td right>{r.batteryVoltage === null ? "—" : `${r.batteryVoltage.toFixed(2)} V`}</Td>
                <Td right>{r.signalStrength === null ? "—" : `${r.signalStrength}/31`}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visible && (
        <div className="text-center">
          <button
            type="button"
            onClick={onShowMore}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Show {Math.min(PAGE_SIZE, rows.length - visible).toLocaleString()} more (
            {(rows.length - visible).toLocaleString()} remaining)
          </button>
        </div>
      )}
    </>
  );
}

function BandBadge({ level }: { level: AlertLevel }) {
  const tone =
    level === "critical"
      ? "bg-critical-100 text-critical-700 dark:bg-critical-500/20 dark:text-critical-500"
      : level === "warning"
        ? "bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-500"
        : "bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-500";
  return (
    <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase ${tone}`}>
      {ALERT_LEVEL_SHORT[level]}
    </span>
  );
}

// ------------------------------------------------------------------- bits

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-2.5 py-2 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({
  children,
  right,
  strong,
}: {
  children: ReactNode;
  right?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`px-2.5 py-1.5 tabular-nums ${right ? "text-right" : "text-left"} ${
        strong ? "font-semibold text-neutral-900 dark:text-white" : "text-neutral-600 dark:text-neutral-300"
      }`}
    >
      {children}
    </td>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatStamp(ms: number, withSeconds = false): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  });
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalToMs(value: string): number {
  return new Date(value).getTime();
}
