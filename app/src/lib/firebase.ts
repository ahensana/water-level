import { initializeApp } from "firebase/app";
import { getDatabase, goOffline, goOnline, onValue, ref, set } from "firebase/database";
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

export function subscribeToWaterMonitor(
  path: string,
  onData: (data: RawWaterMonitorReading | null) => void,
  onError: (error: Error) => void,
): () => void {
  const dataRef = ref(db, path);
  return onValue(
    dataRef,
    (snapshot) => onData(snapshot.val()),
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
