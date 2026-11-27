"""File one prerecorded, fictional Electronics display-counter run in a local workspace."""

import argparse
from http.client import HTTPConnection
import json
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-port", type=int, default=4317, help="local web app port (default: 4317)")
    args = parser.parse_args()
    if not 1 <= args.app_port <= 65535:
        parser.error("choose a port between 1 and 65535")

    token = os.environ.get("BENCH_INGEST_TOKEN")
    if not token:
        parser.exit(1, "Set BENCH_INGEST_TOKEN in the sender's environment.\n")

    origin = f"http://127.0.0.1:{args.app_port}"
    payload = {
        "sourceId": "communication-exception-note",
        "fileName": "lk-014-display-counter.json",
        "recording": {
            "title": "LK-014 display paused at two before advancing to three",
            "serial": "LK-014",
            "revisionId": "bench-a",
            "channel": "display_count",
            "samples": [[0, 0], [120, 1], [240, 2], [360, 2], [480, 3]],
        },
    }
    connection = HTTPConnection("127.0.0.1", args.app_port, timeout=10)
    try:
        connection.request("POST", "/api/bench-ingest", json.dumps(payload), {
            "Authorization": "Bearer " + token, "Content-Type": "application/json",
        })
        response = connection.getresponse()
        if not 200 <= response.status < 300:
            raise SystemExit(f"Bench ingest returned HTTP {response.status}.")
        receipt = json.load(response)
    finally:
        connection.close()

    print("Evidence:", origin + receipt["evidenceUrl"])
    if receipt["grafanaUrl"]:
        print("Grafana:", receipt["grafanaUrl"])


if __name__ == "__main__":
    main()
