import { useEffect, useId, useState } from "react";
import { EDITABLE_SITE_CONFIG_DEFAULTS, type EditableSiteConfig } from "../config";
import type { SiteConfigSource } from "../hooks/useSiteConfig";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  config: EditableSiteConfig;
  source: SiteConfigSource;
  saving: boolean;
  saveError: string | null;
  onSave: (next: EditableSiteConfig) => Promise<void>;
}

export function SettingsPanel({
  open,
  onClose,
  config,
  source,
  saving,
  saveError,
  onSave,
}: SettingsPanelProps) {
  const [mountHeight, setMountHeight] = useState(String(config.sensorMountHeightM));
  const [warningPct, setWarningPct] = useState(String(config.warningThresholdPct));
  const [criticalPct, setCriticalPct] = useState(String(config.criticalThresholdPct));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  const headingId = useId();

  // Re-sync the form whenever the panel is (re)opened or the live config changes underneath it.
  useEffect(() => {
    if (!open) return;
    setMountHeight(String(config.sensorMountHeightM));
    setWarningPct(String(config.warningThresholdPct));
    setCriticalPct(String(config.criticalThresholdPct));
    setValidationError(null);
    setSavedJustNow(false);
  }, [open, config]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const mountHeightM = Number(mountHeight);
    const warningThresholdPct = Number(warningPct);
    const criticalThresholdPct = Number(criticalPct);

    if (!Number.isFinite(mountHeightM) || mountHeightM <= 0) {
      setValidationError("Mount height must be a positive number of metres.");
      return;
    }
    if (!Number.isFinite(warningThresholdPct) || warningThresholdPct < 0 || warningThresholdPct > 100) {
      setValidationError("Warning threshold must be between 0 and 100%.");
      return;
    }
    if (!Number.isFinite(criticalThresholdPct) || criticalThresholdPct < 0 || criticalThresholdPct > 100) {
      setValidationError("Critical threshold must be between 0 and 100%.");
      return;
    }
    if (criticalThresholdPct <= warningThresholdPct) {
      setValidationError("Critical threshold must be greater than the warning threshold.");
      return;
    }

    setValidationError(null);
    try {
      await onSave({ sensorMountHeightM: mountHeightM, warningThresholdPct, criticalThresholdPct });
      setSavedJustNow(true);
    } catch {
      // saveError is surfaced via props
    }
  };

  const handleResetDefaults = () => {
    setMountHeight(String(EDITABLE_SITE_CONFIG_DEFAULTS.sensorMountHeightM));
    setWarningPct(String(EDITABLE_SITE_CONFIG_DEFAULTS.warningThresholdPct));
    setCriticalPct(String(EDITABLE_SITE_CONFIG_DEFAULTS.criticalThresholdPct));
    setValidationError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 id={headingId} className="text-sm font-semibold text-neutral-900 dark:text-white">
            Site Configuration
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5">
          <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
            These values are stored in Firebase and shared with every dashboard viewing this
            site. They are not measured automatically — enter the real physical mounting height
            of the sensor above the empty vessel floor.
          </p>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Sensor mount height (m)
            </span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={mountHeight}
              onChange={(e) => setMountHeight(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            />
          </label>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Warning threshold (%)
              </span>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                required
                value={warningPct}
                onChange={(e) => setWarningPct(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Critical threshold (%)
              </span>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                required
                value={criticalPct}
                onChange={(e) => setCriticalPct(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
              />
            </label>
          </div>

          <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
            {source === "firebase"
              ? "Currently loaded from Firebase."
              : "No saved configuration found yet — showing built-in defaults."}
          </p>

          {validationError && (
            <p role="alert" className="mb-3 rounded-md bg-critical-50 px-3 py-2 text-xs text-critical-700 dark:bg-critical-500/10 dark:text-critical-400">
              {validationError}
            </p>
          )}
          {saveError && !validationError && (
            <p role="alert" className="mb-3 rounded-md bg-critical-50 px-3 py-2 text-xs text-critical-700 dark:bg-critical-500/10 dark:text-critical-400">
              {saveError}
            </p>
          )}
          {savedJustNow && !saving && !saveError && !validationError && (
            <p role="status" className="mb-3 rounded-md bg-success-50 px-3 py-2 text-xs text-success-700 dark:bg-success-500/10 dark:text-success-500">
              Settings saved.
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Reset to defaults
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
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
