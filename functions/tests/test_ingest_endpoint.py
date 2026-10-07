import json

import pytest
from flask import Flask

import main


class FakeRef:
    pushed = []

    def __init__(self, path):
        self.path = path

    def push(self, value):
        FakeRef.pushed.append((self.path, value))
        return type("R", (), {"key": "-FAKEKEY"})()


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setenv("DEVICE_INGEST_KEY", "s3cret")
    monkeypatch.setattr(main.db, "reference", lambda path, app=None: FakeRef(path))
    monkeypatch.setattr(main, "app", lambda: None)
    FakeRef.pushed.clear()


def call(method="POST", query="?key=s3cret", body='{"distance":1771,"timestamp":{".sv":"timestamp"}}', headers=None):
    flask_app = Flask(__name__)
    with flask_app.test_request_context("/ingest" + query, method=method, data=body, headers=headers or {}, content_type="application/json"):
        from flask import request

        return main.ingest(request)


def test_accepts_firmware_post_and_stamps_server_time():
    resp = call()
    assert resp.status_code == 200
    assert json.loads(resp.get_data()) == {"name": "-FAKEKEY"}
    assert FakeRef.pushed == [("water_monitor/current", {"distance": 1771, "timestamp": {".sv": "timestamp"}})]


def test_key_in_header_also_works():
    assert call(query="", headers={"X-Device-Key": "s3cret"}).status_code == 200


@pytest.mark.parametrize("query", ["", "?key=wrong", "?key="])
def test_rejects_missing_or_wrong_key(query):
    assert call(query=query).status_code == 401
    assert FakeRef.pushed == []


def test_rejects_get():
    assert call(method="GET").status_code == 405


@pytest.mark.parametrize("body", ["", "not json", '{"distance":-5}', '{"distance":1,"x":2}'])
def test_rejects_bad_body(body):
    assert call(body=body).status_code == 400
    assert FakeRef.pushed == []
