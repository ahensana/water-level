/** Raw shape of a reading under `water_monitor/current` in Firebase Realtime Database. */
export interface RawWaterMonitorReading {
  /**
   * Distance from sensor to water surface, in MILLIMETRES. This is the field the
   * current firmware writes (A01NYUB ultrasonic reading). Preferred over the
   * legacy metre-based fields below.
   */
  distance?: number;
  /** Local BMP280 barometric pressure (hPa). Omitted entirely if no BMP280 was detected. */
  pressure?: number;
  /** BMP280 air temperature (degC). Omitted entirely if no BMP280 was detected. */
  temperature?: number;
  /**
   * Barometric height (m) relative to wherever the device was when it booted,
   * not an absolute altitude. Omitted entirely if no BMP280 was detected.
   */
  height?: number;
  /** Legacy: remote pressure (hPa) relayed from Node A over LoRa. No longer sent by the firmware. */
  remote_pressure?: number;
  /** Legacy: distance from sensor to water surface (m). */
  distance_m?: number;
  depth_cm?: number;
  depth_m?: number;
  status?: string;
  /**
   * Device time. The current firmware writes a numeric epoch-milliseconds value
   * (Firebase server timestamp). Older payloads used a human-readable clock string
   * such as "24-Jun-2026 16:32:00".
   */
  timestamp?: string | number;
  /** Legacy: a free-text label like "LIVE" or "Just now". Not a real timestamp. */
  updated_at?: string;
  /** Epoch milliseconds when the device recorded this reading. Preferred. */
  timestamp_ms?: number;
  /** Battery voltage (V) reported by the modem (AT+CBC). Published ~hourly. */
  battery_voltage?: number;
  /** GSM signal strength as raw CSQ value, 0–31 (AT+CSQ). Published ~hourly. */
  signal_strength?: number;
}

export type AlertLevel = "normal" | "warning" | "critical";

export type DeviceConnectivity = "online" | "offline" | "unknown";

/** Overall trust in the live derived reading. */
export type DataQuality = "good" | "degraded" | "fault";

export type FaultCode =
  | "invalid_distance"
  | "no_echo"
  | "blind_zone"
  | "out_of_range"
  | "spike"
  | "data_gap"
  | "stale"
  | "no_trusted_data"
  | "high_reject_rate"
  /** Baseline re-adopted after a sustained step — sensor may have moved. */
  | "resync";

/** Fully derived, display-ready reading after the QA pipeline. */
export interface DerivedReading {
  /** Trusted / median-smoothed distance (mm). */
  distanceMm: number;
  /** Latest raw distance before smoothing (mm), for diagnostics. */
  rawDistanceMm: number;
  /** Computed water level in metres (from calibrated feet). */
  waterLevelM: number;
  /** Staff-gauge water level in feet — matches field logbooks. */
  waterLevelFt: number;
  /** Water level as % of full capacity (3220 ft FRL). */
  capacityPct: number;
  /** Zone classification with hysteresis. */
  alertLevel: AlertLevel;
  /** True when no trusted level could be computed. */
  isSensorFault: boolean;
  /** True when the trusted sample is older than the offline timeout. */
  isStale: boolean;
  /** True when live value used a multi-sample median. */
  isSmoothed: boolean;
  faultCodes: FaultCode[];
  /** Device (or receive) time of the anchor sample (ms since epoch). */
  receivedAtMs: number;
  deviceReportedAt: string | null;
  batteryVoltage: number | null;
  signalStrength: number | null;
  pressureHpa: number | null;
  temperatureC: number | null;
  heightM: number | null;
  remotePressureHpa: number | null;
}

export interface SessionHistoryPoint {
  /** ms since epoch */
  t: number;
  waterLevelM: number;
  waterLevelFt: number;
  capacityPct: number;
  /** Trusted / smoothed sensor-to-surface distance in millimetres. */
  distanceMm: number;
  trusted: boolean;
  /** BMP280 air temperature (degC) at this sample, if published. */
  temperatureC: number | null;
  /** BMP280 barometric pressure (hPa) at this sample, if published. */
  pressureHpa: number | null;
  /** Modem battery voltage (V) at this sample, if published (~hourly). */
  batteryVoltage: number | null;
  /** GSM signal (raw CSQ, 0-31) at this sample, if published (~hourly). */
  signalStrength: number | null;
}

export interface ConnectionState {
  /** Whether the browser currently has a live Firebase socket connection. */
  firebaseConnected: boolean;
  /** Whether the device itself appears online, based on trusted-reading recency. */
  deviceConnectivity: DeviceConnectivity;
  /** Whether the browser reports it has a network connection at all. */
  browserOnline: boolean;
}

export interface MonitorQualityState {
  quality: DataQuality;
  faultCodes: FaultCode[];
  message: string | null;
  rejectRate: number;
  longestGapMs: number;
  liveSampleCount: number;
  /**
   * Device time of the newest reading RECEIVED, trusted or not (null if none).
   *
   * Distinct from `reading.receivedAtMs`, which is the newest reading the
   * filters accepted. When the two differ the device is still uploading but its
   * readings are being rejected — a very different fault from a node that has
   * gone silent, and the dashboard must not show the second as the first.
   */
  lastRawAtMs: number | null;
}
