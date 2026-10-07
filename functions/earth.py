"""Earth Engine jobs: catchment rainfall, reservoir water area, latest imagery.

None of this is real time, and the dashboard says so:
  - GSMaP rainfall (JAXA, 0.1 deg, hourly) reaches Earth Engine hours to days
    after the fact. Every result carries `latestDataAt`, the time of the newest
    hour actually available, so the card can show its real lag.
  - Sentinel-1 radar passes every ~6-12 days but sees through monsoon cloud.
  - Sentinel-2 optical passes every ~5 days but is often clouded out.

Geometry is derived once from public datasets and cached in the database:
  - reservoir outline: JRC Global Surface Water max extent, the connected water
    body under the lake centroid.
  - catchment: HydroBASINS level 12, every basin draining through the
    reservoir's outlet basin. Its area is recorded next to the published
    220 km2 so a bad derivation is visible, not silent.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import ee
import google.auth

import siteconfig as S

GEOMETRY_VERSION = 1

GSMAP = "JAXA/GPM_L3/GSMaP/v8/operational"
GSW = "JRC/GSW1_4/GlobalSurfaceWater"
BASINS = "WWF/HydroSHEDS/v1/Basins/hybas_12"
S1 = "COPERNICUS/S1_GRD"
S2 = "COPERNICUS/S2_SR_HARMONIZED"
CS_PLUS = "GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED"

# Radar water threshold on speckle-filtered VV backscatter (dB). Calm open water
# is typically below -18 dB, land above -12. Wind-roughened water can rise past
# the threshold, so radar area tends to under- rather than over-estimate.
S1_WATER_DB = -16.0
S1_MIN_COVERAGE = 0.98  # fraction of the reservoir mask the scene must cover
S2_MIN_CLEAR = 0.90  # fraction of the reservoir mask that must be cloud free for an area
S2_IMAGE_MIN_CLEAR = 0.70  # looser bar for just showing a picture
CS_CLEAR = 0.60  # Cloud Score+ cs_cdf at or above this counts as clear
MASK_BUFFER_M = 300  # room for the water to grow past its mapped max extent
SERIES_KEEP_DAYS = 400


_initialized = False


def init() -> None:
    """Authenticates with the function's own service account (no key file)."""
    global _initialized
    if _initialized:
        return
    creds, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/earthengine", "https://www.googleapis.com/auth/cloud-platform"]
    )
    ee.Initialize(credentials=creds, project=S.PROJECT_ID, opt_url="https://earthengine-highvolume.googleapis.com")
    _initialized = True


# ---------------------------------------------------------------- geometry


def derive_geometry() -> dict[str, Any]:
    """Finds the reservoir outline and its upstream catchment. Run once, then cached."""
    seed = ee.Geometry.Point([S.LAKE_LON, S.LAKE_LAT])
    box = seed.buffer(15000).bounds()

    water = ee.Image(GSW).select("max_extent").selfMask()
    bodies = water.reduceToVectors(geometry=box, scale=30, geometryType="polygon", eightConnected=True, maxPixels=1e9)
    near = bodies.filterBounds(seed.buffer(1500)).map(lambda f: f.set("a", f.geometry().area(10)))
    reservoir = ee.Feature(near.sort("a", False).first()).geometry().simplify(30)

    basins = ee.FeatureCollection(BASINS).filterBounds(seed.buffer(80000))
    table = basins.reduceColumns(ee.Reducer.toList(3), ["HYBAS_ID", "NEXT_DOWN", "UP_AREA"]).get("list").getInfo()
    touching = set(basins.filterBounds(reservoir).aggregate_array("HYBAS_ID").getInfo())
    if not touching:
        raise RuntimeError("no HydroBASINS level-12 basin intersects the reservoir outline")

    up_area = {int(h): float(a) for h, _, a in table}
    outlet = max(touching, key=lambda h: up_area.get(int(h), 0.0))
    upstream = upstream_ids(int(outlet), [(int(h), int(n)) for h, n, _ in table])

    catchment = (
        basins.filter(ee.Filter.inList("HYBAS_ID", list(upstream))).union(100).geometry().simplify(200)
    )
    reservoir_km2 = reservoir.area(10).divide(1e6)
    catchment_km2 = catchment.area(100).divide(1e6)
    info = ee.Dictionary(
        {
            "reservoir": reservoir,
            "catchment": catchment,
            "reservoirMaxKm2": reservoir_km2,
            "catchmentKm2": catchment_km2,
        }
    ).getInfo()

    return {
        "version": GEOMETRY_VERSION,
        "derivedAt": _now_ms(),
        "reservoir": info["reservoir"],
        "catchment": info["catchment"],
        "reservoirMaxKm2": round(info["reservoirMaxKm2"], 2),
        "catchmentKm2": round(info["catchmentKm2"], 1),
        "publishedCatchmentKm2": S.PUBLISHED_CATCHMENT_KM2,
        "basinCount": len(upstream),
        "sources": {"reservoir": GSW + " max_extent", "catchment": BASINS},
    }


