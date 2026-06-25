/**
 * Site-specific configuration.
 *
 * `EDITABLE_SITE_CONFIG_DEFAULTS` covers the values an operator can change at
 * runtime from the in-app Settings panel (stored in Firebase at
 * `SITE_CONFIG.siteConfigPath`). They are used as the fallback until Firebase
 * returns a value, and as the values written back if a user resets to defaults.
 *
 * `SITE_CONFIG` covers everything else - values that require a code change
 * and a redeploy, not a runtime setting.
 */
export interface EditableSiteConfig {
  /** Vertical distance (m) from the sensor face to the empty-vessel bottom (0% level). */
  sensorMountHeightM: number;

  /** Water level (% of mount height) at which the Warning zone begins. */
  warningThresholdPct: number;

  /** Water level (% of mount height) at which the Critical zone begins. */
  criticalThresholdPct: number;
}

export const EDITABLE_SITE_CONFIG_DEFAULTS: EditableSiteConfig = {
  sensorMountHeightM: 3.0,
  warningThresholdPct: 70,
  criticalThresholdPct: 90,
};

export const SITE_CONFIG = {
  /** Minimum plausible distance reading (m). Anything below this is treated as a sensor fault. */
  minValidDistanceM: 0.02,

  /** Maximum plausible distance reading (m). Anything above this is treated as a sensor fault. */
  maxValidDistanceM: 4.0,

  /** Device is considered Offline if no reading has been received within this window (ms). */
  offlineTimeoutMs: 90_000,

  /** Firebase Realtime Database path for the live reading. */
  firebaseDataPath: "water_monitor",

  /** Firebase Realtime Database path for the editable site config (mount height, thresholds). */
  siteConfigPath: "site_config",
} as const;

export const ORG_INFO = {
  name: "Meghalaya Energy Corporation Limited",
  shortName: "MeECL",
  projectName: "Water Level Monitoring System",
  version: "v1.0.0",
  supportEmail: "support@meecl.in",
  supportPhone: "+91 364 222 2222",
} as const;
