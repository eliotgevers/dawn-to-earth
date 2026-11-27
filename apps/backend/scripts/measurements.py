"""Sync source-owned numeric registers with recorded elapsed times into the local projection."""
import math
import struct

from archives import (DISPLAY_ORIGIN, valid_key, registered_sources, dashboard, edition_id, panel_rows,
                      quote, register_point)

UID = "dte-recorded-series"
TAGS = ("method", "source_id", "serial", "revision", "series_id", "edition", "sample_id")


def native_series(identity, series):
    if not all(map(valid_key, identity)):
        raise ValueError("Invalid recorded measurement identity")
    source, quantity, unit = (series[key] for key in ("source", "quantity", "unit"))
    for field in (source, quantity, unit):
        quote(field)
    points, seen = [], set()
    for point in series["points"]:
        sample, elapsed, value, locator = (point[k] for k in ("id", "elapsedMs", "value", "locator"))
        register_point(seen, sample, elapsed)
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Invalid recorded value: " + sample)
        quote(locator)
        points.append([sample, elapsed, struct.pack(">d", value).hex(), locator])
    if not points:
        raise ValueError("An edition must contain an original observation: " + series["editionId"])
    edition = edition_id(series["editionId"], [*identity, source, quantity, unit, points])
    tags = dict(zip(TAGS, [*identity, edition]))
    rows = [{**tags, "sample_id": point["id"], "value": float(point["value"]), "elapsed_ms": point["elapsedMs"],
             "source_row": index, "locator": point["locator"], "quantity": quantity, "unit": unit, "source": source}
            for index, point in enumerate(series["points"], 1)]
    return edition, sorted(rows, key=lambda row: row["elapsed_ms"])


def registered_series(workspace):
    evidence, registered_scope = registered_sources(workspace)
    editions = {}
    for record in evidence:
        series_list = record.get("numericSeries", [])
        if not series_list:
            continue
        scope = registered_scope(record)
        if not scope:
            continue
        for series in series_list:
            identity = (record["test"], record["id"], *scope, series["editionId"])
            run = native_series(identity, series)
            if editions.setdefault(identity, run)[0] != run[0]:
                raise ValueError("Conflicting measurements for the same registered edition: " + series["editionId"])
    return dict(editions.values())


def verify(grafana, admin, runs):
    headers, panels = dashboard(grafana, admin, UID)
    table = next(panel for panel in panels if panel["type"] == "table")
    chart = next(panel for panel in panels if panel["type"] == "xychart")
    for edition, rows in runs.items():
        start = DISPLAY_ORIGIN + rows[0]["elapsed_ms"]
        stop = DISPLAY_ORIGIN + rows[-1]["elapsed_ms"] + 1
        if list(panel_rows(grafana, headers, table, edition, start, stop)) != rows:
            raise ValueError("Grafana register differs from the source edition: " + edition)
        middle = rows[len(rows) // 2]["elapsed_ms"]
        at = DISPLAY_ORIGIN + middle
        selected = list(panel_rows(grafana, headers, table, edition, at, at + 1))
        if selected != [r for r in rows if r["elapsed_ms"] == middle]:
            raise ValueError("Grafana window dropped or mixed coincident readings: " + edition)
        label = f'{rows[0]["quantity"]} ({rows[0]["unit"]})'
        plotted = [(r["Elapsed ms"], r[label]) for r in panel_rows(grafana, headers, chart, edition, start, stop)]
        if plotted != [(r["elapsed_ms"], r["value"]) for r in rows]:
            raise ValueError("Grafana measurement markers differ from source values: " + edition)

    print(f"{sum(map(len, runs.values()))} recorded readings across {len(runs)} source-owned measurement editions.")
