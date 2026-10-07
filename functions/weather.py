"""Google Maps Platform Weather API: rain at the dam, past 24 h and next 72 h.

This is the near-real-time half of the feature. Satellite rainfall (see
earth.py) covers the whole catchment but arrives hours to days late; the Weather
API answers "is it raining at the dam now, and how much is coming".

Endpoints (https://developers.google.com/maps/documentation/weather):
  currentConditions:lookup, history/hours:lookup (24 h max),
  forecast/hours:lookup (paged, 24 h per page), forecast/days:lookup.
India supports all four; weather alerts are not offered there.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

import requests

BASE = "https://weather.googleapis.com/v1"
FORECAST_HOURS = 72
FORECAST_DAYS = 5
MAX_PAGES = 12

Fetch = Callable[[str, dict[str, Any]], dict[str, Any]]


def http_fetch(api_key: str) -> Fetch:
    def fetch(path: str, params: dict[str, Any]) -> dict[str, Any]:
        resp = requests.get(f"{BASE}/{path}", params={"key": api_key, **params}, timeout=20)
        resp.raise_for_status()
        return resp.json()

    return fetch


def _paged(fetch: Fetch, path: str, params: dict[str, Any], list_key: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    token = None
    for _ in range(MAX_PAGES):
        page = fetch(path, {**params, **({"pageToken": token} if token else {})})
        items.extend(page.get(list_key, []))
        token = page.get("nextPageToken")
        if not token:
            break
    return items


def collect(fetch: Fetch, lat: float, lon: float) -> dict[str, Any]:
    """Calls the four endpoints and returns their raw lists."""
    loc = {"location.latitude": lat, "location.longitude": lon, "unitsSystem": "METRIC"}
    return {
        "current": fetch("currentConditions:lookup", loc),
        "history": _paged(fetch, "history/hours:lookup", {**loc, "hours": 24, "pageSize": 24}, "historyHours"),
        "hours": _paged(fetch, "forecast/hours:lookup", {**loc, "hours": FORECAST_HOURS, "pageSize": 24}, "forecastHours"),
        "days": _paged(fetch, "forecast/days:lookup", {**loc, "days": FORECAST_DAYS, "pageSize": FORECAST_DAYS}, "forecastDays"),
    }


# ---------------------------------------------------------------- parsing


def _ms(iso: str | None) -> int | None:
    if not iso:
        return None
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def _mm(qpf: dict[str, Any] | None) -> float | None:
    if not qpf or qpf.get("quantity") is None:
        return None
    q = float(qpf["quantity"])
    return q * 25.4 if qpf.get("unit") == "INCHES" else q


def _deg_c(t: dict[str, Any] | None) -> float | None:
    if not t or t.get("degrees") is None:
        return None
    d = float(t["degrees"])
    return (d - 32) * 5 / 9 if t.get("unit") == "FAHRENHEIT" else d


def _cond(c: dict[str, Any] | None) -> str | None:
    if not c:
        return None
    return (c.get("description") or {}).get("text") or c.get("type")


def _round(x: float | None, n: int = 1) -> float | None:
    return None if x is None else round(x, n)


def _hour(h: dict[str, Any], kind: str) -> dict[str, Any] | None:
    t = _ms((h.get("interval") or {}).get("startTime"))
    if t is None:
        return None
    precip = h.get("precipitation") or {}
    return {
        "t": t,
        "kind": kind,
        "rainMm": _round(_mm(precip.get("qpf")), 2),
        "probPct": (precip.get("probability") or {}).get("percent"),
        "tempC": _round(_deg_c(h.get("temperature"))),
        "cond": _cond(h.get("weatherCondition")),
    }


def _sum(hours: list[dict[str, Any]]) -> float | None:
    vals = [h["rainMm"] for h in hours if h.get("rainMm") is not None]
    return round(sum(vals), 1) if vals else None


def summarize(raw: dict[str, Any], now_ms: int) -> dict[str, Any]:
    past = [h for h in (_hour(x, "past") for x in raw["history"]) if h]
    future = [h for h in (_hour(x, "forecast") for x in raw["hours"]) if h]
    past.sort(key=lambda h: h["t"])
    future.sort(key=lambda h: h["t"])

    cur = raw.get("current") or {}
    cur_precip = cur.get("precipitation") or {}
    cur_hist = cur.get("currentConditionsHistory") or {}

    days = []
    for d in raw["days"]:
        dd = d.get("displayDate") or {}
        if not dd.get("year"):
            continue
        day_rain = [_mm(((d.get(part) or {}).get("precipitation") or {}).get("qpf")) for part in ("daytimeForecast", "nighttimeForecast")]
        day_prob = [((((d.get(part) or {}).get("precipitation") or {}).get("probability")) or {}).get("percent") for part in ("daytimeForecast", "nighttimeForecast")]
        rain_vals = [r for r in day_rain if r is not None]
        prob_vals = [p for p in day_prob if p is not None]
        days.append(
            {
                "date": f"{dd['year']:04d}-{dd['month']:02d}-{dd['day']:02d}",
                "rainMm": round(sum(rain_vals), 1) if rain_vals else None,
                "probPct": max(prob_vals) if prob_vals else None,
                "maxC": _round(_deg_c(d.get("maxTemperature"))),
                "minC": _round(_deg_c(d.get("minTemperature"))),
                "cond": _cond((d.get("daytimeForecast") or {}).get("weatherCondition")),
            }
        )

    def window(hours: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
        return [h for h in hours if h["t"] < now_ms + n * 3_600_000]

    return {
        "updatedAt": now_ms,
        "source": "Google Weather API",
        "current": {
            "t": _ms(cur.get("currentTime")),
            "tempC": _round(_deg_c(cur.get("temperature"))),
            "humidityPct": cur.get("relativeHumidity"),
            "cond": _cond(cur.get("weatherCondition")),
            "rainProbPct": (cur_precip.get("probability") or {}).get("percent"),
            "rainLastHourMm": _round(_mm(cur_precip.get("qpf")), 2),
            "rainLast24hMm": _round(_mm(cur_hist.get("qpf"))),
        },
        "hours": past + future,
        "days": days,
        "totals": {
            "past24hMm": _sum(past),
            "next24hMm": _sum(window(future, 24)),
            "next72hMm": _sum(window(future, 72)),
        },
    }
