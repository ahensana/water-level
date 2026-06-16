import { useEffect, useState } from "react";
import { EDITABLE_SITE_CONFIG_DEFAULTS, SITE_CONFIG, type EditableSiteConfig } from "../config";
import { subscribeToPath, writeToPath } from "../lib/firebase";

export type SiteConfigSource = "firebase" | "default";

export interface UseSiteConfigResult {
  config: EditableSiteConfig;
  /** "firebase" once a value has been read from the database, "default" while falling back. */
  source: SiteConfigSource;
  saving: boolean;
  saveError: string | null;
  save: (next: EditableSiteConfig) => Promise<void>;
}

/**
 * Live site configuration (sensor mount height, alert thresholds), editable
 * by operators at runtime and shared across every browser via Firebase at
 * `SITE_CONFIG.siteConfigPath`. Falls back to EDITABLE_SITE_CONFIG_DEFAULTS
 * until Firebase has a value (e.g. first run, before anyone has saved).
 */
export function useSiteConfig(): UseSiteConfigResult {
  const [config, setConfig] = useState<EditableSiteConfig>(EDITABLE_SITE_CONFIG_DEFAULTS);
  const [source, setSource] = useState<SiteConfigSource>("default");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToPath<Partial<EditableSiteConfig>>(
      SITE_CONFIG.siteConfigPath,
      (data) => {
        if (!data) {
          setSource("default");
          return;
        }
        setConfig({
          sensorMountHeightM:
            typeof data.sensorMountHeightM === "number"
              ? data.sensorMountHeightM
              : EDITABLE_SITE_CONFIG_DEFAULTS.sensorMountHeightM,
          warningThresholdPct:
            typeof data.warningThresholdPct === "number"
              ? data.warningThresholdPct
              : EDITABLE_SITE_CONFIG_DEFAULTS.warningThresholdPct,
          criticalThresholdPct:
            typeof data.criticalThresholdPct === "number"
              ? data.criticalThresholdPct
              : EDITABLE_SITE_CONFIG_DEFAULTS.criticalThresholdPct,
        });
        setSource("firebase");
      },
      () => {
        setSource("default");
      },
    );
    return unsubscribe;
  }, []);

  const save = async (next: EditableSiteConfig) => {
    setSaving(true);
    setSaveError(null);
    try {
      await writeToPath(SITE_CONFIG.siteConfigPath, next);
      // Optimistically apply locally; the Firebase listener above will confirm it.
      setConfig(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save settings.");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return { config, source, saving, saveError, save };
}
