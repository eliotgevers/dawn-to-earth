import type { IndexedSeries } from "@/components/verification/numeric-series";
import type { EventProjection } from "@/components/verification/document-exchanges";
import { frameEpoch } from "@/lib/evidence/traces";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

type Dashboard = "dte-inspection-frames" | "dte-exchange-events" | "dte-recorded-series";
const getOptions = () =>
  ({ cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) }) as const;

function loopbackUrl(value: string | undefined, fallback: number) {
  const port = value ? Number(value) : fallback;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local service port");

  return "http://127.0.0.1:" + port;
}

// Internal origins and browser destinations can differ behind an ingress path.
function serviceUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Expected an HTTP service URL without credentials, query or fragment");
  }

  return url.href.replace(/\/+$/, "");
}

export function hasPublicInflux() {
  if (process.env.GRAFANA_ARCHIVE_QUERY === "true") return false;
  // Only native development implicitly exposes the loopback console.
  return process.env.INFLUXDB_PUBLIC_URL === undefined
    ? !process.env.INFLUXDB_URL
    : Boolean(process.env.INFLUXDB_PUBLIC_URL);
}

export async function readerConfiguration() {
  // Bootstrap writes this dedicated reader file. Compose administrator credentials stay separate.
  const cwd = process.cwd();
  const dir =
    path.basename(cwd) === "web" ? path.resolve(cwd, "../backend") : path.resolve(cwd, "apps/backend");
  const file = process.env.DTE_VIEWER_FILE || path.join(dir, ".env.viewer");
  const text = await readFile(file, "utf8").catch(() => "");
  const config = parseEnv(text);
  const nativeGrafana = loopbackUrl(process.env.GRAFANA_PORT ?? config.GRAFANA_PORT, 43000);
  const nativeInflux = loopbackUrl(process.env.INFLUXDB_PORT ?? config.INFLUXDB_PORT, 48086);
  const publicInflux = process.env.INFLUXDB_PUBLIC_URL ?? nativeInflux;

  return {
    grafanaUrl: serviceUrl(process.env.GRAFANA_URL || process.env.GRAFANA_PUBLIC_URL || nativeGrafana),
    influxUrl: serviceUrl(process.env.INFLUXDB_URL || nativeInflux),
    grafanaPublicUrl: serviceUrl(process.env.GRAFANA_PUBLIC_URL || nativeGrafana),
    influxPublicUrl: hasPublicInflux() ? serviceUrl(publicInflux) : null,
    grafanaToken: process.env.GRAFANA_VIEWER_TOKEN ?? config.GRAFANA_VIEWER_TOKEN,
    influxWriter: process.env.INFLUXDB_WRITER_TOKEN ?? config.INFLUXDB_WRITER_TOKEN,
    influxToken: process.env.INFLUXDB_READER_TOKEN ?? config.INFLUXDB_READER_TOKEN,
  };
}

export async function readTraceDashboard(uid: Dashboard, flux: string) {
  const config = await readerConfiguration();
  const throughGrafana = process.env.GRAFANA_ARCHIVE_QUERY === "true";
  const [grafana, rows] = await Promise.all([
    config.grafanaToken &&
      fetch(config.grafanaUrl + "/api/dashboards/uid/" + uid, {
        ...getOptions(),
        headers: { Authorization: "Bearer " + config.grafanaToken },
      })
        .then(async (response) => {
          if (!response.ok) return false;
          const info = await response.json();

          return info.meta?.provisioned === true && info.dashboard?.uid === uid;
        })
        .catch(() => false),
    throughGrafana ? queryGrafana(config.grafanaUrl, config.grafanaToken, flux) : config.influxToken &&
      fetch(config.influxUrl + "/api/v2/query?org=dawn-to-earth", {
        ...getOptions(),
        method: "POST",
        headers: {
          Authorization: "Token " + config.influxToken,
          "Content-Type": "application/json",
          Accept: "text/csv",
        },
        body: JSON.stringify({ query: flux, dialect: { header: false, annotations: [] } }),
      })
        .then(async (response) => {
          if (!response.ok) return null;
          // Each query ends in a single _value column of validated identifiers and numeric fields.
          const text = await response.text();

          return text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => line.split(",").at(-1) ?? "");
        })
        .catch(() => null),
  ]);

  return {
    grafanaPublicUrl: config.grafanaPublicUrl,
    grafana: Boolean(grafana),
    influx: Array.isArray(rows),
    rows: rows || [],
  };
}

