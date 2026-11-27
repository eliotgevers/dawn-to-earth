"""Index the workspace's synthetic recordings or verify their existing Grafana projections."""
import argparse
from functools import partial
from math import isclose
import os

import exchange_events
import inspection
import measurements
from archives import archive_sources, project
from services import service_url, settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("sync", "verify"))
    parser.add_argument("--app-port", type=int)
    args = parser.parse_args()
    app = service_url(f"http://127.0.0.1:{args.app_port}" if args.app_port is not None
                      else os.getenv("APP_URL", "http://127.0.0.1:4317"))
    config = settings()
    records = archive_sources(app)

    project(args.action, config, inspection.fetch_frames(app), inspection.verify_dashboard,
            "inspection_frame", inspection.TAGS, "frame", elapsed=inspection.frame_clock,
            floats_equal=partial(isclose, abs_tol=1e-10))

    exchanges = exchange_events.registered_editions(records)
    if exchanges:
        project(args.action, config, exchanges, exchange_events.verify, "exchange_event", exchange_events.TAGS, "event_id")
    else:
        print("No archived Electronics exchanges in this workspace.")

    project(args.action, config, measurements.registered_series(records), measurements.verify,
            "evidence_sample", measurements.TAGS, "sample_id")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError) as error:
        raise SystemExit(str(error)) from None
