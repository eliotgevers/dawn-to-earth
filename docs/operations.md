# Running Dawn to Earth

## Full stack with Docker Compose

Run the web app, PostgreSQL 17, InfluxDB 2.10.1 and Grafana 13.3.1 together with Docker Compose 2.24.4 or newer, Python 3 and OpenSSL. Run the commands below from the repository root.

```sh
python3 apps/backend/scripts/stack.py init ~/.local/share/dawn-demo
python3 apps/backend/scripts/stack.py up dev ~/.local/share/dawn-demo
```

The local workspace uses one file, `apps/backend/compose.local.yaml`. The existing laptop’s separate data-service projects retain their original Compose entry points and volumes.

Development opens [the workspace](http://localhost:4331) and [Grafana](http://127.0.0.1:4332) on loopback. Changes to the mounted application source reload in Next. PostgreSQL and InfluxDB use the internal Docker network. The one-time `init` creates a private directory containing unique credentials and a Compose project ID. Choose different ports in its `.env` when running several workspaces.

```sh
python3 apps/backend/scripts/stack.py up production ~/.local/share/dawn-demo
```

The optional private HTTPS rehearsal adds `compose.production.yaml` to the local configuration and runs an optimized Next build. Open [the local HTTPS rehearsal](https://localhost:4443) as `reviewer` using the private directory’s `reviewer-password`. The generated certificate is for localhost. For another private host, provide its trusted certificate and key as `tls.crt` and `tls.key`, then set `PUBLIC_HOST`, `HTTPS_PORT` and `INGRESS_BIND` in the instance settings. Nginx protects the workspace and Grafana with the same credentials. Invited users can change records in this demo instance. Its Grafana dashboards open with Viewer access. The InfluxDB admin interface stays private.

Each mode has its own project, volumes and grants. Startup builds the image, waits for PostgreSQL and InfluxDB, grants Grafana read access to the archive bucket, runs the existing Drizzle bootstrap and indexes the records from that instance’s web API. Re-running `up` reuses the credentials and updates the curated records under the seed’s preservation rules. Use `python3 apps/backend/scripts/stack.py config MODE DIRECTORY` to validate configuration, and `python3 apps/backend/scripts/stack.py down MODE DIRECTORY` to stop that mode while keeping its data.

Keep the private settings directory and volumes together. For a retained instance, back up the PostgreSQL database containing authored work, the InfluxDB bucket and metadata, and Grafana’s database and provisioning files. Store the credentials separately in an encrypted backup and rehearse restoring into another instance.

## Hosted demo

The GitHub repository’s main branch feeds Vercel (Next.js, root `apps/web`) and Railway (Grafana, root `apps/backend`). PostgreSQL and InfluxDB run from pinned images with independent persistent volumes. Grafana builds its archive dashboards from this repository. Its public Viewer can read the synthetic bucket. InfluxDB has no public domain.

On a fresh database run `bun db/seed/index.ts` from `apps/web` with an owner connection. The baseline creates the current schema. Databases that previously applied migrations through 0030 can run the same bootstrap directly. For older retained installations, back up the database and apply the archived incremental chain through 0030 before using this baseline. Keep the existing Drizzle ledger.

For a schema change, update `db/schema.ts`, add the next numbered SQL file in `db/migrations`, and append its tag and a later millisecond timestamp to `meta/_journal.json`. Drizzle ORM 0.45.2 uses those timestamps to decide which SQL to apply. The baseline shares its timestamp with the former 0030 migration so existing installations skip it. This repository maintains SQL directly. Drizzle Kit's automatic diff workflow would require a schema snapshot. Rehearse both a fresh bootstrap and an upgrade on a populated disposable database. [Drizzle migration reader](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/migrator.ts) · [Drizzle Kit generation](https://orm.drizzle.team/docs/drizzle-kit-generate)

For public web access use a different PostgreSQL role with only schema usage and table SELECT. Set the hosted reader role’s PostgreSQL `idle_session_timeout` to 60 seconds so suspended web instances release their slots. Set `DATABASE_URL` and `DATABASE_CA_CERT` for certificate-verified TLS. To index the synthetic archive, run `python3 apps/backend/scripts/sync.py sync` with `APP_URL` pointing to that instance and its import credentials in the operator environment. Use `sync.py verify` for a read-only comparison of the source editions, stored points and Grafana panels. Keep import and administrator credentials outside Vercel.

Visitors can append a shared note or documentary review to an exact evidence record. After the workspace bootstrap, run `apps/backend/infra/visitor-grants.sql` as the migration owner with the dedicated contributor login. Set `VISITOR_DATABASE_URL` for that login and `DAWN_VISITOR_SECRET` to a cryptographically random server secret of at least 32 bytes. The signed cookie identifies the contributor for rate limits and the audit trail. The public login has access only to the bounded filing operation. Contributions share the normal Notes and Review History lists and are attributed to a demo visitor. Shared notes are append-only. An operator who needs a clean demonstration should bootstrap a separate database and switch the deployment after verifying it. Back up the current database first.

The hosted web reads through Grafana's datasource API with `GRAFANA_ARCHIVE_QUERY=true`, `GRAFANA_PUBLIC_URL` and a Viewer service-account `GRAFANA_VIEWER_TOKEN`. The web needs no Influx URL or token in this mode. Local Compose can still set a separate internal Grafana origin. Check one exact edition and time window from Verification after changing infrastructure.

Fleet serves a dated, Dawn-only CelesTrak snapshot from Vercel’s ISR cache. On first deployment the bundled edition is available immediately. Visits can trigger a refresh after five minutes, then every six hours. Failed refreshes keep the last successful edition. A cached attempt limits upstream downloads during an outage. The globe shows archive time when a snapshot ages, and checks each object’s epoch before estimating its position.

Run the two Python archive regressions from the repository root with `PYTHONPATH=apps/backend/scripts python3 -m unittest discover -s apps/backend/tests`.

## Ask

Ask falls back to source lookup and Home assignments when the model is unavailable. Shared notes and documentary reviews require the visitor to confirm the displayed draft.

For direct OpenAI, configure server-side `DAWN_ASK_PROVIDER=openai`, `DAWN_ASK_MODEL=gpt-6.2-sol` and `OPENAI_API_KEY`. Hosted requests use the matching `DAWN_ASK_OPENAI_PROJECT` and its provider spending limit. Ask limits request size, output tokens, elapsed time and tool steps. If the provider is unavailable, Ask falls back to workspace source lookup. Local development also supports `DAWN_ASK_GATEWAY_KEY` with a gateway model ID.

## Connect a test tool

The [Python example](../apps/backend/examples/send_display_counter.py) sends five fictional display-counter readings to an existing Electronics record. To try it locally, use a seeded disposable database and set these variables in the shell that starts the web app and sender. Generate a fresh token for that instance and keep it private.

```sh
export BENCH_INGEST_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export BENCH_INGEST_SOURCE_ID=communication-exception-note
export BENCH_INGEST_SERIAL=LK-014
export BENCH_INGEST_REVISION_ID=bench-a
```

Start the disposable app with that environment. From the repository root, run `python3 apps/backend/examples/send_display_counter.py --app-port PORT` with its local port. Open the printed evidence link to see the filed recording. Running the command again returns the same record. The sender needs only the token and the agreed source identifiers, and uses Python’s standard library.

For another sender, POST JSON to `/api/bench-ingest` with `Authorization: Bearer <token>` and `Content-Type: application/json`. The example is the complete request body. Its `sourceId`, `recording.serial` and `recording.revisionId` must match the configured active source. Use a stable `.json` filename and a `display_count` recording with 1–256 `[elapsedMilliseconds, count]` pairs. Times must be increasing whole milliseconds within one day, and counts must be integers from 0 through 9999. Retry with the same filename and recording. The receipt includes `evidenceId`, a relative `evidenceUrl`, and `grafanaUrl` when the matching trace is available. Filing leaves QA decisions with the reviewer. Ingest is disabled until all four server settings are present.

## Public releases

Keep working history in a local branch or private bundle. Record the live Vercel deployment and current remote `main` SHA, audit the intended Git tree, then build and smoke that exact snapshot in a protected preview. Create one parentless commit named `initial commit` from the tested tree. Push only `main` with `--force-with-lease=refs/heads/main:<verified-sha>`. Stop if the lease fails. Verify the remote tree, single root, production alias and signed-out workflows. Earlier commits can still exist in forks, caches or direct links.