// Hosted InfluxDB has no public endpoint. Grafana runs the same Flux query with its bucket reader.
async function queryGrafana(url: string, token: string | undefined, flux: string): Promise<string[] | null> {
  if (!token) return null;
  try {
    const response = await fetch(url + "/api/ds/query", {
      ...getOptions(), method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: String(frameEpoch), to: String(frameEpoch + 86_400_000),
        queries: [{ refId: "A", datasource: { type: "influxdb", uid: "dawn-influxdb" }, query: flux }],
      }),
    });
    if (!response.ok) return null;
    const result = (await response.json()).results?.A;
    if (!result || result.error || !Array.isArray(result.frames)) return null;

    const rows: string[] = [];
    for (const frame of result.frames) {
      const column = frame.schema.fields.findIndex((field: { type: string }) => field.type === "string");
      if (column >= 0) rows.push(...frame.data.values[column].filter((value: unknown) => typeof value === "string"));
    }
    return rows;
  } catch {
    return null;
  }
}

const identifier = /^[A-Za-z0-9_.:-]{1,160}$/;
const digest = /^[a-f0-9]{64}$/;
const fromBucket =
  'from(bucket: "synthetic") |> range(start: 2026-01-01T00:00:00Z, stop: 2026-01-02T00:00:00Z)';

// The projections have different source fields but use the same edition identity and archive clock.
export async function readRecordedEditions(kind: "exchange" | "series", ids: string[]) {
  const events = kind === "exchange";
  const requested = new Set(ids);
  const filter = ids.map(id => (id.includes("~") ? "r.edition" : "r.run_id") + ' == "' + id + '"').join(" or ");
  const measurement = events ? "exchange_event" : "evidence_sample";
  const fields = events
    ? ["export_row", "elapsed_ms", "correlation", "entry", "document"]
    : ["value", "elapsed_ms", "source_row", "locator", "quantity", "unit", "source"];
  const identity = events ? "r.event_id" : "r.sample_id";
  const position = events ? "r.export_row" : "r.source_row";
  const reading = events ? "" : ' + "|" + string(v:r.value)';
  const flux = `${fromBucket}
    |> filter(fn: (r) => r._measurement == "${measurement}" and (${filter}))
    |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> filter(fn: (r) => ${fields.map(field => "exists r." + field).join(" and ")})
    |> map(fn: (r) => ({_value: r.edition + "|" + ${identity} + "|" + string(v:${position}) + "|" + string(v:r.elapsed_ms) + "|" + string(v:uint(v:r._time))${reading}}))`;
  const dashboard = events ? "dte-exchange-events" : "dte-recorded-series";
  const { rows, ...services } = await readTraceDashboard(dashboard, flux);
  const eventsByEdition = new Map<string, EventProjection["rows"]>();
  const pointsByEdition = new Map<string, IndexedSeries["points"]>();
  for (const row of rows) {
    const [edition, id, ordinal, elapsed, ns, amount] = row.split("|");
    const [run, sha] = edition.split("~");
    const order = Number(ordinal);
    const ms = Number(elapsed);
    if (
      !(requested.has(edition) || (events && requested.has(run))) ||
      !digest.test(sha) || !identifier.test(id) ||
      !Number.isSafeInteger(order) || order < 1 ||
      !Number.isSafeInteger(ms) || ms < 0 ||
      String(frameEpoch + ms) + "000000" !== ns ||
      (!events && !Number.isFinite(Number(amount)))
    ) continue;
    if (events) {
      const samples = eventsByEdition.get(edition) ?? [];
      samples.push([id, order, ms]);
      eventsByEdition.set(edition, samples);
    } else {
      const points = pointsByEdition.get(edition) ?? [];
      points.push([id, order, ms, Number(amount)]);
      pointsByEdition.set(edition, points);
    }
  }
  const editions = events
    ? Array.from(eventsByEdition, ([edition, rows]) => ({ edition, count: rows.length, rows }))
    : Array.from(pointsByEdition, ([edition, points]) => ({ edition, points }));

  return { ...services, editions };
}
