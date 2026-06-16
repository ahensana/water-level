import { useEffect, useMemo, useState } from "react";
import { SITE_CONFIG, type EditableSiteConfig } from "../config";
import { subscribeToConnectionState, subscribeToWaterMonitor } from "../lib/firebase";
import { appendSessionHistory, loadSessionHistory } from "../lib/sessionHistory";
import { deriveReading } from "../lib/waterLevel";
import type { ConnectionState, DerivedReading, RawWaterMonitorReading, SessionHistoryPoint } from "../types";

export type LoadState = "loading" | "ready" | "error";

export interface WaterMonitorState {
  loadState: LoadState;
  errorMessage: string | null;
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  connection: ConnectionState;
}

/**
 * `siteConfig` is passed in (from useSiteConfig) rather than read internally,
 * so the displayed reading recomputes immediately whenever an operator edits
 * the mount height or alert thresholds - without waiting for a new sensor push.
 */
export function useWaterMonitor(siteConfig: EditableSiteConfig): WaterMonitorState {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawData, setRawData] = useState<{ data: RawWaterMonitorReading; receivedAtMs: number } | null>(
    null,
  );
  const [history, setHistory] = useState<SessionHistoryPoint[]>(() => loadSessionHistory());
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const unsubscribeData = subscribeToWaterMonitor(
      SITE_CONFIG.firebaseDataPath,
      (data) => {
        if (!data) {
          setLoadState("error");
          setErrorMessage("No data found at the configured Firebase path.");
          return;
        }
        setRawData({ data, receivedAtMs: Date.now() });
        setLoadState("ready");
        setErrorMessage(null);
      },
      (error) => {
        setLoadState("error");
        setErrorMessage(error.message || "Failed to read from Firebase.");
      },
    );

    const unsubscribeConn = subscribeToConnectionState(setFirebaseConnected);

    return () => {
      unsubscribeData();
      unsubscribeConn();
    };
  }, []);

  // Track browser-level connectivity (airplane mode, wifi loss, etc).
  useEffect(() => {
    const goOnline = () => setBrowserOnline(true);
    const goOffline = () => setBrowserOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Tick every second so "device offline due to staleness" / "last updated Xs ago" stay live.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Recomputed whenever a new reading arrives OR the operator edits site config.
  const reading = useMemo(() => {
    if (!rawData) return null;
    return deriveReading(rawData.data, rawData.receivedAtMs, siteConfig);
  }, [rawData, siteConfig]);

  // Append to session history only when a genuinely new reading arrives.
  useEffect(() => {
    if (!reading) return;
    setHistory((prev) => appendSessionHistory(prev, reading));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData]);

  const deviceConnectivity =
    reading == null
      ? "unknown"
      : now - reading.receivedAtMs > SITE_CONFIG.offlineTimeoutMs
        ? "offline"
        : "online";

  return {
    loadState,
    errorMessage,
    reading,
    history,
    connection: {
      firebaseConnected,
      browserOnline,
      deviceConnectivity,
    },
  };
}
