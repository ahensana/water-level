import type { ReactNode } from "react";
import clsx from "clsx";
import type { JobStatus } from "../../lib/satellite";
import { fmtAgo, fmtTime } from "./format";

/** A label and one number, the dashboard's usual stat block. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-0.5 whitespace-nowrap text-base font-semibold tabular-nums text-neutral-900 sm:text-lg dark:text-neutral-100">{value}</div>
      {sub && <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{sub}</div>}
    </div>
  );
}

/** Swatch + text legend; text stays in ink, the swatch carries the colour. */
export function LegendItem({ color, label, shape = "bar" }: { color: string; label: string; shape?: "bar" | "dot" | "square" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
      <span
        aria-hidden="true"
        className={clsx("inline-block", shape === "bar" ? "h-3 w-2 rounded-t-sm" : shape === "dot" ? "h-2.5 w-2.5 rounded-full" : "h-2.5 w-2.5")}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
      {children}
    </p>
  );
}

/** Explains an empty card: never run yet, or the last run failed. */
export function NotYet({ job, what }: { job?: JobStatus; what: string }) {
  if (job && !job.ok) {
    return (
      <EmptyState>
        The {what} job failed on {fmtTime(job.at)}.
        <span className="mt-1 block text-xs">{job.detail}</span>
      </EmptyState>
    );
  }
  return <EmptyState>No {what} yet. This fills in after the satellite functions are deployed and run once.</EmptyState>;
}

/** Small "updated X ago" line, warning-coloured when the data is older than expected. */
export function Freshness({ at, now, staleAfterH, source }: { at: number; now: number; staleAfterH: number; source: string }) {
  const stale = now - at > staleAfterH * 3_600_000;
  return (
    <span className={clsx("text-xs font-medium", stale ? "text-warning-600 dark:text-warning-500" : "text-neutral-400 dark:text-neutral-500")}>
      {source} · {stale ? "stale, " : ""}updated {fmtAgo(at, now)}
    </span>
  );
}

export function Attribution({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11px] leading-snug text-neutral-400 dark:text-neutral-500">{children}</p>;
}
