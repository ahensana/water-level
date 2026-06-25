/** Raw shape of the `water_monitor` node in Firebase Realtime Database. */
export interface RawWaterMonitorReading {
  /** Distance from sensor to water surface (m). Current field written by the firmware. */
  distance_m?: number;
  depth_cm?: number;
  depth_m?: number;
  status?: string;
  /**
   * Human-readable device clock string from the SIM800 network time,
   * e.g. "24-Jun-2026 16:32:00". Written by the current firmware.
   */
  timestamp?: string;
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

/** Fully derived, display-ready reading computed from the raw Firebase payload. */
export interface DerivedReading {
  /** Distance from sensor to water surface (m), as reported by the sensor. */
  distanceM: number;
  /** Computed water level = mount height - distance (m), clamped to [0, mountHeight]. */
  waterLevelM: number;
  /** Water level as a percentage of the sensor mount height. */
  capacityPct: number;
  /** Zone classification derived from capacityPct against configured thresholds. */
  alertLevel: AlertLevel;
  /** True if the raw distance reading is outside the physically valid range. */
  isSensorFault: boolean;
  /** Timestamp (client-side, ms since epoch) when this reading was received. */
  receivedAtMs: number;
  /** Raw device timestamp/updated_at string supplied by the device, if any. */
  deviceReportedAt: string | null;
  /** Battery voltage (V) from the device, or null if not reported in this reading. */
  batteryVoltage: number | null;
  /** GSM signal strength (raw CSQ 0–31), or null if not reported in this reading. */
  signalStrength: number | null;
}

export interface SessionHistoryPoint {
  /** ms since epoch */
  t: number;
  waterLevelM: number;
  capacityPct: number;
  distanceM: number;
}

export interface ConnectionState {
  /** Whether the browser currently has a live Firebase socket connection. */
  firebaseConnected: boolean;
  /** Whether the device itself appears online, based on reading recency. */
  deviceConnectivity: DeviceConnectivity;
  /** Whether the browser reports it has a network connection at all. */
  browserOnline: boolean;
}