def upstream_ids(outlet: int, edges: list[tuple[int, int]]) -> set[int]:
    """All basins whose flow path passes through `outlet`, including itself.

    `edges` is (HYBAS_ID, NEXT_DOWN) pairs. Pure so it can be tested offline.
    """
    children: dict[int, list[int]] = defaultdict(list)
    for basin, down in edges:
        children[down].append(basin)
    seen = {outlet}
    stack = [outlet]
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in seen:
                seen.add(child)
                stack.append(child)
    return seen


def geometries(cfg: dict[str, Any]) -> tuple[ee.Geometry, ee.Geometry]:
    return ee.Geometry(cfg["reservoir"]), ee.Geometry(cfg["catchment"])


# ---------------------------------------------------------------- rainfall


def catchment_rainfall(catchment: ee.Geometry, days: int = 7) -> dict[str, Any]:
    """Area-averaged hourly satellite rainfall over the catchment."""
    end = datetime.now(timezone.utc)
    # Look back further than `days` so a multi-day ingestion lag still yields a full week.
    col = ee.ImageCollection(GSMAP).select("hourlyPrecipRate").filterDate(_iso(end - timedelta(days=days + 10)), _iso(end))

    def per_hour(img: ee.Image) -> ee.Feature:
        mean = img.reduceRegion(ee.Reducer.mean(), catchment, 1000, bestEffort=True).get("hourlyPrecipRate")
        return ee.Feature(None, {"t": img.get("system:time_start"), "mm": mean})

    rows = col.map(per_hour).filter(ee.Filter.notNull(["mm"])).reduceColumns(ee.Reducer.toList(2), ["t", "mm"]).get("list").getInfo()
    return summarize_rainfall(rows, days, _now_ms())


def summarize_rainfall(rows: list[list[Any]], days: int, now_ms: int) -> dict[str, Any]:
    """Keeps the newest `days` of hours and totals them back from the newest hour. Pure."""
    hours = sorted((int(t), round(float(mm), 2)) for t, mm in rows if t is not None and mm is not None)
    if not hours:
        return {"updatedAt": now_ms, "source": GSMAP, "latestDataAt": None, "hours": [], "totals": {}}
    latest = hours[-1][0]
    hours = [h for h in hours if h[0] > latest - days * 86_400_000]

    def total(h: int) -> float:
        return round(sum(mm for t, mm in hours if t > latest - h * 3_600_000), 1)

    return {
        "updatedAt": now_ms,
        "source": GSMAP,
        "latestDataAt": latest,
        "lagHours": round((now_ms - latest) / 3_600_000, 1),
        "hours": [[t, mm] for t, mm in hours],
        "totals": {"h24": total(24), "h72": total(72), "d7": total(24 * 7)},
    }


# ---------------------------------------------------------------- reservoir area


def _mask(reservoir: ee.Geometry) -> ee.Geometry:
    return reservoir.buffer(MASK_BUFFER_M)


def s1_collection(region: ee.Geometry, start: datetime, end: datetime) -> ee.ImageCollection:
    return (
        ee.ImageCollection(S1)
        .filterBounds(region)
        .filterDate(_iso(start), _iso(end))
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .select("VV")
    )


def s1_areas(reservoir: ee.Geometry, days: int) -> list[dict[str, Any]]:
    """Radar water area per Sentinel-1 scene that fully covers the reservoir."""
    mask = _mask(reservoir)
    mask_m2 = mask.area(10)
    end = datetime.now(timezone.utc)

    def per_scene(img: ee.Image) -> ee.Feature:
        covered = img.mask().multiply(ee.Image.pixelArea()).reduceRegion(ee.Reducer.sum(), mask, 20, maxPixels=1e9).get("VV")
        water = img.focalMedian(30, "circle", "meters").lt(S1_WATER_DB).selfMask()
        water_m2 = water.multiply(ee.Image.pixelArea()).reduceRegion(ee.Reducer.sum(), mask, 10, maxPixels=1e9).get("VV")
        return ee.Feature(
            None,
            {
                "t": img.get("system:time_start"),
                "id": img.get("system:index"),
                "coverage": ee.Number(covered).divide(mask_m2),
                "km2": ee.Number(ee.Algorithms.If(water_m2, water_m2, 0)).divide(1e6),
            },
        )

    rows = (
        s1_collection(mask, end - timedelta(days=days), end)
        .map(per_scene)
        .reduceColumns(ee.Reducer.toList(4), ["t", "id", "coverage", "km2"])
        .get("list")
        .getInfo()
    )
    return [
        {"t": int(t), "scene": sid, "km2": round(float(km2), 3), "source": "S1"}
        for t, sid, cov, km2 in rows
        if cov is not None and cov >= S1_MIN_COVERAGE
    ]


