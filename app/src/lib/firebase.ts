import { initializeApp } from "firebase/app";
import {
  getDatabase,
  goOffline,
  goOnline,
  limitToLast,
  onValue,
  orderByKey,
  query,
  ref,
  set,
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

/** Subscribes to an arbitrary path, e.g. the editable site config node. */
export function subscribeToPath<T>(
  path: string,
  onData: (data: T | null) => void,
  onError: (error: Error) => void,
): () => void {
  const dataRef = ref(db, path);
  return onValue(
    dataRef,
    (snapshot) => onData(snapshot.val()),
    (error) => onError(error as Error),
  );
}

/** Overwrites an arbitrary path, e.g. saving edited site config. */
export async function writeToPath(path: string, value: unknown): Promise<void> {
  await set(ref(db, path), value);
}
