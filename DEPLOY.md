# Deploying the security lock and the satellite features

Two independent changes ship together here. Do them in this order.

| Step | What | Breaks the live feed? |
|---|---|---|
| 1 | Hardened database rules + new dashboard | No |
| 2 | Google Cloud setup, then Cloud Functions (satellite, weather, ingest) | No |
| 3 | Reflash the site device, then lock the database | Only if done out of order |

## 1. Rules and dashboard (safe now)

`database.rules.json` now requires every reading's `timestamp` to equal the
server's clock (`newData.val() === now`). Both firmwares already send
`{".sv":"timestamp"}`, so the device keeps posting, but nobody can insert
backdated or future-dated readings any more. It also adds a public-read,
no-write `/satellite` node for the new cards.

```bash
cd app && npm ci && npm run build && cd ..
firebase deploy --only database,hosting
```

**Check:** within ~5 minutes a new reading appears on the dashboard.
**Rollback:** set the `timestamp` rule back to `"newData.isNumber()"` and run
`firebase deploy --only database`.

Until step 2 is done the new "Satellite & Weather" cards say they have no data yet.

## 2. Google Cloud setup and functions

One-time, in the Google Cloud / Firebase console for `water-level-ae453`:

1. **Blaze plan.** Firebase console, Usage and billing, upgrade to Blaze
   (pay as you go). Needed for Cloud Functions and the Storage bucket.
2. **Earth Engine.** Register the project at
   https://code.earthengine.google.com/register as **commercial**, Limited
   (pay-as-you-go) plan, and enable the Earth Engine API. Mechatron is a
   commercial user, so the free noncommercial tier does not apply.
3. **Service account roles.** In IAM, give the functions' runtime account
   `315746351135-compute@developer.gserviceaccount.com` these roles:
   *Earth Engine Resource Viewer* and *Service Usage Consumer*.
4. **Weather API key.** In Google Maps Platform, enable the **Weather API** and
   create an API key restricted to that one API.
5. **Storage.** Open Storage in the Firebase console once so the default bucket
   exists.

Secrets (the CLI prompts for the value):

```bash
firebase functions:secrets:set WEATHER_API_KEY      # the key from step 4
firebase functions:secrets:set DEVICE_INGEST_KEY    # e.g. output of: openssl rand -hex 24
```

Keep the device key somewhere safe: the firmware needs the same value in step 3.

Deploy. The Firebase CLI needs a Python 3.12 virtualenv named `venv` inside
`functions/`:

```bash
cd functions
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt          # Windows: venv\Scripts\pip install -r requirements.txt
venv/bin/python -m pytest -q tests                # Windows: venv\Scripts\python -m pytest -q tests
cd ..
firebase deploy --only functions,storage
```

The scheduled jobs then run on their own (weather hourly at :05, rainfall
hourly at :20, reservoir area and images at 06:35 and 18:35 IST). To fill the
cards straight away, open Cloud Scheduler in the Google Cloud console and
**Force run** each `firebase-schedule-refresh_*` job. The first reservoir run
also traces the catchment and backfills four months of radar, so give it a few
minutes.

**Check:** `firebase functions:log` shows no errors, and each card shows
"updated N min ago". If a job fails, its card shows the error message.

What runs where:

| Function | Schedule | Writes |
|---|---|---|
| `ingest` | on request from the device | `/water_monitor/current` |
| `refresh_weather` | hourly | `/satellite/weather` (Google Weather API) |
| `refresh_rainfall` | hourly | `/satellite/rainfall` (JAXA GSMaP via Earth Engine) |
| `refresh_reservoir` | twice daily | `/satellite/reservoir`, `/satellite/imagery`, Storage `satellite/*.png` |

## 3. Reflash the device, then lock the database

1. Next to the sketch, copy `secrets.example.h` to `secrets.h` and put the
   `DEVICE_INGEST_KEY` value in it. `secrets.h` is git-ignored; never commit it.
2. Flash the device on site and watch the debug log for `HTTP status: 200`.
3. Confirm the readings now arrive through the function:
   `firebase functions:log --only ingest`.
4. Only then lock the database so nothing but the function can write:

```bash
cp database.rules.locked.json database.rules.json
firebase deploy --only database
```

If the lock goes out before the reflash, the device's posts are refused and the
dashboard stops updating. Undo by redeploying the step 1 rules.

## Costs to expect

- Earth Engine, Limited plan: $0.40 per compute-hour, no monthly fee. These
  jobs reduce small areas and should use a small fraction of an hour a month;
  check the first month's bill.
- Weather API: six calls an hour (forecast is paged), about 4,400 a month.
- Functions, Storage, Scheduler: within or close to Blaze's free allowances at
  this volume.

Set a budget alert on the billing account so a mistake cannot run up a bill.
