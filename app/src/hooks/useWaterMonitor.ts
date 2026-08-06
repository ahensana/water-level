import { useEffect, useMemo, useRef, useState } from "react";
import { SITE_CONFIG } from "../config";
import {
  subscribeToConnectionState,
  subscribeToHistory,
  subscribeToWaterMonitor,
} from "../lib/firebase";
import { processMonitorPipeline } from "../lib/sensorQuality";
import type {
  AlertLevel,
  ConnectionState,
  DerivedReading,
  MonitorQualityState,
  RawWaterMonitorReading,
  SessionHistoryPoint,
} from "../types";

/**
 * How many of the most recent server-stored readings to load for the trend
 * chart. The firmware POSTs one keyed child per reading (~every 30s), so this
 * caps the fetch: 5000 readings ≈ the last ~40 hours of continuous operation.
 */
const HISTORY_LIMIT = 5000;

export type LoadState = "loading" | "ready" | "error";

export interface WaterMonitorState {
  loadState: LoadState;
  errorMessage: string | null;
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  connection: ConnectionState;
  quality: MonitorQualityState;
}

export function useWaterMonitor(): WaterMonitorState {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawData, setRawData] = useState<{ data: RawWaterMonitorReading; receivedAtMs: number } | null>(
    null,
  );
  const [rawHistory, setRawHistory] = useState<RawWaterMonitorReading[]>([]);
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [now, setNow] = useState(() => Date.now());
  const previousAlertRef = useRef<AlertLevel | null>(null);

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

    const unsubscribeHistory = subscribeToHistory(
      SITE_CONFIG.firebaseDataPath,
      HISTORY_LIMIT,
      (readings) => setRawHistory(readings.map((r) => r.value)),
      () => {
        // History is non-critical; swallow errors rather than blanking the UI.
      },
    );

    const unsubscribeConn = subscribeToConnectionState(setFirebaseConnected);

    return () => {
      unsubscribeData();
      unsubscribeHistory();
      unsubscribeConn();
    };
  }, []);

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

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const pipeline = useMemo(() => {
    return processMonitorPipeline(
      rawHistory,
      rawData?.data ?? null,
      rawData?.receivedAtMs ?? Date.now(),
      previousAlertRef.current,
    );
    // `now` re-evaluates staleness every second without waiting for a new push.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional tick
  }, [rawHistory, rawData, now]);

  useEffect(() => {
    if (pipeline.reading) {
      previousAlertRef.current = pipeline.reading.alertLevel;
    }
  }, [pipeline.reading]);

  const reading = pipeline.reading;
  const history = pipeline.history;
  const quality: MonitorQualityState = pipeline.report;

  const deviceConnectivity =
    reading == null || reading.isSensorFault
      ? "unknown"
      : now - reading.receivedAtMs > SITE_CONFIG.offlineTimeoutMs || reading.isStale
        ? "offline"
        : "online";

  return {
    loadState,
    errorMessage,
    reading,
    history,
    quality,
    connection: {
      firebaseConnected,
      browserOnline,
      deviceConnectivity,
    },
  };
}
