/** Raw shape of a reading under `water_monitor/current` in Firebase Realtime Database. */
export interface RawWaterMonitorReading {
  /**
   * Distance from sensor to water surface, in CENTIMETRES. This is the field the
   * current firmware writes (ultrasonic reading). Preferred over the legacy
   * metre-based fields below.
   */
  distance?: number;
  /** Local BMP280 barometric pressure (hPa) at the gateway node. Current firmware. */
  pressure?: number;
  /** Remote pressure (hPa) relayed from Node A over LoRa. May be absent / -1 if no remote data. */
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
  /** Local barometric pressure (hPa) at the gateway node, or null if not reported. */
  pressureHpa: number | null;
  /** Remote pressure (hPa) relayed from Node A over LoRa, or null if not reported. */
  remotePressureHpa: number | null;
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
