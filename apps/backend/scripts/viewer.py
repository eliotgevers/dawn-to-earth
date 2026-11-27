"""Provision local Grafana viewer and separate bucket-scoped Influx read and import credentials."""
import argparse
import fcntl
import os
from pathlib import Path
import secrets
import tempfile
import time
from urllib.parse import urlencode

from services import BUCKET, ORG, ROOT, grafana_admin, influx_rows, json_request, read_env, settings

FILE = Path(os.environ.get("DTE_VIEWER_FILE", ROOT / ".env.viewer"))


def write_secret_file(path, text):
    # Atomic replacement lets the concurrently running web app read either complete configuration.
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=path.name + ".", delete=False) as tmp:
        try:
            tmp.write(text)
            tmp.flush()
            os.replace(tmp.name, path)
        finally:
            Path(tmp.name).unlink(missing_ok=True)


def write_viewer(values):
    write_secret_file(FILE, "".join(f"{key}={value}\n" for key, value in values.items()))


def provision(influx_only=False):
    env, influx, grafana = settings(influx_only=influx_only)
    with os.fdopen(os.open(str(FILE) + ".lock", os.O_RDWR | os.O_CREAT, 0o600), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        existing = read_env(FILE) if FILE.exists() else {}
        tokens = ("INFLUXDB_READER_TOKEN", "INFLUXDB_WRITER_TOKEN", "GRAFANA_VIEWER_TOKEN")
        values = {key: existing[key] for key in tokens if key in existing}
        values.update({key: env[key] for key in ("INFLUXDB_PORT", "GRAFANA_PORT")})
        if not all(values.get(key) for key in tokens[:2]):
            admin = {"Authorization": "Token " + env["INFLUXDB_TOKEN"]}
            buckets = json_request("Read project bucket", influx + "/api/v2/buckets?" + urlencode({"org": ORG, "name": BUCKET}), admin)["buckets"]
            if len(buckets) != 1 or buckets[0]["name"] != BUCKET:
                raise SystemExit("The expected local inspection bucket was not found.")
            bucket = buckets[0]
            for key, action in (("INFLUXDB_READER_TOKEN", "read"), ("INFLUXDB_WRITER_TOKEN", "write")):
                if values.get(key):
                    continue
                permit = {"action": action, "resource": {"type": "buckets", "id": bucket["id"], "orgID": bucket["orgID"]}}
                grant = json_request("Provision archive " + action, influx + "/api/v2/authorizations", admin,
                            {"description": "Dawn to Earth archive " + action, "orgID": bucket["orgID"], "permissions": [permit]})
                values[key] = grant["token"]
                write_viewer(values)
        query = f'from(bucket:"{BUCKET}") |> range(start:-1h) |> filter(fn:(r) => r._measurement=="inspection_frame") |> limit(n:1)'
        influx_rows(influx, values["INFLUXDB_READER_TOKEN"], query)

        # Grafana mounts only this read grant. The application's import grant stays in its own volume.
        reader_path = os.environ.get("GRAFANA_INFLUX_TOKEN_FILE")
        if reader_path:
            reader = values["INFLUXDB_READER_TOKEN"]
            if reader in (env["INFLUXDB_TOKEN"], values["INFLUXDB_WRITER_TOKEN"]):
                raise SystemExit("Grafana requires a separate bucket reader.")
            destination = Path(reader_path)
            if not destination.exists() or destination.read_text().strip() != reader:
                write_secret_file(destination, reader + "\n")
        if influx_only:
            if existing != values:
                write_viewer(values)
            print("Verified the synthetic bucket reader and configured the separate import writer.")
            return

        if not values.get("GRAFANA_VIEWER_TOKEN"):
            name = "dte-archive-viewer"
            admin = grafana_admin(env["GRAFANA_ADMIN_PASSWORD"])
            found = json_request("Read local service accounts", grafana + "/api/serviceaccounts/search?" + urlencode({"query": name}), admin)
            account = next((a for a in found["serviceAccounts"] if a["name"] == name), None)
            if account is None:
                account = json_request("Provision archive viewer", grafana + "/api/serviceaccounts", admin,
                              {"name": name, "role": "Viewer", "isDisabled": False})
            if account["role"] != "Viewer" or account.get("isDisabled"):
                raise SystemExit("The local archive viewer account must have the Viewer role and be enabled.")
            grant = json_request("Provision viewer token", grafana + f"/api/serviceaccounts/{int(account['id'])}/tokens", admin,
                        {"name": "archive-reader-" + secrets.token_hex(5)})
            values["GRAFANA_VIEWER_TOKEN"] = grant["key"]
            write_viewer(values)
        # File provisioning can finish after the Grafana health endpoint reports ready.
        viewer = {"Authorization": "Bearer " + values["GRAFANA_VIEWER_TOKEN"]}
        deadline = time.monotonic() + 40
        for uid in ("dte-inspection-frames", "dte-exchange-events", "dte-recorded-series"):
            while True:
                try:
                    json_request("Read provisioned dashboard " + uid, grafana + "/api/dashboards/uid/" + uid, viewer)
                    break
                except SystemExit as error:
                    if not str(error).endswith("HTTP 404.") or time.monotonic() >= deadline:
                        raise
                    time.sleep(1)
        # Issued tokens were saved immediately so a failed second grant can be retried safely.
        if all(existing.get(key) for key in tokens) and existing != values:
            write_viewer(values)
        print("Verified local archive reader and Grafana Viewer; the import writer is configured for the synthetic bucket.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--influx-only", action="store_true", help="Provision the Influx grants before starting Grafana")
    provision(parser.parse_args().influx_only)
