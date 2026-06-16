import { SITE_CONFIG, type EditableSiteConfig } from "../config";
import type { ConnectionState, DerivedReading } from "../types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { ListSkeleton } from "./Skeletons";

interface SensorCardProps {
  reading: DerivedReading | null;
  connection: ConnectionState;
  loadState: "loading" | "ready" | "error";
  siteConfig: EditableSiteConfig;
}

export function SensorCard({ reading, connection, loadState, siteConfig }: SensorCardProps) {
  if (loadState === "loading" || !reading) {
    return <ListSkeleton rows={4} />;
  }

  const isOnline = connection.deviceConnectivity === "online";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sensor Monitoring</CardTitle>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            isOnline
              ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500"
              : "bg-critical-50 text-critical-700 dark:bg-critical-500/10 dark:text-critical-500"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-success-500" : "bg-critical-500"}`} />
          {isOnline ? "Online" : "Offline"}
        </span>
      </CardHeader>
      <CardBody>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Device ID" value="ESP32-WL-01" />
          <Field
            label="Sensor Health"
            value={reading.isSensorFault ? "Fault" : "Normal"}
            tone={reading.isSensorFault ? "critical" : "success"}
          />
          <Field
            label="Connectivity"
            value={connection.firebaseConnected ? "Connected" : "Disconnected"}
            tone={connection.firebaseConnected ? "success" : "critical"}
          />
          <Field label="Mount Height" value={`${siteConfig.sensorMountHeightM.toFixed(2)} m`} />
          <Field label="Valid Range" value={`${SITE_CONFIG.minValidDistanceM.toFixed(2)}–${SITE_CONFIG.maxValidDistanceM.toFixed(2)} m`} />
          <Field
            label="Last Communication"
            value={new Date(reading.receivedAtMs).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          />
        </dl>
        <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
          Battery level, signal strength, firmware version and ambient temperature are not yet
          published by this device and are omitted rather than estimated.
        </p>
      </CardBody>
    </Card>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "critical";
}) {
  const toneClass =
    tone === "success"
      ? "text-success-600 dark:text-success-500"
      : tone === "critical"
        ? "text-critical-600 dark:text-critical-500"
        : "text-neutral-900 dark:text-white";

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}
