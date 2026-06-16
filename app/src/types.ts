/** Raw shape of the `water_monitor` node in Firebase Realtime Database. */
export interface RawWaterMonitorReading {
  depth_cm?: number;
  depth_m?: number;
  status?: string;
  /** Legacy: a free-text label like "LIVE" or "Just now". Not a real timestamp. */
  updated_at?: string;
  /** Epoch milliseconds when the device recorded this reading. Preferred. */
  timestamp_ms?: number;
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
  /** Raw "updated_at" string supplied by the device, if any. */
  deviceReportedAt: string | null;
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
