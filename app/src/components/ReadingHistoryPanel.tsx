import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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

export function ReadingHistoryPanel({ open, onClose, sessionHistory }: ReadingHistoryPanelProps) {
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
  const allRows = useMemo<TrustedReading[]>(() => {
    if (fetched) return buildTrustedHistory(fetched);
    return annotateSessionHistory(sessionHistory);
  }, [fetched, sessionHistory]);

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

/**
 * Every filtered reading is in the table, but only the rows near the viewport
 * are mounted.
 *
 * The table used to page 300 rows at a time behind a "Show more" button, which
 * made "how many readings were below 3200 ft in August" a clicking exercise.
 * Mounting them all instead is not an option either: a month at 30-second
 * cadence is ~89,000 rows, and eleven cells each is enough DOM to freeze the
 * tab. Windowing gives the honest answer — the scrollbar spans the whole
 * record — at the cost of every row having the same height, which is why the
 * cells below are single-line.
 */
const ROW_HEIGHT_PX = 30; // first-paint estimate; the real height is measured
const VIEWPORT_PX = 448; // matches the h-[28rem] container
const OVERSCAN_ROWS = 12;

function HistoryTable({ rows }: { rows: TrustedReading[] }) {
  // Scroll position is this component's only state, and the caller keys it on
  // the filtered set: narrowing a filter remounts the table at the top rather
  // than leaving the view parked in rows that no longer exist.
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * Row height is measured from the first rendered row, not assumed.
   *
   * The spacer rows above and below the window are sized in pixels, so if the
   * assumed height is off by even a pixel the error compounds — a few hundred
   * rows in, the scrollbar and the rows disagree and the last readings become
   * unreachable. Cell padding, the row border and the browser's font settings
   * all move that number, so it is read from the DOM once and corrected if the
   * page is zoomed. The constant is only the first-paint estimate.
   */
  const [rowHeightPx, setRowHeightPx] = useState(ROW_HEIGHT_PX);
  const measureRow = useCallback((el: HTMLTableRowElement | null) => {
    if (!el) return;
    const measured = el.getBoundingClientRect().height;
    if (measured > 0) {
      setRowHeightPx((prev) => (Math.abs(prev - measured) > 0.5 ? measured : prev));
    }
  }, []);

  // The container height is fixed below, so the viewport needs no measuring.
  const viewportPx = VIEWPORT_PX;

  if (rows.length === 0) {
    return (
      <p className="rounded-lg bg-neutral-50 px-3 py-8 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
        Nothing to show. Widen the period or clear the filters.
      </p>
    );
  }

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeightPx) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    rows.length,
    firstRow + Math.ceil(viewportPx / rowHeightPx) + OVERSCAN_ROWS * 2,
  );
  const padTopPx = firstRow * rowHeightPx;
  const padBottomPx = (rows.length - lastRow) * rowHeightPx;

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
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
            {padTopPx > 0 && <tr style={{ height: padTopPx }} aria-hidden="true" />}
            {rows.slice(firstRow, lastRow).map((r, i) => (
              <tr
                key={r.t}
                ref={i === 0 ? measureRow : undefined}
                className="whitespace-nowrap hover:bg-neutral-50 dark:hover:bg-neutral-700/40"
              >
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
            {padBottomPx > 0 && <tr style={{ height: padBottomPx }} aria-hidden="true" />}
          </tbody>
        </table>
      </div>
      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
        Showing all {rows.length.toLocaleString()} rows — scroll the table
      </p>
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
