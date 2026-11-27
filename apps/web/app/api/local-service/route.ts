import { readerConfiguration } from "@/db/operations/traces";

export async function GET(request: Request) {
  const service = new URL(request.url).searchParams.get("open");
  if (service !== "grafana" && service !== "influxdb") return new Response("Unknown local service.", { status: 404 });

  const headers = { "Cache-Control": "no-store" };
  try {
    const config = await readerConfiguration();
    const grafana = service === "grafana";
    const origin = grafana ? config.grafanaUrl : config.influxUrl;
    const publicUrl = grafana ? config.grafanaPublicUrl : config.influxPublicUrl;
    if (!publicUrl) return new Response("This service is private to the workspace.", { status: 404, headers });
    const response = await fetch(origin + (grafana ? "/api/health" : "/health"), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const health = await response.json();
      if (grafana ? health.database === "ok" : health.status === "pass") {
        return new Response(null, { status: 307, headers: { ...headers, Location: publicUrl + "/" } });
      }
    }
  } catch {
    // Keep the setup instructions reachable before the local stack is started.
  }
  const label = service === "grafana" ? "Grafana" : "InfluxDB";
  return new Response(
    label + " is unavailable. Start the local Docker engine, run docker compose up -d --wait from apps/backend, then reload this tab.",
    { status: 503, headers },
  );
}
