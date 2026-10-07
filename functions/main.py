"""Firebase Functions for the Umiam water-level dashboard.

  ingest            HTTPS  device posts readings here (key-protected)
  refresh_weather   hourly Google Weather API at the dam -> /satellite/weather
  refresh_rainfall  hourly GSMaP satellite rainfall over the catchment -> /satellite/rainfall
  refresh_reservoir 2x/day Sentinel-1/2 water area + latest images -> /satellite/reservoir, /satellite/imagery

Secrets (set once with `firebase functions:secrets:set NAME`):
  DEVICE_INGEST_KEY  shared with the firmware's secrets.h
  WEATHER_API_KEY    Google Maps Platform key restricted to the Weather API
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import firebase_admin
import requests
from firebase_admin import db, storage
from firebase_functions import https_fn, options, scheduler_fn
from firebase_functions.params import SecretParam

import siteconfig as S
from ingest import PayloadError, key_ok, validate

DEVICE_INGEST_KEY = SecretParam("DEVICE_INGEST_KEY")
WEATHER_API_KEY = SecretParam("WEATHER_API_KEY")

options.set_global_options(region=S.REGION, max_instances=3)
TZ = ZoneInfo(S.TIMEZONE)
log = logging.getLogger("water-level")

_app: firebase_admin.App | None = None


def app() -> firebase_admin.App:
    global _app
    if _app is None:
        _app = firebase_admin.initialize_app(options={"databaseURL": S.DATABASE_URL, "storageBucket": S.STORAGE_BUCKET})
    return _app


def sat_ref(child: str) -> db.Reference:
    return db.reference(f"{S.PATH_SAT}/{child}", app=app())


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def record_status(job: str, ok: bool, detail: str = "") -> None:
    """One line per job under /satellite/status so the dashboard can show failures."""
    try:
        sat_ref(f"status/{job}").set({"at": now_ms(), "ok": ok, "detail": detail[:300]})
    except Exception:  # status is best effort; never mask the real error
        log.exception("could not write status for %s", job)


# ---------------------------------------------------------------- device ingest


@https_fn.on_request(secrets=[DEVICE_INGEST_KEY], memory=options.MemoryOption.MB_256, timeout_sec=30, max_instances=2)
def ingest(req: https_fn.Request) -> https_fn.Response:
    if req.method != "POST":
        return https_fn.Response("method not allowed", status=405)

    provided = req.args.get("key") or req.headers.get("X-Device-Key")
    if not key_ok(provided, DEVICE_INGEST_KEY.value):
        return https_fn.Response("unauthorized", status=401)

    try:
        payload = json.loads(req.get_data(as_text=True) or "null")
        clean = validate(payload)
    except (ValueError, PayloadError) as err:  # json errors are ValueErrors too
        return https_fn.Response(f"bad request: {err}", status=400)

    clean["timestamp"] = {".sv": "timestamp"}
    key = db.reference(S.PATH_READINGS, app=app()).push(clean).key
    # Same response shape as a Realtime Database REST POST, so firmware that
    # parses {"name": ...} keeps working.
    return https_fn.Response(json.dumps({"name": key}), status=200, content_type="application/json")


# ---------------------------------------------------------------- weather (near real time)


@scheduler_fn.on_schedule(schedule="5 * * * *", timezone=TZ, secrets=[WEATHER_API_KEY], timeout_sec=120, memory=options.MemoryOption.MB_256)
def refresh_weather(event: scheduler_fn.ScheduledEvent) -> None:
    import weather

    try:
        raw = weather.collect(weather.http_fetch(WEATHER_API_KEY.value), S.LAKE_LAT, S.LAKE_LON)
        sat_ref("weather").set(weather.summarize(raw, now_ms()))
        record_status("weather", True)
    except Exception as err:
        record_status("weather", False, f"{type(err).__name__}: {err}")
        raise


# ---------------------------------------------------------------- Earth Engine


def site_geometry():
    """Reservoir + catchment, derived once and cached in the database."""
    import earth

    earth.init()
    cfg = sat_ref("config").get()
    if not cfg or cfg.get("version") != earth.GEOMETRY_VERSION:
        cfg = earth.derive_geometry()
        sat_ref("config").set(cfg)
        log.info("derived site geometry: catchment %.1f km2 (published %.0f)", cfg["catchmentKm2"], cfg["publishedCatchmentKm2"])
    return earth.geometries(cfg)


@scheduler_fn.on_schedule(schedule="20 * * * *", timezone=TZ, timeout_sec=300, memory=options.MemoryOption.MB_512)
def refresh_rainfall(event: scheduler_fn.ScheduledEvent) -> None:
    import earth

    try:
        _, catchment = site_geometry()
        sat_ref("rainfall").set(earth.catchment_rainfall(catchment))
        record_status("rainfall", True)
    except Exception as err:
        record_status("rainfall", False, f"{type(err).__name__}: {err}")
        raise


@scheduler_fn.on_schedule(schedule="35 6,18 * * *", timezone=TZ, timeout_sec=540, memory=options.MemoryOption.GB_1)
def refresh_reservoir(event: scheduler_fn.ScheduledEvent) -> None:
    import earth

    try:
        reservoir, _ = site_geometry()
        existing = sat_ref("reservoir/series").get() or []
        # First run backfills four months; afterwards a month is plenty to catch late scenes.
        lookback = 30 if existing else 120
        new = earth.s1_areas(reservoir, lookback) + earth.s2_areas(reservoir, lookback)
        series = earth.merge_series(list(existing), new, now_ms())
        sat_ref("reservoir").set({"updatedAt": now_ms(), "series": series, "waterThresholdDb": earth.S1_WATER_DB})

        images = earth.latest_images(reservoir)
        sat_ref("imagery").set({"updatedAt": now_ms(), **{k: store_image(k, v) for k, v in images.items() if v}})
        record_status("reservoir", True, f"{len(new)} scene(s) in last {lookback} days")
    except Exception as err:
        record_status("reservoir", False, f"{type(err).__name__}: {err}")
        raise


def store_image(kind: str, meta: dict) -> dict:
    """Copies an Earth Engine thumbnail into Cloud Storage; thumbnail URLs expire."""
    png = requests.get(meta["url"], timeout=120)
    png.raise_for_status()
    path = f"satellite/{kind}-latest.png"
    blob = storage.bucket(app=app()).blob(path)
    blob.cache_control = "public, max-age=600"
    blob.upload_from_string(png.content, content_type="image/png")
    url = f"https://firebasestorage.googleapis.com/v0/b/{S.STORAGE_BUCKET}/o/{requests.utils.quote(path, safe='')}?alt=media&v={meta['t']}"
    return {k: v for k, v in meta.items() if k != "url"} | {"url": url}
