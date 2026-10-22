from weather import collect, summarize

NOW = 1_791_400_000_000  # 2026-10-07 ~23:56 IST


def hour(iso, mm, pct=50, unit="MILLIMETERS"):
    return {
        "interval": {"startTime": iso, "endTime": iso},
        "temperature": {"degrees": 20.0, "unit": "CELSIUS"},
        "weatherCondition": {"type": "RAIN", "description": {"text": "Rain", "languageCode": "en"}},
        "precipitation": {"probability": {"percent": pct, "type": "RAIN"}, "qpf": {"quantity": mm, "unit": unit}},
    }


def fake_fetch(pages):
    calls = []

    def fetch(path, params):
        calls.append((path, params))
        return pages[path].pop(0)

    return fetch, calls


def test_collect_follows_page_tokens():
    pages = {
        "currentConditions:lookup": [{"currentTime": "2026-10-07T18:00:00Z"}],
        "history/hours:lookup": [{"historyHours": [hour("2026-10-07T17:00:00Z", 1.0)]}],
        "forecast/hours:lookup": [
            {"forecastHours": [hour("2026-10-07T19:00:00Z", 2.0)], "nextPageToken": "p2"},
            {"forecastHours": [hour("2026-10-08T19:00:00Z", 3.0)]},
        ],
        "forecast/days:lookup": [{"forecastDays": []}],
    }
    fetch, calls = fake_fetch(pages)
    raw = collect(fetch, 25.65, 91.88)
    assert len(raw["hours"]) == 2
    assert calls[3][1]["pageToken"] == "p2"
    assert all(c[1]["unitsSystem"] == "METRIC" for c in calls)


def test_summarize_totals_and_units():
    raw = {
        "current": {
            "currentTime": "2026-10-07T18:20:00Z",
            "temperature": {"degrees": 68.0, "unit": "FAHRENHEIT"},
            "relativeHumidity": 92,
            "precipitation": {"qpf": {"quantity": 0.1, "unit": "INCHES"}, "probability": {"percent": 80}},
            "currentConditionsHistory": {"qpf": {"quantity": 12.0, "unit": "MILLIMETERS"}},
        },
        "history": [hour("2026-10-07T16:00:00Z", 1.5), hour("2026-10-07T17:00:00Z", 2.5)],
        "hours": [
            hour("2026-10-07T19:00:00Z", 4.0),  # within 24 h
            hour("2026-10-09T10:00:00Z", 6.0),  # within 72 h, beyond 24 h
            hour("2026-10-12T10:00:00Z", 50.0),  # beyond 72 h
        ],
        "days": [
            {
                "displayDate": {"year": 2026, "month": 10, "day": 8},
                "daytimeForecast": {"precipitation": {"qpf": {"quantity": 3, "unit": "MILLIMETERS"}, "probability": {"percent": 60}}},
                "nighttimeForecast": {"precipitation": {"qpf": {"quantity": 2, "unit": "MILLIMETERS"}, "probability": {"percent": 70}}},
                "maxTemperature": {"degrees": 24, "unit": "CELSIUS"},
                "minTemperature": {"degrees": 17, "unit": "CELSIUS"},
            }
        ],
    }
    s = summarize(raw, NOW)
    assert s["totals"] == {"past24hMm": 4.0, "next24hMm": 4.0, "next72hMm": 10.0}
    assert s["current"]["tempC"] == 20.0
    assert s["current"]["rainLastHourMm"] == 2.54
    assert s["current"]["rainLast24hMm"] == 12.0
    assert s["days"] == [{"date": "2026-10-08", "rainMm": 5.0, "probPct": 70, "maxC": 24.0, "minC": 17.0, "cond": None}]
    assert [h["kind"] for h in s["hours"]] == ["past", "past", "forecast", "forecast", "forecast"]
    assert s["hours"] == sorted(s["hours"], key=lambda h: h["t"])


def test_summarize_tolerates_missing_fields():
    s = summarize({"current": {}, "history": [{}], "hours": [{"interval": {"startTime": "2026-10-07T19:00:00Z"}}], "days": [{}]}, NOW)
    assert s["totals"]["past24hMm"] is None
    assert s["hours"][0]["rainMm"] is None
    assert s["days"] == []
