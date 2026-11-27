#!/bin/sh
set -eu

case "$1" in
  grants)
    python3 scripts/viewer.py --influx-only
    chown 472:472 "$GRAFANA_INFLUX_TOKEN_FILE"
    chown 1000:1000 "$DTE_VIEWER_FILE"
    ;;
  sync)
    python3 scripts/viewer.py
    chown 1000:1000 "$DTE_VIEWER_FILE"
    exec python3 scripts/sync.py sync
    ;;
  *) exit 2 ;;
esac
