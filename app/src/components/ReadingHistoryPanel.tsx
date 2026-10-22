import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SITE_CONFIG } from "../config";
import { downloadCsv } from "../lib/csvExport";
import { downloadXlsx } from "../lib/excelExport";
import { fetchReadingsBetween } from "../lib/firebase";
import { FAULT_CODE_LABEL } from "../lib/sensorQuality";
import {
  buildAllReadings,
  DEFAULT_FILTERS,
  filterTrustedHistory,
  isFilterActive,
  summarizeHistory,
  trustedHistorySheet,
  trustedHistoryToCsv,
  type HistoryFilters,
  type TrustedReading,
} from "../lib/readingHistory";
import { ALERT_LEVEL_SHORT } from "../lib/waterLevel";
import type { AlertLevel, FaultCode, RawWaterMonitorReading } from "../types";

interface ReadingHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  /** Raw readings already loaded this session, shown until a wider range is requested. */
  rawHistory: RawWaterMonitorReading[];
}

type Status = "session" | "loading" | "ready" | "error";

const PRESETS = [
  { label: "Last 24 h", ms: 24 * 3600_000 },
  { label: "Last 3 days", ms: 3 * 86_400_000 },
  { label: "Last 7 days", ms: 7 * 86_400_000 },
  { label: "Last 30 days", ms: 30 * 86_400_000 },
  { label: "Last 90 days", ms: 90 * 86_400_000 },
  /** Everything on record: the fetch is clamped to `dataStartMs` below. */
  { label: "All data", ms: Number.POSITIVE_INFINITY },
] as const;

/**
 * Beyond this, the load is announced rather than refused.
 *
 * There was a hard 31-day cap here, which made a year of filed readings
 * unreachable from the one view built to browse them. The range query is by
 * push key, so a long period costs bandwidth and time, not correctness — and a
 * user who asks for the whole record should get it, told how much is coming.
 */