def _s2_with_clear(region: ee.Geometry, start: datetime, end: datetime) -> ee.ImageCollection:
    cs = ee.ImageCollection(CS_PLUS)

    def add_clear(img: ee.Image) -> ee.Image:
        score = img.linkCollection(cs, ["cs_cdf"]).select("cs_cdf")
        clear = score.gte(CS_CLEAR)
        frac = clear.reduceRegion(ee.Reducer.mean(), region, 20, maxPixels=1e9).get("cs_cdf")
        return img.updateMask(clear).set("clear", frac)

    return (
        ee.ImageCollection(S2)
        .filterBounds(region)
        .filterDate(_iso(start), _iso(end))
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80))
        .map(add_clear)
        .filter(ee.Filter.notNull(["clear"]))
    )


def s2_areas(reservoir: ee.Geometry, days: int) -> list[dict[str, Any]]:
    """Optical (NDWI) water area for near-cloud-free Sentinel-2 scenes."""
    mask = _mask(reservoir)
    end = datetime.now(timezone.utc)

    def per_scene(img: ee.Image) -> ee.Feature:
        water = img.normalizedDifference(["B3", "B8"]).gt(0).selfMask()
        water_m2 = water.multiply(ee.Image.pixelArea()).reduceRegion(ee.Reducer.sum(), mask, 10, maxPixels=1e9).get("nd")
        return ee.Feature(
            None,
            {
                "t": img.get("system:time_start"),
                "id": img.get("system:index"),
                "clear": img.get("clear"),
                "km2": ee.Number(ee.Algorithms.If(water_m2, water_m2, 0)).divide(1e6),
            },
        )

    rows = (
        _s2_with_clear(mask, end - timedelta(days=days), end)
        .filter(ee.Filter.gte("clear", S2_MIN_CLEAR))
        .map(per_scene)
        .reduceColumns(ee.Reducer.toList(4), ["t", "id", "clear", "km2"])
        .get("list")
        .getInfo()
    )
    return [{"t": int(t), "scene": sid, "km2": round(float(km2), 3), "source": "S2"} for t, sid, _, km2 in rows]


def merge_series(existing: list[dict[str, Any]], new: list[dict[str, Any]], now_ms: int) -> list[dict[str, Any]]:
    """One entry per scene id, newest last, older than SERIES_KEEP_DAYS dropped. Pure."""
    by_scene = {e["scene"]: e for e in existing or [] if "scene" in e}
    for e in new:
        by_scene[e["scene"]] = e
    cutoff = now_ms - SERIES_KEEP_DAYS * 86_400_000
    return sorted((e for e in by_scene.values() if e["t"] >= cutoff), key=lambda e: e["t"])


# ---------------------------------------------------------------- imagery


def latest_images(reservoir: ee.Geometry, days: int = 120) -> dict[str, dict[str, Any] | None]:
    """Thumbnail URLs for the newest usable radar and optical scenes.

    The URLs are short-lived; main.py downloads them into Cloud Storage.
    """
    view = reservoir.buffer(1500).bounds()
    mask = _mask(reservoir)
    end = datetime.now(timezone.utc)
    out: dict[str, dict[str, Any] | None] = {"s1": None, "s2": None}

    s1_rows = s1_areas(reservoir, min(days, 40))
    if s1_rows:
        newest = max(s1_rows, key=lambda r: r["t"])
        img = ee.Image(f"{S1}/{newest['scene']}").select("VV").focalMedian(30, "circle", "meters")
        out["s1"] = {
            "t": newest["t"],
            "scene": newest["scene"],
            "url": img.getThumbURL({"region": view, "dimensions": 900, "format": "png", "min": -25, "max": 0}),
        }

    s2 = _s2_with_clear(mask, end - timedelta(days=days), end).filter(ee.Filter.gte("clear", S2_IMAGE_MIN_CLEAR))
    newest_s2 = s2.sort("system:time_start", False).limit(1)
    rows = newest_s2.reduceColumns(ee.Reducer.toList(3), ["system:time_start", "system:index", "clear"]).get("list").getInfo()
    if rows:
        t, scene, clear = rows[0]
        meta = {"t": t, "scene": scene, "clear": clear}
        # Re-load without the cloud mask so the picture has no holes.
        img = ee.Image(f"{S2}/{meta['scene']}")
        out["s2"] = {
            "t": int(meta["t"]),
            "scene": meta["scene"],
            "clear": round(float(meta["clear"]), 2),
            "url": img.getThumbURL({"region": view, "dimensions": 900, "format": "png", "bands": ["B4", "B3", "B2"], "min": 0, "max": 2500, "gamma": 1.2}),
        }
    return out


# ---------------------------------------------------------------- helpers


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%S")


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)
