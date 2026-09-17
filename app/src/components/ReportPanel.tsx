import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { SITE_CONFIG } from "../config";
import { useCalibrationTrim } from "../hooks/useCalibrationTrim";
import { useGaugeChecks } from "../hooks/useGaugeChecks";
import {
  clampOffset,
  clearCalibrationTrim,
  MAX_OFFSET_FT,
  setCalibrationTrim,
} from "../lib/calibration";
import { downloadCsv } from "../lib/csvExport";
import { fetchReadingsBetween } from "../lib/firebase";
import { addGaugeCheck, clearGaugeChecks, removeGaugeCheck } from "../lib/gaugeChecks";
import {
  buildIntervalReport,
  GRANULARITIES,
  intervalReportToCsv,
  RAW_GRANULARITY,
  verifyAgainstGauge,
  verificationToCsv,
  type IntervalReport,
  type VerificationSummary,
} from "../lib/intervalReport";
import { FAULT_CODE_LABEL } from "../lib/sensorQuality";
import type { RawWaterMonitorReading } from "../types";

interface ReportPanelProps {
  open: boolean;
  onClose: () => void;
}

type Status = "idle" | "loading" | "ready" | "error";

const PRESETS = [
  { label: "Last 6 h", ms: 6 * 3600_000 },
  { label: "Last 24 h", ms: 24 * 3600_000 },
  { label: "Last 3 days", ms: 3 * 86_400_000 },
  { label: "Last 7 days", ms: 7 * 86_400_000 },
  { label: "Last 30 days", ms: 30 * 86_400_000 },
] as const;

/** Beyond this a single pull gets heavy enough to hurt on a site connection. */
const MAX_RANGE_MS = 31 * 86_400_000;

/**
 * Rows rendered at once. At 30-second cadence a month of raw readings is ~89,000
 * rows, which no table should try to mount; the CSV export carries the full
 * record instead.
 */
const MAX_TABLE_ROWS = 2000;

