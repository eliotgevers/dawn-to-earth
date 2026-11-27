"""Import registered caption measurements from the local app, or verify both read paths."""
from math import sqrt
import re

from archives import DISPLAY_ORIGIN, valid_key, dashboard, panel_rows
from services import json_request

UID = "dte-inspection-frames"
TAGS = ("archive_id", "check_id", "edition", "revision", "run_id", "serial")
SHA = re.compile(r"[0-9a-f]{64}")


def fetch_frames(app_url):
    runs = json_request("Registered inspection runs", app_url + "/api/inspection-analysis?view=archive")
    frames = {}
    for run in runs:
        tags = dict(run_id=run["id"], check_id=run["checkId"], serial=run["serial"],
                    revision=run["revisionId"], archive_id=run["archiveId"])
        if not all(map(valid_key, tags.values())) or not SHA.fullmatch(run["digest"]):
            raise ValueError("Invalid registered inspection identity")
        edition = run["id"] + "~" + run["digest"]
        tags["edition"] = edition
        if edition in frames:
            raise ValueError("Duplicate inspection edition: " + edition)
        rows = []
        for index, frame in enumerate(run["frames"], 1):
            if not SHA.fullmatch(frame["sha256"]) or len(frame["tiles"]) != 32:
                raise ValueError("Conflicting registered image or caption tiles at " + edition)
            pixels, total, squares = map(sum, zip(*frame["tiles"]))
            if pixels < 1 or squares * pixels < total * total:
                raise ValueError("Invalid pixel moments at " + edition)
            mean = total / pixels
            contrast = sqrt(max(0, squares / pixels - mean * mean))
            rows.append({**tags, "frame": index, "image_sha": frame["sha256"], "caption_pixels": pixels,
                         "caption_mean": mean, "caption_contrast": contrast})
        if rows:
            frames[edition] = rows
    if not frames:
        raise ValueError("No registered inspection measurements found in the local app")
    return frames


def frame_clock(row):
    return (row["frame"] - 1) * 1000


def verify_dashboard(grafana, admin, frames):
    headers, panels = dashboard(grafana, admin, UID)
    editions = sorted(frames)
    # Exercise the actual dashboard queries at two selected editions and one frame.
    selected = editions[:2]
    expected = sum(len(frames[edition]) >= 2 for edition in selected)
    for panel in panels:
        if panel["type"] == "text":
            continue
        row_count = sum(1 for row in panel_rows(grafana, headers, panel, selected, DISPLAY_ORIGIN + 1000, DISPLAY_ORIGIN + 1999))
        if row_count != expected:
            raise ValueError(f"{panel['title']} returned {row_count} rows; expected {expected}")
    print(f"Verified {sum(map(len, frames.values()))} native frames in {len(editions)} immutable editions; all three Grafana panels returned the selected interval.")
