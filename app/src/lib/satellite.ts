import { onValue, ref } from "firebase/database";
import { db } from "./firebase";

/**
 * Shapes written by the Cloud Functions in /functions (see main.py). Every
 * field the functions may leave out is optional here, because a job that has
 * never run, or that failed, leaves its node empty.
 */

export interface WeatherHour {
  t: number;
  kind: "past" | "forecast";
  rainMm: number | null;
  probPct: number | null;
  tempC: number | null;
  cond: string | null;
}

export interface WeatherDay {
  date: string;
  rainMm: number | null;
  probPct: number | null;
  maxC: number | null;
  minC: number | null;
  cond: string | null;
}

export interface WeatherSnapshot {
  updatedAt: number;
  source: string;
  current: {
    t: number | null;
    tempC: number | null;
    humidityPct: number | null;
    cond: string | null;
    rainProbPct: number | null;
    rainLastHourMm: number | null;
    rainLast24hMm: number | null;
  };
  hours: WeatherHour[];
  days: WeatherDay[];
  totals: { past24hMm: number | null; next24hMm: number | null; next72hMm: number | null };
}

export interface RainfallSnapshot {
  updatedAt: number;
  source: string;
  latestDataAt: number | null;
  lagHours?: number;
  /** [hourStartMs, mm] pairs, oldest first. */
  hours: [number, number][];
  totals: { h24?: number; h72?: number; d7?: number };
}

export interface AreaPoint {
  t: number;
  scene: string;
  km2: number;
  source: "S1" | "S2";
}

export interface ReservoirSnapshot {
  updatedAt: number;
  series: AreaPoint[];
  waterThresholdDb: number;
}

export interface SatelliteImage {
  t: number;
  scene: string;
  url: string;
  clear?: number;
}

export interface ImagerySnapshot {
  updatedAt: number;
  s1?: SatelliteImage;
  s2?: SatelliteImage;
}

export interface JobStatus {
  at: number;
  ok: boolean;
  detail: string;
}

export interface SiteFacts {
  catchmentKm2?: number;
  publishedCatchmentKm2?: number;
  reservoirMaxKm2?: number;
}

export interface SatelliteState {
  /** "unavailable" = the node could not be read (rules not deployed yet, or offline). */
  status: "loading" | "ready" | "unavailable";
  weather: WeatherSnapshot | null;
  rainfall: RainfallSnapshot | null;
  reservoir: ReservoirSnapshot | null;
  imagery: ImagerySnapshot | null;
  jobs: Record<string, JobStatus>;
  site: SiteFacts;
}

const NODES = ["weather", "rainfall", "reservoir", "imagery", "status"] as const;
// Only the small numbers from /satellite/config: the geometry there is tens of
// kilobytes the dashboard does not need.
const SITE_FIELDS = ["catchmentKm2", "publishedCatchmentKm2", "reservoirMaxKm2"] as const;

/** RTDB returns arrays with gaps as objects; normalise back to arrays. */
function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter((x) => x != null) as T[];
  if (v && typeof v === "object") return Object.values(v as Record<string, T>).filter((x) => x != null);
  return [];
}

export function subscribeToSatellite(onChange: (patch: Partial<SatelliteState>) => void): () => void {
  const unsubs: (() => void)[] = [];
  let failed = 0;
  let loaded = 0;
  const total = NODES.length + SITE_FIELDS.length;
  const settle = (ok: boolean) => {
    if (ok) loaded++;
    else failed++;
    if (loaded + failed === total) onChange({ status: loaded > 0 ? "ready" : "unavailable" });
  };

  for (const node of NODES) {
    let first = true;
    unsubs.push(
      onValue(
        ref(db, `satellite/${node}`),
        (snap) => {
          const v = snap.val();
          if (node === "status") onChange({ jobs: (v ?? {}) as Record<string, JobStatus> });
          else if (node === "weather") onChange({ weather: v ? { ...v, hours: asArray(v.hours), days: asArray(v.days) } : null });
          else if (node === "rainfall") onChange({ rainfall: v ? { ...v, hours: asArray(v.hours), totals: v.totals ?? {} } : null });
          else if (node === "reservoir") onChange({ reservoir: v ? { ...v, series: asArray(v.series) } : null });
          else onChange({ imagery: v ?? null });
          if (first) settle(true);
          first = false;
        },
        () => {
          if (first) settle(false);
          first = false;
        },
      ),
    );
  }

  const site: SiteFacts = {};
  for (const field of SITE_FIELDS) {
    let first = true;
    unsubs.push(
      onValue(
        ref(db, `satellite/config/${field}`),
        (snap) => {
          site[field] = snap.val() ?? undefined;
          onChange({ site: { ...site } });
          if (first) settle(true);
          first = false;
        },
        () => {
          if (first) settle(false);
          first = false;
        },
      ),
    );
  }

  return () => unsubs.forEach((u) => u());
}
