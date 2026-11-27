"""HTTP and credential access for the archive importer and viewer grants."""

import base64
import csv
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
ORG = "dawn-to-earth"
BUCKET = "synthetic"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = build_opener(ProxyHandler({}), NoRedirect())


def request(label, url, headers=None, body=None):
    try:
        with HTTP.open(Request(url, data=body, headers=headers or {}), timeout=10) as response:
            return response.read().decode("utf-8")
    except HTTPError as error:
        raise SystemExit(f"{label} returned HTTP {error.code}.") from None
    except URLError as error:
        raise SystemExit(f"{label} could not reach {url}: {error.reason}") from None


def json_request(label, url, headers=None, body=None):
    payload = None if body is None else json.dumps(body).encode()
    response = request(label, url, {"Content-Type": "application/json", **(headers or {})}, payload)
    return json.loads(response) if response else None


def grafana_admin(password):
    return {"Authorization": "Basic " + base64.b64encode(("admin:" + password).encode()).decode()}


def read_env(file):
    return dict(line.split("=", 1) for line in file.read_text().splitlines()
                if "=" in line and not line.startswith("#"))


def service_url(value):
    parts = urlsplit(value)
    if (parts.scheme not in ("http", "https") or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment):
        raise ValueError("Expected an HTTP service URL without credentials, query or fragment")
    return value.rstrip("/")


def settings(*, influx_only=False):
    stored = read_env(ENV_FILE) if ENV_FILE.exists() else {}
    env = {}
    required = ("INFLUXDB_TOKEN",) if influx_only else ("INFLUXDB_TOKEN", "GRAFANA_ADMIN_PASSWORD")
    for key in required:
        secret_file = os.environ.get(key + "_FILE")
        env[key] = Path(secret_file).read_text().strip() if secret_file else os.environ.get(key, stored.get(key))
        if not env[key]:
            raise SystemExit("Bootstrap credential missing: " + key)

    # Native scripts retain the port overrides. Compose jobs talk to service names on the internal network.
    for key, default in (("INFLUXDB_PORT", "48086"), ("GRAFANA_PORT", "43000")):
        env[key] = os.environ.get(key, stored.get(key)) or default
    influx = os.environ.get("INFLUXDB_URL") or f"http://127.0.0.1:{int(env['INFLUXDB_PORT'])}"
    grafana = os.environ.get("GRAFANA_URL") or f"http://127.0.0.1:{int(env['GRAFANA_PORT'])}"
    return env, service_url(influx), service_url(grafana)


def grafana_frames(grafana, headers, queries, start, stop):
    result = json_request("Grafana data source query", grafana + "/api/ds/query", headers,
                          {"from": str(start), "to": str(stop), "queries": queries})
    for series in result["results"].values():
        if series.get("error"):
            raise ValueError("Grafana data source query failed.")
        for frame in series.get("frames", []):
            yield frame["schema"]["fields"], frame["data"]["values"]


def influx_rows(influx, token, query):
    data = request(
        "InfluxDB query", influx + "/api/v2/query?" + urlencode({"org": ORG}),
        {"Authorization": "Token " + token, "Content-Type": "application/json", "Accept": "text/csv"},
        json.dumps({"query": query, "dialect": {"annotations": []}}).encode(),
    )
    return csv.DictReader(data.splitlines())


def write_points(influx, token, points):
    body = "\n".join(points)
    if body:
        request("InfluxDB write", influx + "/api/v2/write?" + urlencode({"org": ORG, "bucket": BUCKET, "precision": "ms"}),
                {"Authorization": "Token " + token, "Content-Type": "text/plain; charset=utf-8"}, body.encode())
