"""Validation for the device ingest endpoint.

The device used to POST straight to the Realtime Database, which meant the
database had to accept writes from anyone. It now POSTs to the `ingest`
function with a key only it holds; the function checks the key and the payload
and writes with the Admin SDK, so the database itself can refuse all public
writes (database.rules.locked.json).

The checks here mirror database.rules.json exactly. The Admin SDK bypasses
rules, so if this file and the rules disagree, this file wins.
"""

from __future__ import annotations

import hmac
import math
from typing import Any

# field -> (min, max); None means no bound. Same ranges as database.rules.json.
NUMERIC_FIELDS: dict[str, tuple[float | None, float | None]] = {
    "distance": (0, 20000),
    "pressure": (None, None),
    "temperature": (None, None),
    "height": (None, None),
    "battery_voltage": (0, 20),
    "signal_strength": (0, 31),
}
REQUIRED = ("distance",)
# The firmware sends {"timestamp": {".sv": "timestamp"}}. It is accepted and
# ignored: the function always stamps server time itself.
IGNORED = ("timestamp",)


class PayloadError(ValueError):
    pass


def key_ok(provided: str | None, expected: str | None) -> bool:
    """Constant-time key check. An unset server key rejects everything."""
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())


def validate(payload: Any) -> dict[str, float]:
    """Returns the cleaned reading, or raises PayloadError with a short reason."""
    if not isinstance(payload, dict):
        raise PayloadError("body must be a JSON object")

    unknown = set(payload) - set(NUMERIC_FIELDS) - set(IGNORED)
    if unknown:
        raise PayloadError(f"unknown field(s): {', '.join(sorted(unknown))}")

    for name in REQUIRED:
        if name not in payload:
            raise PayloadError(f"missing field: {name}")

    clean: dict[str, float] = {}
    for name, (lo, hi) in NUMERIC_FIELDS.items():
        if name not in payload:
            continue
        value = payload[name]
        # bool is an int subclass in Python; the database would not treat it as a number.
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise PayloadError(f"{name} must be a number")
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            raise PayloadError(f"{name} out of range")
        clean[name] = value
    return clean
