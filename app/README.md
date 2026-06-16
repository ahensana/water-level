# Water Level Monitoring System

Real-time water level dashboard for a single ESP32 + ultrasonic sensor node,
backed by Firebase Realtime Database. Built for outdoor tank / reservoir /
dam / lake deployments.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4 (CSS-first `@theme` config in [src/index.css](src/index.css))
- Recharts (trend chart, with brush-based zoom/pan)
- Framer Motion (gauge + KPI transitions)
- Firebase Realtime Database (`firebase/database` modular SDK)
- `html2canvas` + `jsPDF`, lazy-loaded only when a chart export is triggered

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
```

## Configuration

All site-specific tuning lives in [src/config.ts](src/config.ts) — nothing
else needs to change when the physical installation differs:

| Constant | Meaning |
|---|---|
| `sensorMountHeightM` | Height of the sensor face above the empty-vessel bottom. Water level = mount height − measured distance. |
| `minValidDistanceM` / `maxValidDistanceM` | Sensor fault range. Readings outside this are flagged `isSensorFault`. |
| `warningThresholdPct` / `criticalThresholdPct` | Capacity % at which the gauge/alerts switch zones. Currently 70% / 90%. |
| `offlineTimeoutMs` | How long without a reading before the device is shown as Offline. |
| `firebaseDataPath` | RTDB path read for the live reading (`water_monitor`). |

## Data contract

Firebase node at `water_monitor`:

```json
{
  "depth_cm": 5.81,
  "depth_m": 0.06,
  "status": "Near",
  "updated_at": "LIVE"
}
```

The dashboard reads `depth_m` (falling back to `depth_cm / 100`) as the
**distance from the sensor to the water surface**, and derives everything
else (`waterLevelM`, `capacityPct`, `alertLevel`) from that plus
`SITE_CONFIG.sensorMountHeightM`. The device's own `status` string is not
used for alerting — alert level is computed independently from capacity %
so it stays consistent if the firmware's status text ever changes.

## Scope notes (intentional)

This Firebase project currently only publishes one device's current reading
— there is no server-side history, no multi-sensor fleet, no GPS/location
data, and no audit trail. Rather than fabricate placeholder data for those
in a dashboard meant for official/government use, the following were
**omitted** until a real data source exists:

- Multi-sensor fleet grid
- Geographical / map view
- Predictive analytics / forecasting
- Reports generation
- Server-side audit log
- Battery level, signal strength, firmware version, temperature (not
  published by the current device firmware)

What *is* shown live: current level/depth/distance/capacity, device
online/offline state (derived from reading recency), and a **session
history** trend chart + alert log — built client-side from readings
observed while the dashboard is open (persisted to `localStorage`, capped
at 24h), clearly labeled as session data rather than an authoritative
historical archive.

To re-enable any of the omitted sections, add the corresponding data to
Firebase (e.g. a `history/` node written by the ESP32 or a Cloud Function,
a `sensors/{id}` fleet node, a `location` node with lat/lng) and wire it up
the same way [useWaterMonitor.ts](src/hooks/useWaterMonitor.ts) wires the
current reading.
