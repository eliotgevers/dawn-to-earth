"""Read archived sources and check their edition-scoped Grafana dashboards."""
import hashlib
import json
import re
from operator import eq, itemgetter

from datetime import datetime, timedelta, timezone
from services import BUCKET, grafana_admin, grafana_frames, influx_rows, json_request, write_points


DISPLAY_ORIGIN = 1767225600000  # UTC 2026-01-01; archives record relative time.
KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}")


def valid_key(value):
    return isinstance(value, str) and KEY.fullmatch(value) is not None


def archive_sources(app_url):
    return json_request("Archive sources", app_url + "/api/records?view=archives")


def registered_sources(workspace, method=None):
    configurations = {(u["serial"], c["revisionId"]) for u in workspace["units"] for c in u["configurations"]}
    archived = set(workspace["archivedUnits"])
    removed = {(a["test"], a["action"]["parentId"], *scope_of(a["action"]["unit"]))
               for a in workspace.get("activity", []) if a.get("kind") == "evidence" and a.get("test")
               and (method is None or a["test"] == method)
               and (a.get("action") or {}).get("type") == "remove" and a["action"].get("unit")}
    sources = (record for record in workspace["sources"] if method is None or record["test"] == method)

    def registered_scope(record, *, historical=False):
        scope = scope_of(record.get("unit"))
        if scope not in configurations:
            raise ValueError("Archived source has no matching unit configuration: " + record["id"])
        if historical or (scope[0] not in archived and (record["test"], record["id"], *scope) not in removed):
            return scope

    return sources, registered_scope


def scope_of(unit):
    if not isinstance(unit, dict) or not all(valid_key(unit.get(k)) for k in ("serial", "revisionId")):
        raise ValueError("An archived source needs an explicit serial and revision")
    return unit["serial"], unit["revisionId"]


def register_point(seen, identity, elapsed):
    if (not valid_key(identity) or identity in seen
            or type(elapsed) is not int or not 0 <= elapsed < 86_400_000):
        raise ValueError("Repeated or invalid point ID or elapsed clock: " + str(identity))
    seen.add(identity)


def quote(value):
    if not isinstance(value, str) or not value or any(ord(char) < 32 for char in value):
        raise ValueError("Invalid archived text")
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def edition_id(name, basis):
    content = json.dumps(basis, ensure_ascii=False, separators=(",", ":")).encode()
    return name + "~" + hashlib.sha256(content).hexdigest()


def projection_lines(measurement, tags, runs, elapsed=itemgetter("elapsed_ms")):
    def literal(value):
        if isinstance(value, str):
            return quote(value)
        return str(value) + "i" if type(value) is int else str(value)

    for rows in runs.values():
        for row in rows:
            identity = ",".join(f"{k}={row[k]}" for k in tags)
            fields = ",".join(f"{k}={literal(v)}" for k, v in row.items() if k not in tags)
            yield f"{measurement},{identity} {fields} {DISPLAY_ORIGIN + elapsed(row)}"


def verify_projection(influx, token, runs, measurement, identity, elapsed, floats_equal):
    query = f'''from(bucket: "{BUCKET}") |> range(start: 2026-01-01T00:00:00Z, stop: 2026-01-02T00:00:00Z)
        |> filter(fn: (r) => r._measurement == "{measurement}")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value") |> group()'''
    expected = {(edition, str(row[identity])): row for edition, rows in runs.items() for row in rows}
    origin = datetime.fromtimestamp(DISPLAY_ORIGIN // 1000, timezone.utc)
    for stored in influx_rows(influx, token, query):
        if stored.get("edition") not in runs:
            continue  # Older editions stay available to historical links.
        key = stored["edition"], stored[identity]
        row = expected.pop(key, None)
        if row is None or datetime.fromisoformat(stored["_time"].replace("Z", "+00:00")) != origin + timedelta(milliseconds=elapsed(row)):
            raise ValueError("Duplicate or mismatched source clock: " + str(key))
        for field, value in row.items():
            actual = stored[field]
            equal = floats_equal(float(actual), value) if isinstance(value, float) else actual == str(value)
            if not equal:
                raise ValueError(f"Stored {field} differs from source: {key}")
    if expected:
        raise ValueError("Missing archived reading: " + str(next(iter(expected))))


def project(action, config, runs, verify, measurement, tags, identity, *, elapsed=itemgetter("elapsed_ms"), floats_equal=eq):
    env, influx, grafana = config
    token = env["INFLUXDB_TOKEN"]
    if action == "sync":
        write_points(influx, token, projection_lines(measurement, tags, runs, elapsed))

    verify_projection(influx, token, runs, measurement, identity, elapsed, floats_equal)
    verify(grafana, env["GRAFANA_ADMIN_PASSWORD"], runs)


def dashboard(grafana, password, uid):
    headers = grafana_admin(password)
    result = json_request("Provisioned dashboard " + uid, grafana + "/api/dashboards/uid/" + uid, headers)
    if not result["meta"]["provisioned"] or result["dashboard"]["uid"] != uid:
        raise ValueError("Dashboard is not provisioned: " + uid)
    return headers, result["dashboard"]["panels"]


def panel_rows(grafana, headers, panel, edition, start_ms, stop_ms, selection=(0, 86400000)):
    editions = [edition] if isinstance(edition, str) else edition
    escaped = (re.escape(key).replace(r"\-", "-").replace(r"\~", "~") for key in editions)
    expression = "(" + "|".join(escaped) + ")"
    start, stop = selection
    targets = [{**t, "query": t["query"].replace("${edition:regex}", expression)
                     .replace("${windowStart}", str(start)).replace("${windowStop}", str(stop)),
                "intervalMs": 1, "maxDataPoints": 2000} for t in panel["targets"]]
    for fields, columns in grafana_frames(grafana, headers, targets, start_ms, stop_ms):
        names = [field["name"] for field in fields]
        yield from (dict(zip(names, values)) for values in zip(*columns))
