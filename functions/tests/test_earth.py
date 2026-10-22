from earth import merge_series, summarize_rainfall, upstream_ids

H = 3_600_000


def test_upstream_trace_follows_next_down_and_ignores_other_branches():
    #   10 -> 2 -> 1 (outlet)      20 -> 3 -> 1      99 -> 50 (separate river)
    edges = [(1, 0), (2, 1), (3, 1), (10, 2), (20, 3), (50, 0), (99, 50)]
    assert upstream_ids(1, edges) == {1, 2, 3, 10, 20}
    assert upstream_ids(2, edges) == {2, 10}
    assert upstream_ids(99, edges) == {99}


def test_rainfall_totals_count_back_from_newest_available_hour():
    latest = 1_791_000_000_000
    rows = [[latest - i * H, 1.0] for i in range(24 * 9)]  # 9 days of 1 mm/h
    rows.append([None, 5.0])
    rows.append([latest - H, None])
    s = summarize_rainfall(rows, days=7, now_ms=latest + 30 * H)
    assert s["latestDataAt"] == latest
    assert s["lagHours"] == 30.0
    assert s["totals"] == {"h24": 24.0, "h72": 72.0, "d7": 168.0}
    assert len(s["hours"]) == 24 * 7
    assert s["hours"][0][0] < s["hours"][-1][0]


def test_rainfall_empty():
    s = summarize_rainfall([], 7, 0)
    assert s["latestDataAt"] is None and s["hours"] == []


def test_series_merge_dedupes_by_scene_and_drops_old():
    now = 1_791_000_000_000
    day = 86_400_000
    existing = [
        {"t": now - 500 * day, "scene": "old", "km2": 9.0, "source": "S1"},
        {"t": now - 20 * day, "scene": "a", "km2": 9.0, "source": "S1"},
    ]
    new = [
        {"t": now - 20 * day, "scene": "a", "km2": 9.5, "source": "S1"},
        {"t": now - 2 * day, "scene": "b", "km2": 9.7, "source": "S2"},
    ]
    out = merge_series(existing, new, now)
    assert [e["scene"] for e in out] == ["a", "b"]
    assert out[0]["km2"] == 9.5
