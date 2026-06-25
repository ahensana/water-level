import { useEffect, useId } from "react";
import { SITE_CONFIG } from "../config";
import type { ConnectionState, DerivedReading } from "../types";

interface SensorCardProps {
  open: boolean;
  onClose: () => void;
  reading: DerivedReading | null;
  connection: ConnectionState;
  loadState: "loading" | "ready" | "error";
}

export function SensorCard({ open, onClose, reading, connection, loadState }: SensorCardProps) {
  const headingId = useId();

  // Close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const ready = loadState !== "loading" && reading !== null;
  const isOnline = connection.deviceConnectivity === "online";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-lg rounded-xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-700">
          <div className="flex items-center gap-3">
            <h2 id={headingId} className="text-sm font-semibold text-neutral-900 dark:text-white">
              Sensor Monitoring
            </h2>
            {ready && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isOnline
                    ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500"
                    : "bg-critical-50 text-critical-700 dark:bg-critical-500/10 dark:text-critical-500"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-success-500" : "bg-critical-500"}`} />
                {isOnline ? "Online" : "Offline"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sensor monitoring"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          {!ready ? (
            <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Waiting for the first sensor reading…
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field
                  label="Sensor Health"
                  value={reading!.isSensorFault ? "Fault" : "Normal"}
                  tone={reading!.isSensorFault ? "critical" : "success"}
                />
                <Field
                  label="Connectivity"
                  value={connection.firebaseConnected ? "Connected" : "Disconnected"}
                  tone={connection.firebaseConnected ? "success" : "critical"}
                />
                <Field label="Valid Range" value={`${SITE_CONFIG.minValidDistanceM.toFixed(2)}–${SITE_CONFIG.maxValidDistanceM.toFixed(2)} m`} />
                <Field
                  label="Last Communication"
                  value={new Date(reading!.receivedAtMs).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                />
                <Field
                  label="Battery"
                  value={reading!.batteryVoltage !== null ? `${reading!.batteryVoltage.toFixed(2)} V` : "—"}
                  tone={reading!.batteryVoltage !== null && reading!.batteryVoltage < 3.5 ? "critical" : undefined}
                />
                <Field label="Signal" value={formatSignal(reading!.signalStrength)} />
              </dl>
              <p className="mt-4 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
                The device reports battery and signal about once an hour, so these update less
                often than the water level. A “—” simply means the most recent reading hasn’t
                refreshed them yet.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Formats a raw GSM CSQ value (0–31, per AT+CSQ) into a readable label with an
 * approximate dBm. 99 means "not detectable". Anything out of range renders "—".
 */
function formatSignal(csq: number | null): string {
  if (csq === null || csq === 99 || csq < 0 || csq > 31) return "—";
  const dbm = -113 + 2 * csq;
  return `${csq}/31 (${dbm} dBm)`;
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "critical";
}) {
  const toneClass =
    tone === "success"
      ? "text-success-600 dark:text-success-500"
      : tone === "critical"
        ? "text-critical-600 dark:text-critical-500"
        : "text-neutral-900 dark:text-white";

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}
