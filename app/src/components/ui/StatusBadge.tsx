import clsx from "clsx";
import type { AlertLevel } from "../../types";

const STYLES: Record<AlertLevel, string> = {
  normal:
    "bg-success-50 text-success-700 ring-1 ring-inset ring-success-100 dark:bg-success-500/10 dark:text-success-500 dark:ring-success-500/20",
  warning:
    "bg-warning-50 text-warning-700 ring-1 ring-inset ring-warning-100 dark:bg-warning-500/10 dark:text-warning-500 dark:ring-warning-500/20",
  critical:
    "bg-critical-50 text-critical-700 ring-1 ring-inset ring-critical-100 dark:bg-critical-500/10 dark:text-critical-500 dark:ring-critical-500/20",
};

const DOT_STYLES: Record<AlertLevel, string> = {
  normal: "bg-success-500",
  warning: "bg-warning-500",
  critical: "bg-critical-500",
};

interface StatusBadgeProps {
  level: AlertLevel;
  label: string;
  pulse?: boolean;
}

export function StatusBadge({ level, label, pulse = false }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        STYLES[level],
      )}
    >
      <span className={clsx("relative inline-flex h-1.5 w-1.5 rounded-full", DOT_STYLES[level])}>
        {pulse && (
          <span
            className={clsx("live-pulse absolute inline-flex h-1.5 w-1.5 rounded-full", DOT_STYLES[level])}
          />
        )}
      </span>
      {label}
    </span>
  );
}
