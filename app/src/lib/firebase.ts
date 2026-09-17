import { initializeApp } from "firebase/app";
import {
  endAt,
  get,
  getDatabase,
  goOffline,
  goOnline,
  limitToLast,
  onValue,
  orderByKey,
  query,
  ref,
  startAt,
} from "firebase/database";
import { onValue as onConnectedValue } from "firebase/database";
import type { RawWaterMonitorReading } from "../types";

// Public client config (safe to expose - access is governed by Firebase Realtime
// Database security rules, not by hiding these identifiers).
const firebaseConfig = {
  apiKey: "AIzaSyAO9c2skhrD9E44H1_vQnWbvGx-OEmJztA",
  authDomain: "water-level-ae453.firebaseapp.com",
  databaseURL: "https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "water-level-ae453",
  storageBucket: "water-level-ae453.firebasestorage.app",
  messagingSenderId: "315746351135",
  appId: "1:315746351135:web:afb27d3880cdc0ddc3bd2a",
  measurementId: "G-LMSQ36S4KY",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

/**
 * Subscribes to the latest reading.
 *
 * The device POSTs each reading, so Firebase stores them as push-keyed children
 * under `path` rather than overwriting a single record. Push keys are
 * chronologically sortable, so the last child (orderByKey + limitToLast(1)) is
 * always the newest reading. We unwrap it and hand the plain reading object to
 * the caller, so the rest of the app stays agnostic of the storage shape.
 */
export function subscribeToWaterMonitor(
  path: string,
  onData: (data: RawWaterMonitorReading | null) => void,
  onError: (error: Error) => void,
): () => void {
  const latestQuery = query(ref(db, path), orderByKey(), limitToLast(1));
  return onValue(
    latestQuery,
    (snapshot) => {
      let latest: RawWaterMonitorReading | null = null;
      snapshot.forEach((child) => {
        latest = child.val() as RawWaterMonitorReading;
      });
      onData(latest);
    },
    (error) => onError(error as Error),
  );
}

/**
 * Subscribes to the most recent `max` readings (oldest-first) for the trend
 * chart. Each child is a separate POSTed reading, giving real server-side
 * history that survives refreshes and is shared across devices.
 */
export function subscribeToHistory(
  path: string,
  max: number,
  onData: (readings: { key: string; value: RawWaterMonitorReading }[]) => void,
  onError: (error: Error) => void,
): () => void {
  const historyQuery = query(ref(db, path), orderByKey(), limitToLast(max));
  return onValue(
    historyQuery,
    (snapshot) => {
      const readings: { key: string; value: RawWaterMonitorReading }[] = [];
      snapshot.forEach((child) => {
        readings.push({ key: child.key as string, value: child.val() as RawWaterMonitorReading });
      });
      onData(readings);
    },
    (error) => onError(error as Error),
  );
}

/**
 * Character set Firebase uses to encode push IDs, ordered so that lexical sort
 * of the key matches chronological order.
 */
const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

/**
 * The 8-character timestamp prefix Firebase would generate for a push key at
 * `ms`. Push IDs begin with the write time encoded in base-64 over PUSH_CHARS,
 * which is why keys sort chronologically — and why we can range-query by time
 * without maintaining a separate index on the `timestamp` field.
 */
function pushKeyPrefixForTime(ms: number): string {
  let remaining = Math.max(0, Math.floor(ms));
  const chars = new Array<string>(8);
  for (let i = 7; i >= 0; i--) {
    chars[i] = PUSH_CHARS.charAt(remaining % 64);
    remaining = Math.floor(remaining / 64);
  }
  return chars.join("");
}

/**
 * One-shot fetch of every reading written between two instants.
 *
 * The live subscription only carries a rolling window, which is enough to drive
 * the dashboard but not to audit an arbitrary past interval against the manual
 * register. This pulls exactly the requested span on demand instead.
 *
 * The key range is padded because a push key encodes *server write* time while
 * the reading carries its own device `timestamp`; the two can differ by the
 * upload latency, so a tight range would clip readings at both ends. Callers
 * filter to the exact window by device time afterwards.
 */
export async function fetchReadingsBetween(
  path: string,
  fromMs: number,
  toMs: number,
): Promise<RawWaterMonitorReading[]> {
  const PAD_MS = 15 * 60 * 1000;
  const rangeQuery = query(
    ref(db, path),
    orderByKey(),
    startAt(pushKeyPrefixForTime(fromMs - PAD_MS)),
    // Sorts after every 20-character key sharing this prefix.
    endAt(`${pushKeyPrefixForTime(toMs + PAD_MS)}\uf8ff`),
  );
  const snapshot = await get(rangeQuery);
  const readings: RawWaterMonitorReading[] = [];
  snapshot.forEach((child) => {
    readings.push(child.val() as RawWaterMonitorReading);
  });
  return readings;
}

/** Tracks the special `.info/connected` node to know if our socket is live. */
export function subscribeToConnectionState(onChange: (connected: boolean) => void): () => void {
  const connectedRef = ref(db, ".info/connected");
  return onConnectedValue(connectedRef, (snapshot) => {
    onChange(snapshot.val() === true);
  });
}

export function forceReconnect(): void {
  goOffline(db);
  goOnline(db);
}
