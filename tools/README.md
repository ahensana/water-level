# Calibration & validation tools

Offline analysis scripts for checking the A01 ultrasonic feed against the
manual staff-gauge logbook. Not part of the deployed app.

## Refresh the sensor data

```bash
node -e "const fs=require('fs');fetch('https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app/water_monitor/current.json').then(r=>r.text()).then(t=>fs.writeFileSync('tools/sensor-dump.json',t))"
```

`sensor-dump.json` is gitignored — regenerate it when you need fresh data.

## Scripts

| Script | What it answers |
|---|---|
| `node tools/compare.mjs [--from=YYYY-MM-DD] [--table]` | Hour-by-hour sensor vs logbook. Reports implied sensor elevation per day, residuals, diurnal bias, and temperature correlation. |
| `node tools/diurnal.mjs` | Isolates the repeating daily oscillation by detrending each day, to tell an artefact from a real level change. |
| `npx tsx tools/pipelineCheck.ts [--from=YYYY-MM-DD]` | Replays the **actual app pipeline** (`processMonitorPipeline`) at each logged hour and scores what the dashboard would have displayed, including quality status, fault codes and false alarms. Also sweeps `sensorElevationFt` to check the calibration constant is still optimal. |
| `npx tsx tools/diurnalCheck.ts` | Runs the app's `computeDiurnalProfile` over the recorded feed and prints the daily oscillation, to confirm it agrees with `diurnal.mjs`. |
| `npx tsx tools/intervalReportCheck.ts` | Scores the app's **Interval Report** (`buildIntervalReport`) at every granularity against the logbook, replays the whole register through **Gauge Verification** (`verifyAgainstGauge`) to check the PASS/FAIL verdict at the 0.3 ft tolerance, and asserts that (a) no badly-wrong interval escapes the suspect flag and (b) the suggested offset does not move when the display granularity changes. |
| `npx tsx tools/historyCheck.ts` | Checks the app's **Trusted Reading History** browser (`buildTrustedHistory`, `filterTrustedHistory`) shows exactly the readings the live gauge trusts — same count, same levels, same alert bands as `processMonitorPipeline` — and that every filter is a correct subset, including the hour-of-day window that wraps midnight. Also asserts the CSV export stays column-aligned. |
| `node tools/pushKeyCheck.mjs` | Verifies the assumption the Interval Report's range query depends on: that Firebase push keys encode write time, so a key range can substitute for a time range without an index. Confirms no reading is clipped from a requested window. |

## Two different accuracy checks

`pipelineCheck.ts` and `intervalReportCheck.ts` deliberately exercise different
code paths and will not report identical numbers:

- **`pipelineCheck`** covers the *live* path. Its jump filter suppresses steps it
  cannot yet distinguish from a false echo, which is right for a gauge someone
  is watching but hides what the sensor actually reported.
- **`intervalReportCheck`** covers the *audit* path, which shows every
  physically-valid sample so an operator can judge a suspect hour themselves.

`historyCheck.ts` belongs to the live path: the Trusted Reading History browser
exists to explain the gauge, so it deliberately shows only readings the gauge
trusts. An operator comparing the two in-app views will therefore find rows in
the Interval Report that the history omits — that is the filter working, and the
history browser is asserted to agree with the pipeline reading for reading.

The audit path therefore surfaces echo artefacts the live path hides — on the
1-13 Aug record, one hour reads 8.7 ft high off 72 valid samples. That is why
suspect-interval flagging exists, and why `intervalReportCheck` asserts no
unflagged interval is off by more than 0.5 ft: those intervals feed the in-app
calibration trim.

Two properties of that flagging are load-bearing and are asserted by the check,
because both were broken during development:

- **It must not depend on the display granularity.** Judging an interval against
  a fixed number of neighbouring rows spans only ~3 minutes at raw granularity,
  so an hour-long echo hid inside its own neighbours and went unflagged while the
  same echo was caught at hourly. The neighbourhood is a fixed *time* span
  (±3 h), widened by row count only where a data gap would otherwise leave too
  little context.
- **The step limit must adapt to how much the reservoir is moving.** Fixed at the
  worst-case fill rate it was so loose that 1.4 ft spikes passed unflagged
  against a dead-flat record; it is now scaled from the neighbourhood's median
  absolute deviation, floored at 0.4 ft (above the known 0.119 ft diurnal swing)
  and capped at the physical fill rate.

As of the 5-13 Aug record all eight granularities are clean, and verification
against 171 logbook readings passes with a worst deviation of 0.16 ft.

## Re-calibrating

Run `pipelineCheck.ts` and read the sweep table: pick the `newElev` whose
median error is closest to zero, then update `sensorElevationFt` in
`app/src/config.ts` and note the per-day fits in the comment above it. Also
refresh `SITE_CONFIG.calibration`, which the QA card and the operations PDF
quote as the calibration basis.

This is the durable fix. The in-app **calibration trim** is the fast one: it
shifts levels by up to ±1 ft from the Interval Report without a deploy, but it
is stored per-browser, so it corrects one workstation rather than the site. Use
it to bring a drifting sensor back in line between re-fits, then fold the
correction into `sensorElevationFt` here and clear the trim.

`fieldLog.mjs` holds the transcribed logbook (feet, hourly) from the register
photos in `RealDataFromSite/`. Add new days there as fresh pages arrive.