const LARGE_RANGE_MS = 31 * 86_400_000;
const BANDS: AlertLevel[] = ["normal", "warning", "critical"];
const STATUSES: { value: HistoryFilters["status"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trusted", label: "Trusted" },
  { value: "rejected", label: "Rejected" },
];

export function ReadingHistoryPanel({ open, onClose, rawHistory }: ReadingHistoryPanelProps) {
  const headingId = useId();

  const [fromLocal, setFromLocal] = useState(() => toLocalInput(Date.now() - 24 * 3600_000));
  const [toLocal, setToLocal] = useState(() => toLocalInput(Date.now()));
  const [status, setStatus] = useState<Status>("session");
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<RawWaterMonitorReading[] | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [loadNote, setLoadNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const load = useCallback(async (requestedFromMs: number, requestedToMs: number) => {
    if (!Number.isFinite(requestedFromMs) || !Number.isFinite(requestedToMs)) {
      setStatus("error");
      setError("Enter a start and end time.");
      return;
    }
    // Nothing exists before the record starts or after now, so asking for it
    // only costs a slower query.
    const fromMs = Math.max(requestedFromMs, SITE_CONFIG.dataStartMs);
    const toMs = Math.min(requestedToMs, Date.now());
    if (toMs <= fromMs) {
      setStatus("error");
      setError("End time must be after the start time.");
      return;
    }
    setStatus("loading");
    setError(null);
    setLoadNote(
      toMs - fromMs > LARGE_RANGE_MS
        ? `Loading ${Math.round((toMs - fromMs) / 86_400_000)} days — a long period can take a while on a site connection.`
        : null,
    );
    try {
      const data = await fetchReadingsBetween(SITE_CONFIG.firebaseDataPath, fromMs, toMs);
      setFetched(data);
      setStatus("ready");
      setLoadNote(null);
    } catch (e) {
      setStatus("error");
      setLoadNote(null);
      setError(e instanceof Error ? e.message : "Could not load readings for that period.");
    }
  }, []);

  const runRange = (from: number, to: number) => {
    setFromLocal(toLocalInput(from));
    setToLocal(toLocalInput(to));
    void load(from, to);
  };

  /**
   * Drop the loaded period and go back to the session's own history.
   *
   * Filters are deliberately left alone: they have their own Clear, and a
   * button that silently reset both would undo work the operator did not ask
   * to undo.
   */
  const clearPeriod = () => {
    setFetched(null);
    setStatus("session");
    setError(null);
    setLoadNote(null);
    const now = Date.now();
    setFromLocal(toLocalInput(now - 24 * 3600_000));
    setToLocal(toLocalInput(now));
  };

  // Until a range is pulled, browse what the dashboard already holds — the panel
  // is useful the instant it opens rather than after a round trip.
  const allRows = useMemo<TrustedReading[]>(() => buildAllReadings(fetched ?? rawHistory), [fetched, rawHistory]);

  const rows = useMemo(() => filterTrustedHistory(allRows, filters), [allRows, filters]);
  const summary = useMemo(() => summarizeHistory(rows), [rows]);

  const changeFilters = (next: HistoryFilters) => setFilters(next);

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
              Reading History
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Every reading received, for any period — rejected ones marked with why
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
            onClear={clearPeriod}
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
              {loadNote ?? "Loading readings for the selected period…"}
            </p>
          ) : (
            <>
              <SummaryBar summary={summary} total={allRows.length} filters={filters} rows={rows} />
              <HistoryTable key={`${rows.length}:${rows[0]?.t ?? 0}`} rows={rows} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ period

function PeriodPicker({
  fromLocal,
  toLocal,
  onFromChange,
  onToChange,
  onRunRange,
  onRun,
  onClear,
  busy,
  usingSession,
}: {
  fromLocal: string;
  toLocal: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onRunRange: (from: number, to: number) => void;
  onRun: () => void;
  onClear: () => void;
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
              // "All data" is Infinity; load() clamps the start to dataStartMs.
              onRunRange(Number.isFinite(p.ms) ? to - p.ms : SITE_CONFIG.dataStartMs, to);
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
        {!usingSession && (
          <button
            type="button"
            onClick={() => {
              setDay("");
              onClear();
            }}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Clear
          </button>
        )}
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
          <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Readings</span>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Readings">
            {STATUSES.map((s) => {
              const active = filters.status === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...filters, status: s.value })}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? "border-primary-500 bg-primary-500 text-white"
                      : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

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

      {filters.status !== "trusted" &&
        (filters.alertLevels.length > 0 || filters.minLevelFt !== null || filters.maxLevelFt !== null) && (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Rejected readings have no level or band, so they are hidden while filtering by either.
          </p>
        )}

      {filters.fromHour !== null &&
        filters.toHour !== null &&
        filters.fromHour > filters.toHour && (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Window wraps past midnight — including {hourLabel(filters.fromHour)}–11:59 PM and 12:00 AM–
            {hourLabel(filters.toHour, "59")}.
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
          {hourLabel(h)}
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
          <span>No readings match the current filters.</span>
        ) : (
          <>
            <strong className="tabular-nums">{(summary.count + summary.rejectedCount).toLocaleString()}</strong>
            {isFilterActive(filters) && <> of {total.toLocaleString()}</>} reading
            {summary.count + summary.rejectedCount === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums">{summary.count.toLocaleString()} trusted</span>
            {summary.rejectedCount > 0 && (
              <>
                ,{" "}
                <span className="font-semibold tabular-nums text-critical-700 dark:text-critical-500">
                  {summary.rejectedCount.toLocaleString()} rejected
                </span>
              </>
            )}{" "}
            ·{" "}
            {summary.count > 0 && (
              <>
                <span className="tabular-nums">
                  {summary.minFt.toFixed(2)}–{summary.maxFt.toFixed(2)} ft
                </span>{" "}
                (median <span className="tabular-nums">{summary.medianFt.toFixed(2)}</span>) ·{" "}
              </>
            )}
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
                `reading-history-${new Date().toISOString().slice(0, 10)}`,
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
              `reading-history-${new Date().toISOString().slice(0, 10)}`,
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

/**
 * The filtered readings, 200 to a page.
 *
 * Every page is reachable directly (first / previous / page number / next /
 * last), so a month at 5-minute cadence is ~45 pages, not a long scroll, and
 * only one page's rows are ever in the DOM. The summary bar above still
 * counts and exports the whole filtered set, not just the page on screen.
 */
const PAGE_SIZE = 200;

function HistoryTable({ rows }: { rows: TrustedReading[] }) {
  // The caller keys this on the filtered set, so changing a filter remounts it
  // on page 1 rather than leaving it on a page that may no longer exist.
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const goTo = (p: number) => {
    setPage(Math.min(pageCount - 1, Math.max(0, p)));
    scrollRef.current?.scrollTo({ top: 0 });
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-lg bg-neutral-50 px-3 py-8 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
        Nothing to show. Widen the period or clear the filters.
      </p>
    );
  }

  const firstRow = page * PAGE_SIZE;
  const lastRow = Math.min(rows.length, firstRow + PAGE_SIZE);

  return (
    <>
      <Pager page={page} pageCount={pageCount} firstRow={firstRow} lastRow={lastRow} total={rows.length} onGoTo={goTo} />
      <div
        ref={scrollRef}
        className="h-[28rem] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
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
            {rows.slice(firstRow, lastRow).map((r) => (
              <tr key={r.t} className="whitespace-nowrap hover:bg-neutral-50 dark:hover:bg-neutral-700/40">
                <Td>{formatStamp(r.t, true)}</Td>
                <Td right>{Number.isFinite(r.distanceMm) ? `${Math.round(r.distanceMm)} mm` : "—"}</Td>
                <Td right strong={!r.fault}>
                  {r.fault ? "—" : r.waterLevelFt.toFixed(2)}
                </Td>
                <Td right>{r.fault ? "—" : r.waterLevelM.toFixed(2)}</Td>
                <Td right>{r.fault ? "—" : `${r.capacityPct.toFixed(2)}%`}</Td>
                <Td>{r.fault ? <RejectedBadge fault={r.fault} /> : <BandBadge level={r.alertLevel} />}</Td>
                <Td right>{r.temperatureC === null ? "—" : `${r.temperatureC.toFixed(1)}°`}</Td>
                <Td right>{r.batteryVoltage === null ? "—" : `${r.batteryVoltage.toFixed(2)} V`}</Td>
                <Td right>{r.signalStrength === null ? "—" : `${r.signalStrength}/31`}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageCount={pageCount} firstRow={firstRow} lastRow={lastRow} total={rows.length} onGoTo={goTo} />
    </>
  );
}

function Pager({
  page,
  pageCount,
  firstRow,
  lastRow,
  total,
  onGoTo,
}: {
  page: number;
  pageCount: number;
  firstRow: number;
  lastRow: number;
  total: number;
  onGoTo: (page: number) => void;
}) {
  const btn =
    "rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
        Rows {(firstRow + 1).toLocaleString()}–{lastRow.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} disabled={page === 0} onClick={() => onGoTo(0)} aria-label="First page">
          «
        </button>
        <button type="button" className={btn} disabled={page === 0} onClick={() => onGoTo(page - 1)}>
          ‹ Prev
        </button>
        <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          Page
          <select
            value={page}
            onChange={(e) => onGoTo(Number(e.target.value))}
            aria-label="Page"
            className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs tabular-nums text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          >
            {Array.from({ length: pageCount }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
          of {pageCount.toLocaleString()}
        </label>
        <button type="button" className={btn} disabled={page >= pageCount - 1} onClick={() => onGoTo(page + 1)}>
          Next ›
        </button>
        <button
          type="button"
          className={btn}
          disabled={page >= pageCount - 1}
          onClick={() => onGoTo(pageCount - 1)}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </div>
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

function RejectedBadge({ fault }: { fault: FaultCode }) {
  return (
    <span className="rounded bg-neutral-200 px-1.5 py-px text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
      Rejected · {FAULT_CODE_LABEL[fault]}
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
    hour12: true,
  });
}

/** 12-hour label for a whole hour, e.g. 0 → "12:00 AM", 13 → "1:00 PM". */
function hourLabel(h: number, minutes = "00"): string {
  return `${h % 12 === 0 ? 12 : h % 12}:${minutes} ${h < 12 ? "AM" : "PM"}`;
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalToMs(value: string): number {
  return new Date(value).getTime();
}