export function ReportPanel({ open, onClose }: ReportPanelProps) {
  const headingId = useId();
  const trim = useCalibrationTrim();

  const [fromLocal, setFromLocal] = useState(() => toLocalInput(Date.now() - 24 * 3600_000));
  const [toLocal, setToLocal] = useState(() => toLocalInput(Date.now()));
  const [bucketMs, setBucketMs] = useState<number>(3_600_000);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [readings, setReadings] = useState<RawWaterMonitorReading[]>([]);
  const [loadedRange, setLoadedRange] = useState<{ from: number; to: number } | null>(null);

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
      setError(`Range is limited to ${MAX_RANGE_MS / 86_400_000} days per report.`);
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchReadingsBetween(SITE_CONFIG.firebaseDataPath, fromMs, toMs);
      setReadings(data);
      setLoadedRange({ from: fromMs, to: toMs });
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

  // Rebuilding on `trim.offsetFt` is the point of the panel: adjust the offset
  // and every level in the table moves with it, so the operator can see the
  // match against the register before committing.
  const report = useMemo<IntervalReport | null>(() => {
    if (!loadedRange || status !== "ready") return null;
    return buildIntervalReport(readings, loadedRange.from, loadedRange.to, bucketMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offset feeds distanceToWaterLevelFt
  }, [readings, loadedRange, status, bucketMs, trim.offsetFt]);

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
              Interval Report &amp; Gauge Verification
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Audit any period at any resolution, and verify the sensor against the manual register
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report"
            className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-4 py-4">
          <RangePicker
            fromLocal={fromLocal}
            toLocal={toLocal}
            bucketMs={bucketMs}
            onFromChange={setFromLocal}
            onToChange={setToLocal}
            onBucketChange={setBucketMs}
            onRunRange={runRange}
            onRun={() => void load(fromLocalToMs(fromLocal), fromLocalToMs(toLocal))}
            busy={status === "loading"}
          />

          <VerificationSection report={report} />

          {status === "error" && (
            <p className="rounded-lg bg-critical-50 px-3 py-2 text-sm text-critical-700 dark:bg-critical-500/10 dark:text-critical-400">
              {error}
            </p>
          )}

          {status === "loading" && (
            <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Loading readings for the selected period…
            </p>
          )}

          {status === "idle" && (
            <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Choose a period above to pull the full sensor record for it.
            </p>
          )}

          {report && <ReportBody report={report} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ range

function RangePicker({
  fromLocal,
  toLocal,
  bucketMs,
  onFromChange,
  onToChange,
  onBucketChange,
  onRunRange,
  onRun,
  busy,
}: {
  fromLocal: string;
  toLocal: string;
  bucketMs: number;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onBucketChange: (ms: number) => void;
  onRunRange: (from: number, to: number) => void;
  onRun: () => void;
  busy: boolean;
}) {
  const [day, setDay] = useState("");

  const runDay = (value: string) => {
    setDay(value);
    if (!value) return;
    const [y, m, d] = value.split("-").map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    onRunRange(start, start + 86_400_000 - 1);
  };

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
            onChange={(e) => runDay(e.target.value)}
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
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">Interval</span>
          <select
            value={bucketMs}
            onChange={(e) => onBucketChange(Number(e.target.value))}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          >
            {GRANULARITIES.map((g) => (
              <option key={g.ms} value={g.ms}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="rounded-md bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-50"
        >
          {busy ? "Loading…" : "Run report"}
        </button>
      </div>
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
        Changing the interval re-groups the loaded readings instantly — no re-fetch needed.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ verification

function VerificationSection({ report }: { report: IntervalReport | null }) {
  const trim = useCalibrationTrim();
  const checks = useGaugeChecks();
  const [atLocal, setAtLocal] = useState(() => toLocalInput(Date.now()));
  const [gaugeFt, setGaugeFt] = useState("");

  const summary = useMemo<VerificationSummary | null>(
    () => (report ? verifyAgainstGauge(report, checks, SITE_CONFIG.crossCheckToleranceFt) : null),
    [report, checks],
  );

  const outsideRange = report
    ? checks.filter((c) => c.atMs < report.fromMs || c.atMs > report.toMs).length
    : 0;

  const gaugeValue = Number.parseFloat(gaugeFt);
  const canAdd = Number.isFinite(gaugeValue) && Number.isFinite(fromLocalToMs(atLocal));

  const suggested =
    summary?.suggestedOffsetFt === null || summary?.suggestedOffsetFt === undefined
      ? null
      : clampOffset(trim.offsetFt + summary.suggestedOffsetFt);
  const suggestedExceedsCap =
    summary?.suggestedOffsetFt != null &&
    Math.abs(trim.offsetFt + summary.suggestedOffsetFt) > MAX_OFFSET_FT;

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Gauge verification &amp; calibration trim
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            trim.offsetFt === 0
              ? "bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
              : "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500"
          }`}
        >
          {trim.offsetFt === 0 ? "No trim applied" : `Trim ${signed(trim.offsetFt)} ft active`}
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
        Enter the manual staff-gauge readings you have, with the time each was taken. The sensor is
        compared against every one, and passes when the <strong>worst</strong> deviation stays within{" "}
        {SITE_CONFIG.crossCheckToleranceFt.toFixed(2)} ft. Readings are kept on this device, so you can keep
        adding to the register over time.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">Reading taken at</span>
          <input
            type="datetime-local"
            value={atLocal}
            onChange={(e) => setAtLocal(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="mb-1 block">Gauge reading (ft)</span>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={gaugeFt}
            placeholder="3198.38"
            onChange={(e) => setGaugeFt(e.target.value)}
            className="w-32 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm tabular-nums text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            addGaugeCheck(fromLocalToMs(atLocal), gaugeValue);
            setGaugeFt("");
          }}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          Add reading
        </button>
      </div>

      {checks.length === 0 && (
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          No manual readings entered yet. Add at least one to verify the sensor.
        </p>
      )}

      {checks.length > 0 && !report && (
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          {checks.length} reading{checks.length === 1 ? "" : "s"} saved. Run a report covering{" "}
          {checks.length === 1 ? "its" : "their"} time{checks.length === 1 ? "" : "s"} to compare.
        </p>
      )}

      {summary && checks.length > 0 && (
        <>
          <Verdict summary={summary} />

          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <Th>Reading taken</Th>
                  <Th right>Gauge</Th>
                  <Th right>Sensor</Th>
                  <Th right>Deviation</Th>
                  <Th>Status</Th>
                  <Th right>Samples</Th>
                  <Th right> </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                {summary.results.map((r) => {
                  const inTolerance =
                    r.deviationFt !== null && Math.abs(r.deviationFt) <= summary.toleranceFt;
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/40">
                      <Td>{formatStamp(r.atMs)}</Td>
                      <Td right>{r.gaugeFt.toFixed(2)}</Td>
                      <Td right>{r.sensorFt?.toFixed(2) ?? "—"}</Td>
                      <Td
                        right
                        strong
                        tone={r.suspectReason ? undefined : inTolerance ? "good" : "bad"}
                      >
                        {r.deviationFt === null
                          ? "—"
                          : `${signed(r.deviationFt)} ft / ${signed(r.deviationFt * 304.8, 0)} mm`}
                      </Td>
                      <Td>
                        {r.suspectReason ? (
                          <span title={r.suspectReason} className="text-neutral-400 dark:text-neutral-500">
                            Excluded
                          </span>
                        ) : inTolerance ? (
                          <span className="font-semibold text-success-600 dark:text-success-500">
                            Within {summary.toleranceFt.toFixed(2)} ft
                          </span>
                        ) : (
                          <span className="font-semibold text-critical-700 dark:text-critical-400">
                            Outside tolerance
                          </span>
                        )}
                      </Td>
                      <Td right>{r.sampleCount || "—"}</Td>
                      <Td right>
                        <button
                          type="button"
                          onClick={() => removeGaugeCheck(r.id)}
                          aria-label={`Remove reading from ${formatStamp(r.atMs)}`}
                          className="rounded px-1 text-neutral-400 transition hover:text-critical-600 dark:hover:text-critical-400"
                        >
                          ×
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {outsideRange > 0 && (
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              {outsideRange} reading{outsideRange === 1 ? "" : "s"} fall outside the loaded period and could
              not be matched. Widen the range above to include {outsideRange === 1 ? "it" : "them"}.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={suggested === null || suggestedExceedsCap || summary.usable.length === 0}
              onClick={() =>
                suggested !== null &&
                setCalibrationTrim(
                  suggested,
                  `Median of ${summary.usable.length} gauge reading${summary.usable.length === 1 ? "" : "s"}`,
                )
              }
              className="rounded-md bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-50"
            >
              {suggested === null ? "Apply offset" : `Apply offset ${signed(suggested)} ft`}
            </button>
            {trim.offsetFt !== 0 && (
              <button
                type="button"
                onClick={() => clearCalibrationTrim()}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                Reset trim
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `gauge-verification-${new Date().toISOString().slice(0, 10)}`,
                  verificationToCsv(summary),
                )
              }
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              Export verification CSV
            </button>
            <button
              type="button"
              onClick={() => clearGaugeChecks()}
              className="rounded-md px-2 py-1.5 text-xs font-medium text-neutral-400 transition hover:text-critical-600 dark:hover:text-critical-400"
            >
              Clear register
            </button>
          </div>

          {suggestedExceedsCap && (
            <p className="mt-1.5 text-xs text-critical-600 dark:text-critical-400">
              The correction needed exceeds ±{MAX_OFFSET_FT} ft of trim. A gap that large is a mounting or
              datum problem, not something to dial out — check the sensor before adjusting.
            </p>
          )}
        </>
      )}

      {trim.offsetFt !== 0 && trim.setAtMs && (
        <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
          Applied {new Date(trim.setAtMs).toLocaleString()}
          {trim.note && ` · ${trim.note}`} · fitted elevation {SITE_CONFIG.sensorElevationFt.toFixed(2)} ft →
          effective {(SITE_CONFIG.sensorElevationFt + trim.offsetFt).toFixed(2)} ft · stored on this device only
        </p>
      )}
    </div>
  );
}

function Verdict({ summary }: { summary: VerificationSummary }) {
  const notVerified = summary.usable.length === 0;
  const tone = notVerified
    ? "bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
    : summary.withinTolerance
      ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500"
      : "bg-critical-50 text-critical-700 dark:bg-critical-500/10 dark:text-critical-400";

  return (
    <div className={`mt-3 rounded-lg px-3 py-2 ${tone}`}>
      <p className="text-sm font-bold">
        {notVerified
          ? "Not verified — no usable comparison"
          : summary.withinTolerance
            ? `Sensor verified — worst deviation ${summary.maxAbsDeviationFt!.toFixed(2)} ft, within the ${summary.toleranceFt.toFixed(2)} ft limit`
            : `Out of tolerance — worst deviation ${summary.maxAbsDeviationFt!.toFixed(2)} ft exceeds the ${summary.toleranceFt.toFixed(2)} ft limit`}
      </p>
      {!notVerified && (
        <p className="mt-0.5 text-xs">
          {summary.usable.length} of {summary.results.length} reading
          {summary.results.length === 1 ? "" : "s"} used · median deviation{" "}
          {signed(summary.medianDeviationFt!)} ft ({signed(summary.medianDeviationFt! * 304.8, 0)} mm) ·
          suggested trim {signed(summary.suggestedOffsetFt!)} ft
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ report

function ReportBody({ report }: { report: IntervalReport }) {
  const faults = Object.entries(report.faultCounts).sort((a, b) => b[1] - a[1]);
  const granularityLabel =
    GRANULARITIES.find((g) => g.ms === report.bucketMs)?.label ?? `${report.bucketMs} ms`;
  const shown = report.buckets.slice(0, MAX_TABLE_ROWS);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {formatStamp(report.fromMs)} → {formatStamp(report.toMs)} · grouped by {granularityLabel.toLowerCase()}
        </p>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              `water-level-interval-${new Date(report.fromMs).toISOString().slice(0, 10)}`,
              intervalReportToCsv(report),
            )
          }
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          Export CSV ({report.buckets.length.toLocaleString()} rows)
        </button>
      </div>

      <Section title="Summary">
        <Grid>
          <Metric label="Readings received" value={report.totalSamples.toLocaleString()} />
          <Metric label="Reporting completeness" value={`${report.completenessPct.toFixed(0)}%`} />
          <Metric
            label="Rejected as invalid"
            value={`${report.rejectedSamples} (${report.totalSamples ? ((report.rejectedSamples / report.totalSamples) * 100).toFixed(1) : "0.0"}%)`}
          />
          <Metric label="Data gaps > 10 min" value={String(report.gaps.length)} />
          <Metric
            label="Suspect intervals"
            value={String(report.buckets.filter((b) => b.suspectReason).length)}
          />
          <Metric label="Level min" value={report.levelFt ? `${report.levelFt.min.toFixed(2)} ft` : "—"} />
          <Metric label="Level max" value={report.levelFt ? `${report.levelFt.max.toFixed(2)} ft` : "—"} />
          <Metric label="Level median" value={report.levelFt ? `${report.levelFt.median.toFixed(2)} ft` : "—"} />
          <Metric
            label="Net change"
            value={report.netChangeFt === null ? "—" : `${signed(report.netChangeFt)} ft`}
          />
          <Metric
            label="Air gap median"
            value={report.distanceMm ? `${Math.round(report.distanceMm.median)} mm` : "—"}
          />
        </Grid>
      </Section>

      <Section title="Device telemetry (min / median / max)">
        <Grid>
          <Metric label="Temperature" value={statText(report.temperatureC, "°C", 1)} />
          <Metric label="Pressure" value={statText(report.pressureHpa, "hPa", 1)} />
          <Metric label="Battery" value={statText(report.batteryV, "V", 2)} />
          <Metric label="Signal (CSQ)" value={statText(report.signalCsq, "/31", 0)} />
        </Grid>
      </Section>

      {faults.length > 0 && (
        <Section title="Rejected samples">
          <ul className="space-y-1 text-sm">
            {faults.map(([code, n]) => (
              <li key={code} className="flex justify-between gap-4">
                <span className="text-neutral-600 dark:text-neutral-300">
                  {FAULT_CODE_LABEL[code as keyof typeof FAULT_CODE_LABEL] ?? code}
                </span>
                <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">{n}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.gaps.length > 0 && (
        <Section title={`Data gaps (${report.gaps.length})`}>
          <ul className="space-y-1 text-sm">
            {report.gaps.slice(0, 12).map((g) => (
              <li key={g.fromMs} className="flex justify-between gap-4">
                <span className="text-neutral-600 dark:text-neutral-300">
                  {formatStamp(g.fromMs)} → {formatStamp(g.toMs)}
                </span>
                <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">
                  {formatDuration(g.toMs - g.fromMs)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Interval record (${report.buckets.length.toLocaleString()} rows)`}>
        {report.buckets.length > MAX_TABLE_ROWS && (
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            Showing the first {MAX_TABLE_ROWS.toLocaleString()} rows. Export the CSV for the full record, or
            pick a coarser interval.
          </p>
        )}
        <div className="max-h-96 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <Th>{report.bucketMs === RAW_GRANULARITY ? "Reading at" : "Interval start"}</Th>
                <Th right>Air gap</Th>
                <Th right>Level (ft)</Th>
                <Th right>Level (m)</Th>
                <Th right>Capacity</Th>
                <Th right>Samples</Th>
                <Th right>Rejected</Th>
                <Th right>Scatter</Th>
                <Th right>Temp</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {shown.map((h) => (
                <tr
                  key={h.startMs}
                  title={h.suspectReason ?? undefined}
                  className={
                    h.suspectReason
                      ? "bg-critical-50/60 dark:bg-critical-500/10"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-700/40"
                  }
                >
                  <Td>
                    <span className="flex items-center gap-1.5">
                      {formatStamp(h.startMs, report.bucketMs < 60_000)}
                      {h.suspectReason && (
                        <span className="rounded bg-critical-100 px-1 py-px text-[10px] font-semibold uppercase text-critical-700 dark:bg-critical-500/20 dark:text-critical-400">
                          Suspect
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td right>{h.distanceMm === null ? "—" : `${Math.round(h.distanceMm)} mm`}</Td>
                  <Td right strong tone={h.suspectReason ? "bad" : undefined}>
                    {h.waterLevelFt?.toFixed(2) ?? "—"}
                  </Td>
                  <Td right>{h.waterLevelM?.toFixed(2) ?? "—"}</Td>
                  <Td right>{h.capacityPct === null ? "—" : `${h.capacityPct.toFixed(2)}%`}</Td>
                  <Td right>{h.count}</Td>
                  <Td right tone={h.rejected > 0 ? "warn" : undefined}>
                    {h.rejected || "—"}
                  </Td>
                  <Td right tone={(h.spreadMm ?? 0) > 15 ? "warn" : undefined}>
                    {h.spreadMm === null ? "—" : `${h.spreadMm.toFixed(1)} mm`}
                  </Td>
                  <Td right>{h.temperatureC === null ? "—" : `${h.temperatureC.toFixed(1)}°`}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------- bits

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">{children}</dl>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-white">{value}</dd>
    </div>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th className={`px-2.5 py-2 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}

function Td({
  children,
  right,
  strong,
  tone,
}: {
  children: ReactNode;
  right?: boolean;
  strong?: boolean;
  tone?: "warn" | "bad" | "good";
}) {
  const toneClass =
    tone === "warn"
      ? "text-warning-700 dark:text-warning-500"
      : tone === "bad"
        ? "text-critical-700 dark:text-critical-400"
        : tone === "good"
          ? "text-success-700 dark:text-success-500"
          : "";
  return (
    <td
      className={`px-2.5 py-1.5 tabular-nums ${right ? "text-right" : "text-left"} ${
        strong ? "font-semibold text-neutral-900 dark:text-white" : "text-neutral-600 dark:text-neutral-300"
      } ${toneClass}`}
    >
      {children}
    </td>
  );
}

function statText(s: { min: number; median: number; max: number } | null, unit: string, dp: number): string {
  if (!s) return "—";
  return `${s.min.toFixed(dp)} / ${s.median.toFixed(dp)} / ${s.max.toFixed(dp)} ${unit}`;
}

function signed(v: number, dp = 2): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}`;
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

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours < 24 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}

/** `datetime-local` needs a local-clock string, not an ISO/UTC one. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalToMs(value: string): number {
  return new Date(value).getTime();
}
