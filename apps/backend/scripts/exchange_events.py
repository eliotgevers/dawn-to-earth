"""Project archived input and reply events into the local elapsed-clock viewer."""
from archives import (DISPLAY_ORIGIN, valid_key, registered_sources, dashboard, edition_id, panel_rows,
                      quote, register_point, scope_of)

UID = "dte-exchange-events"
TAGS = ("source_id", "serial", "revision", "archive_id", "run_id", "edition", "event_id", "kind")


def event_series(record, archive, log):
    scope = [record["id"], record["unit"]["serial"], record["unit"]["revisionId"], archive["id"], log["id"]]
    if not all(map(valid_key, scope)):
        raise ValueError("Invalid archive identity")
    rows = []
    seen = set()
    for event in log["events"]:
        kind = event["kind"]
        if kind not in ("request", "reply"):
            raise ValueError("Unknown archived event kind")
        row = [event["id"], event["key"], event["document"], event["atMs"], kind,
               event["expected" if kind == "request" else "value"]]
        register_point(seen, row[0], row[3])
        for text in (row[1], row[2], row[5]):
            quote(text)
        rows.append(row)
    if not rows:
        raise ValueError("Cannot project an empty event log")
    edition = edition_id(log["id"], [*scope, rows])
    tags = dict(zip(TAGS, [*scope, edition]))
    register = [{**tags, "event_id": event_id, "kind": kind, "elapsed_ms": elapsed, "export_row": index,
                 "correlation": key, "document": document, "entry": entry}
                for index, (event_id, key, document, elapsed, kind, entry) in enumerate(rows, 1)]
    return edition, sorted(register, key=lambda row: row["elapsed_ms"])


def registered_editions(workspace):
    evidence, registered_scope = registered_sources(workspace, "communication")
    runs, sources = {}, {}
    def include(record, archive):
        if archive["prior"]["id"] == archive["current"]["id"]:
            raise ValueError("Original and revised logs need distinct identities: " + record["id"])
        for log in (archive["prior"], archive["current"]):
            edition, register = event_series(record, archive, log)
            runs.setdefault(edition, register)

    for record in evidence:
        source = record["id"]
        previous = sources.get(source)
        if previous and (previous.get("exchangeArchive") != record.get("exchangeArchive") or
                         record.get("exchangeArchive") and scope_of(previous.get("unit")) != scope_of(record.get("unit"))):
            raise ValueError("Conflicting exchange source registrations: " + source)
        sources[source] = record
        archive = record.get("exchangeArchive")
        if archive and registered_scope(record):
            include(record, archive)

    # A finding pins its original editions. Replay them after correction/removal without
    # mistaking the note ID or a newer edition for the original source evidence.
    for entry in workspace.get("activity", []):
        action, finding = entry.get("action") or {}, entry.get("eventFinding")
        if entry.get("kind") != "evidence" or entry.get("test") != "communication" or action.get("type") != "note" or not finding:
            continue
        source = sources.get(action["parentId"])
        scope = scope_of(action.get("unit"))
        if not source or registered_scope(source, historical=True) != scope:
            raise ValueError("Pinned exchange finding does not belong to its source")
        if entry.get("matchesSource") is not True:
            raise ValueError("Pinned exchange event identifiers differ from the source")
        include(source, finding["archive"])
    return runs


def verify(grafana, password, runs):
    headers, panels = dashboard(grafana, password, UID)
    chart = next(panel for panel in panels if panel["type"] == "xychart")
    table = next(panel for panel in panels if panel["type"] == "table")
    for edition, expected in runs.items():
        start = DISPLAY_ORIGIN - 1
        stop = DISPLAY_ORIGIN + expected[-1]["elapsed_ms"] + 2
        tick = expected[len(expected) // 2]["elapsed_ms"]
        for selection in ((0, 86400000), (tick, tick + 1)):
            selected = [row for row in expected if selection[0] <= row["elapsed_ms"] < selection[1]]
            rows = list(panel_rows(grafana, headers, table, edition, start, stop, selection))
            if rows != selected:
                raise ValueError("Grafana selection differs from archived events in " + edition)
            markers = []
            for row in panel_rows(grafana, headers, chart, edition, start, stop, selection):
                # The XY plugin paints null numeric cells at zero. Each frame must contain one
                # actual series so a chart cannot gain a marker the document did not record.
                labels = [key for key in ("Selected request", "Selected reply", "Surrounding events") if key in row]
                if len(labels) != 1 or row[labels[0]] is None:
                    raise ValueError("A chart row contains a missing position in " + edition)
                label = labels[0]
                markers.append((row["Elapsed ms"], row[label], label))
            markers.sort()
            source = sorted((r["elapsed_ms"], r["export_row"],
                             ("Selected " + r["kind"]) if r in selected else "Surrounding events")
                            for r in expected)
            if markers != source:
                raise ValueError("Grafana markers differ from selected events or context in " + edition)
        print(f"{expected[0]['serial']} · {expected[0]['run_id']}: {len(expected)} identified events verified in clock order.")

    sources = {rows[0]["source_id"] for rows in runs.values()}
    print(f"Verified {sum(map(len, runs.values()))} source events in {len(runs)} editions across {len(sources)} evidence records.")
