import json
import pathlib

import pytest

from ingest import NUMERIC_FIELDS, PayloadError, key_ok, validate

RULES = json.loads((pathlib.Path(__file__).parents[2] / "database.rules.json").read_text())
READING_RULES = RULES["rules"]["water_monitor"]["current"]["$readingId"]


def test_accepts_the_exact_payload_the_a7670c_firmware_sends():
    body = '{"distance":1771,"pressure":902.11,"temperature":24.5,"height":0.12,"timestamp":{".sv":"timestamp"}}'
    assert validate(json.loads(body)) == {"distance": 1771, "pressure": 902.11, "temperature": 24.5, "height": 0.12}


def test_accepts_the_exact_payload_the_ec200u_firmware_sends():
    body = '{"distance":1771,"battery_voltage":4.02,"signal_strength":18,"timestamp":{".sv":"timestamp"}}'
    assert validate(json.loads(body)) == {"distance": 1771, "battery_voltage": 4.02, "signal_strength": 18}


def test_distance_only_payload_like_the_live_feed():
    assert validate({"distance": 1771, "timestamp": {".sv": "timestamp"}}) == {"distance": 1771}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"timestamp": 1},
        {"distance": -1},
        {"distance": 20001},
        {"distance": "1771"},
        {"distance": True},
        {"distance": float("nan")},
        {"distance": 1000, "battery_voltage": 21},
        {"distance": 1000, "signal_strength": 99},
        {"distance": 1000, "injected": 1},
        [1, 2],
        None,
    ],
)
def test_rejects_bad_payloads(body):
    with pytest.raises(PayloadError):
        validate(body)


def test_key_check():
    assert key_ok("abc", "abc")
    assert not key_ok("abd", "abc")
    assert not key_ok(None, "abc")
    assert not key_ok("abc", None)
    assert not key_ok("", "")


def test_fields_match_the_database_rules():
    rule_fields = {k for k in READING_RULES if not k.startswith(("$", "."))} - {"timestamp"}
    assert rule_fields == set(NUMERIC_FIELDS)
