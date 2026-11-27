-- Clean installations and databases that already completed the former 0030 share this frontier.
-- An older workspace must run its original incremental migrations before using this baseline.
DO $$
BEGIN
  IF to_regclass('public.acceptance_evidence') IS NOT NULL THEN
    RAISE EXCEPTION 'Existing Dawn workspace: apply the incremental migrations through 0030 before bootstrap.';
  END IF;
END $$;

--> statement-breakpoint

CREATE TABLE acceptance_evidence (
  id text PRIMARY KEY,
  check_id text NOT NULL,
  serial text NOT NULL,
  revision_id text NOT NULL,
  revision text NOT NULL,
  mark text NOT NULL,
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 500),
  observation text NOT NULL CHECK (length(btrim(observation)) BETWEEN 1 AND 1000),
  recorded_at timestamptz NOT NULL,
  imported boolean NOT NULL DEFAULT false,
  interval jsonb,
  archive jsonb
);

--> statement-breakpoint

CREATE INDEX "acceptance_evidence_scope" ON "acceptance_evidence" ("check_id", "serial", "revision_id", "recorded_at");

--> statement-breakpoint

CREATE TABLE acceptance_decisions (
  id text PRIMARY KEY,
  evidence_id text NOT NULL UNIQUE REFERENCES acceptance_evidence (id),
  decision text NOT NULL CHECK (decision IN ('Approved', 'On hold')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  recorded_at timestamptz NOT NULL,
  reviewer text NOT NULL DEFAULT 'Quality assurance' CHECK (length(btrim(reviewer)) BETWEEN 1 AND 100)
);

--> statement-breakpoint

CREATE TABLE catalog_entries (
  kind text NOT NULL CHECK (kind IN ('projects', 'systems', 'revisions', 'units', 'archivedProjects', 'archivedRows')),
  id text NOT NULL,
  position integer NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (kind, id)
);

--> statement-breakpoint

CREATE TABLE assembly_records (
  id text PRIMARY KEY,
  section text NOT NULL CHECK (section IN ('engineering', 'production')),
  position integer NOT NULL,
  data jsonb NOT NULL,
  build_id text REFERENCES assembly_records(id)
);

--> statement-breakpoint

CREATE TABLE workspace_baseline (
  id text PRIMARY KEY,
  verification jsonb NOT NULL,
  history jsonb NOT NULL
);

--> statement-breakpoint

CREATE TABLE workspace_records (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('requirement', 'configuration', 'change', 'queue', 'build', 'issue', 'evidence')),
  recorded_at timestamptz NOT NULL,
  data jsonb NOT NULL
);

--> statement-breakpoint

CREATE TABLE verification_reviews (
  id text PRIMARY KEY,
  recorded_at timestamptz NOT NULL,
  data jsonb NOT NULL
);

--> statement-breakpoint

CREATE TABLE users (
  id text PRIMARY KEY CHECK (id IN ('reviewer', 'technician', 'quality', 'research-partner')),
  name text NOT NULL,
  role text NOT NULL UNIQUE,
  position integer NOT NULL
);

--> statement-breakpoint

CREATE TABLE acceptance_checks (
  id text PRIMARY KEY,
  data jsonb NOT NULL
);

--> statement-breakpoint

CREATE TABLE public_references (
  id text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL,
  summary text NOT NULL,
  sources jsonb NOT NULL,
  position integer NOT NULL
);

--> statement-breakpoint

CREATE TABLE work_items (
  id text PRIMARY KEY,
  title text NOT NULL,
  assignee_id text NOT NULL REFERENCES users(id),
  waiting_user_ids text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  href text NOT NULL,
  action_label text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('urgent', 'follow_up', 'routine')),
  method text NOT NULL,
  serial text NOT NULL,
  revision_id text NOT NULL,
  evidence_ids text[] NOT NULL,
  completed_at timestamp with time zone
);

--> statement-breakpoint

CREATE INDEX work_items_review_scope ON work_items (method, serial, revision_id);

--> statement-breakpoint

CREATE TABLE engineering_work (
  record_id text PRIMARY KEY REFERENCES assembly_records(id),
  requirement_id text REFERENCES assembly_records(id),
  owner text,
  next_step text,
  decision text,
  blocker text
);

--> statement-breakpoint

CREATE TABLE delivery_packets (
  id text PRIMARY KEY,
  serial text NOT NULL,
  revision_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  signed_by text NOT NULL REFERENCES users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  contents jsonb NOT NULL,
  UNIQUE(serial, revision_id, version)
);

--> statement-breakpoint

CREATE TABLE revision_reviews (
  id text PRIMARY KEY,
  change_id text NOT NULL,
  serial text NOT NULL,
  revision_id text NOT NULL,
  from_id text NOT NULL,
  to_id text NOT NULL CHECK (to_id <> from_id),
  owner text NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  conclusion text,
  CHECK ((completed_at IS NULL) = (conclusion IS NULL))
);

--> statement-breakpoint

CREATE UNIQUE INDEX revision_reviews_pending ON revision_reviews(change_id, serial, revision_id, from_id, to_id)
WHERE completed_at IS NULL;

--> statement-breakpoint

CREATE TABLE inspection_findings (
  id text PRIMARY KEY,
  check_id text NOT NULL REFERENCES acceptance_checks(id),
  serial text NOT NULL,
  revision_id text NOT NULL,
  archive_id text NOT NULL,
  first_frame integer NOT NULL CHECK (first_frame >= 1),
  last_frame integer NOT NULL CHECK (last_frame >= first_frame),
  issue_id text REFERENCES assembly_records(id),
  decision_id text REFERENCES acceptance_decisions(id),
  observation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archive jsonb,
  CHECK (num_nonnulls(issue_id, decision_id) = 1)
);

--> statement-breakpoint

CREATE TABLE planning_stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  closed text[] NOT NULL
);

--> statement-breakpoint

CREATE TABLE planning_tasks (
  id text PRIMARY KEY,
  title text NOT NULL,
  check_id text NOT NULL REFERENCES acceptance_checks(id),
  after_task text REFERENCES planning_tasks(id),
  gate text CHECK (gate IN ('issue','engineering','qa')),
  issue_id text REFERENCES assembly_records(id),
  day text NOT NULL,
  person text NOT NULL REFERENCES users(id),
  station text NOT NULL REFERENCES planning_stations(id),
  stations text[] NOT NULL,
  CHECK (station = ANY(stations)),
  CHECK ((gate = 'issue') IS NOT TRUE OR issue_id IS NOT NULL)
);

--> statement-breakpoint

CREATE TABLE plan_scenarios (
  id text PRIMARY KEY,
  title text NOT NULL,
  base_version integer NOT NULL,
  slots jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE TABLE published_plans (
  version integer PRIMARY KEY CHECK(version > 0),
  scenario text UNIQUE NOT NULL REFERENCES plan_scenarios(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  dates jsonb NOT NULL
);

--> statement-breakpoint

CREATE TABLE tool_cases (
  id text PRIMARY KEY,
  tool text NOT NULL,
  title text NOT NULL,
  unit jsonb,
  data jsonb NOT NULL,
  UNIQUE(id,tool)
);

--> statement-breakpoint

CREATE TABLE tool_decisions (
  id text PRIMARY KEY,
  case_id text NOT NULL,
  tool text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  actor text NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL,
  FOREIGN KEY(case_id,tool) REFERENCES tool_cases(id,tool),
  UNIQUE(id,case_id,tool)
);

--> statement-breakpoint

CREATE INDEX tool_decisions_history ON tool_decisions(case_id,at,id);

--> statement-breakpoint

CREATE TABLE tool_assignments (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  case_id text NOT NULL,
  tool text NOT NULL,
  title text NOT NULL,
  owner text NOT NULL REFERENCES users(id),
  section text NOT NULL CHECK(section IN ('engineering','production','verification','operations')),
  unit jsonb,
  selection text,
  source_id text NOT NULL,
  completed_at timestamptz,
  completed_by text,
  FOREIGN KEY(event_id,case_id,tool) REFERENCES tool_decisions(id,case_id,tool),
  FOREIGN KEY (completed_by, case_id, tool) REFERENCES tool_decisions(id, case_id, tool)
);

--> statement-breakpoint

CREATE INDEX tool_assignments_inbox ON tool_assignments(owner,section) WHERE completed_at IS NULL;

--> statement-breakpoint

CREATE TABLE packet_responses (
  packet_id text PRIMARY KEY REFERENCES delivery_packets(id),
  outcome text NOT NULL CHECK (outcome IN ('Accepted','Returned')),
  received_from text NOT NULL CHECK (length(trim(received_from)) > 0),
  reference text NOT NULL CHECK (length(trim(reference)) > 0),
  recorded_by text NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE TABLE design_editions (
  id text PRIMARY KEY,
  record_id text NOT NULL REFERENCES assembly_records(id),
  serial text NOT NULL,
  revision_id text NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  label text NOT NULL,
  source text NOT NULL,
  fields jsonb NOT NULL,
  targets jsonb NOT NULL,
  figure jsonb
);

--> statement-breakpoint

CREATE UNIQUE INDEX design_edition_order ON design_editions(record_id, serial, revision_id, position);

--> statement-breakpoint

CREATE TABLE design_findings (
  id text PRIMARY KEY,
  record_id text NOT NULL REFERENCES assembly_records(id),
  serial text NOT NULL,
  revision_id text NOT NULL,
  prior_id text NOT NULL REFERENCES design_editions(id),
  current_id text NOT NULL REFERENCES design_editions(id),
  field_key text NOT NULL,
  target_id text NOT NULL REFERENCES assembly_records(id),
  observation text NOT NULL,
  actor text NOT NULL REFERENCES users(id),
  basis jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (prior_id <> current_id)
);

--> statement-breakpoint

CREATE INDEX design_finding_target ON design_findings(target_id, serial, revision_id);

--> statement-breakpoint

CREATE TABLE inspection_runs (
  id text PRIMARY KEY,
  check_id text NOT NULL REFERENCES acceptance_checks(id),
  digest text NOT NULL,
  data jsonb NOT NULL
);

--> statement-breakpoint

CREATE TABLE inspection_analyses (
  finding_id text PRIMARY KEY REFERENCES inspection_findings(id),
  source_id text NOT NULL REFERENCES inspection_runs(id),
  comparison_id text NOT NULL REFERENCES inspection_runs(id),
  control_id text REFERENCES inspection_runs(id),
  actor text NOT NULL REFERENCES users(id),
  basis jsonb NOT NULL,
  samples jsonb NOT NULL,
  CHECK (source_id <> comparison_id AND control_id IS DISTINCT FROM source_id AND control_id IS DISTINCT FROM comparison_id)
);

--> statement-breakpoint

CREATE TABLE validation_studies (
  id text PRIMARY KEY,
  supersedes_id text UNIQUE REFERENCES validation_studies(id) CHECK (supersedes_id <> id),
  record_id text NOT NULL REFERENCES assembly_records(id),
  serial text NOT NULL,
  revision_id text NOT NULL,
  model_edition_id text NOT NULL,
  archive jsonb NOT NULL CHECK (jsonb_typeof(archive->'conditions') = 'array' AND jsonb_typeof(archive->'rows') = 'array'),
  UNIQUE (record_id, serial, revision_id, model_edition_id)
);

--> statement-breakpoint

CREATE TABLE validation_judgments (
  id uuid PRIMARY KEY,
  study_id text NOT NULL REFERENCES validation_studies(id),
  decision text NOT NULL CHECK (decision IN ('supported', 'bias', 'insufficient')),
  observation text NOT NULL CHECK (length(btrim(observation)) BETWEEN 1 AND 1000),
  actor text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  basis jsonb NOT NULL CHECK (jsonb_typeof(basis->'selected') = 'array')
);

--> statement-breakpoint

CREATE INDEX validation_judgments_study ON validation_judgments (study_id, created_at);

--> statement-breakpoint

CREATE TABLE operations_study_findings (
  id uuid PRIMARY KEY,
  study text NOT NULL CHECK (study IN ('fleet', 'aurora', 'docking')),
  edition text NOT NULL,
  subject text NOT NULL,
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object' AND source ? 'label'),
  first_sample integer NOT NULL CHECK (first_sample >= 1),
  last_sample integer NOT NULL CHECK (last_sample >= first_sample),
  outcome text NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX operations_study_findings_history ON operations_study_findings (study, recorded_at, id);

--> statement-breakpoint

CREATE TABLE catalog_spacecraft (
  norad_id integer PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (coalesce(length(data->>'projectId') > 0 AND (data->>'noradId')::integer = norad_id, false))
);

--> statement-breakpoint

CREATE TABLE catalog_flights (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (coalesce(length(data->>'projectId') > 0 AND data->>'id' = id, false))
);

--> statement-breakpoint

CREATE TABLE aurora_flight_comments (
  id uuid PRIMARY KEY,
  flight_id text NOT NULL REFERENCES catalog_flights(id),
  author text CHECK (length(trim(author)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  example boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX aurora_flight_comments_flight ON aurora_flight_comments(flight_id, recorded_at);

--> statement-breakpoint

CREATE TABLE aurora_services (
  id uuid PRIMARY KEY,
  flight_id text NOT NULL REFERENCES catalog_flights(id),
  work text NOT NULL CHECK (length(trim(work)) BETWEEN 1 AND 1000),
  owner text NOT NULL CHECK (length(trim(owner)) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('Open','Completed')),
  example boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE TABLE aurora_calendar (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  day date NOT NULL,
  status text NOT NULL CHECK (status IN ('Tentative','Confirmed')),
  example boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'Appointment' CHECK (kind IN ('Appointment', 'Flight', 'Preparation', 'Service'))
);

--> statement-breakpoint

CREATE TABLE design_files (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('drawing', 'model')),
  name text NOT NULL,
  content text NOT NULL
);

--> statement-breakpoint

CREATE TABLE revision_files (
  revision_kind text NOT NULL DEFAULT 'revisions' CHECK (revision_kind = 'revisions'),
  revision_id text NOT NULL,
  file_id text NOT NULL REFERENCES design_files(id),
  PRIMARY KEY (revision_id, file_id),
  FOREIGN KEY (revision_kind, revision_id) REFERENCES catalog_entries(kind, id)
);

--> statement-breakpoint

CREATE TABLE aurora_service_documents (
  id text PRIMARY KEY,
  flight_id text NOT NULL REFERENCES catalog_flights(id),
  kind text NOT NULL CHECK (kind IN ('Inspection', 'Repair', 'Return to service')),
  title text NOT NULL,
  filed_by text NOT NULL,
  filed_on date NOT NULL,
  body text NOT NULL
);

--> statement-breakpoint

CREATE TABLE aurora_service_filings (
  service_id uuid PRIMARY KEY REFERENCES aurora_services(id),
  category text CHECK (category IN ('Scheduled', 'Unscheduled')),
  due_on date,
  evidence_id text REFERENCES aurora_service_documents(id),
  completion_evidence_id text REFERENCES aurora_service_documents(id),
  return_record_id text REFERENCES aurora_service_documents(id)
);

--> statement-breakpoint

CREATE SCHEMA visitor_demo;

--> statement-breakpoint

REVOKE ALL ON SCHEMA visitor_demo FROM PUBLIC;

--> statement-breakpoint

CREATE TABLE visitor_demo.entries (
  visitor text NOT NULL CHECK (visitor ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('note', 'review')),
  id uuid NOT NULL,
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 180),
  serial text NOT NULL CHECK (length(serial) BETWEEN 1 AND 180),
  revision_id text NOT NULL CHECK (length(revision_id) BETWEEN 1 AND 180),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  PRIMARY KEY (visitor, kind, id)
);

--> statement-breakpoint

CREATE TABLE visitor_demo.write_counts (
  visitor text PRIMARY KEY,
  minute timestamptz NOT NULL,
  writes integer NOT NULL
);

--> statement-breakpoint

CREATE TABLE visitor_demo.contributions (
  request_id uuid PRIMARY KEY,
  actor text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('note','review')),
  evidence_id text NOT NULL,
  serial text NOT NULL,
  revision_id text NOT NULL,
  body_hash text NOT NULL,
  filed_at timestamptz NOT NULL
);

--> statement-breakpoint

CREATE FUNCTION visitor_demo.append_evidence(who text, which text, request uuid, target text, unit_serial text, revision text, body text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  prior visitor_demo.contributions%ROWTYPE;
  source jsonb;
  method text;
  edition jsonb;
  stamp timestamptz := clock_timestamp();
  bucket timestamptz;
  digest text;
  canonical jsonb;
BEGIN
  IF who IS NULL OR who !~ '^[0-9a-f]{64}$' OR which IS NULL OR which NOT IN ('note','review') OR request IS NULL OR
     target IS NULL OR length(target) NOT BETWEEN 1 AND 180 OR unit_serial IS NULL OR length(unit_serial) NOT BETWEEN 1 AND 180 OR
     revision IS NULL OR length(revision) NOT BETWEEN 1 AND 180 OR body IS NULL OR
     length(btrim(body)) NOT BETWEEN 1 AND (CASE WHEN which='note' THEN 1000 ELSE 500 END) THEN
    RETURN 'Enter a valid entry for this evidence.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dawn-workspace-write'));
  stamp := clock_timestamp();
  bucket := date_trunc('minute',stamp);
  digest := encode(sha256(convert_to(body,'UTF8')),'hex');
  SELECT * INTO prior FROM visitor_demo.contributions WHERE request_id=request;
  IF FOUND THEN
    IF (prior.actor,prior.kind,prior.evidence_id,prior.serial,prior.revision_id,prior.body_hash)
        = (who,which,target,unit_serial,revision,digest) THEN RETURN NULL; END IF;
    RETURN 'This submission changed. Reopen the evidence before filing.';
  END IF;

  -- Only a unique, issued synthetic evidence record can receive public additions.
  BEGIN
    SELECT r.entry,r.method INTO STRICT source,method FROM public.workspace_baseline b
    CROSS JOIN LATERAL (
      SELECT e AS entry,e->>'test' AS method FROM jsonb_array_elements(b.verification->'catalogEvidence') e
      UNION ALL
      SELECT e AS entry,m.key AS method FROM jsonb_each(b.verification->'records') m
        CROSS JOIN LATERAL jsonb_array_elements(m.value) e
    ) r WHERE r.entry->>'id'=target;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN 'Choose an existing demo evidence record.';
  END;
  edition := source->'unit';
  IF edition->>'serial' IS DISTINCT FROM unit_serial OR edition->>'revisionId' IS DISTINCT FROM revision OR
     EXISTS (SELECT 1 FROM public.workspace_records w WHERE w.data->'action' @>
       jsonb_build_object('parentId',target,'type','remove','unit',jsonb_build_object('serial',unit_serial,'revisionId',revision))) THEN
    RETURN 'This evidence is unavailable for that unit and revision.';
  END IF;

  DELETE FROM visitor_demo.write_counts WHERE minute < bucket;
  IF (SELECT count(*) FROM visitor_demo.contributions WHERE actor=who) >= 24 OR
     (SELECT count(*) FROM visitor_demo.contributions) >= 2000 THEN RETURN 'The shared demo contribution limit has been reached.'; END IF;
  IF EXISTS (SELECT 1 FROM visitor_demo.write_counts WHERE (visitor=who AND writes>=12) OR (visitor='*' AND writes>=120)) THEN
    RETURN 'Too many demo changes. Try again in a minute.';
  END IF;
  INSERT INTO visitor_demo.write_counts VALUES (who,bucket,1),('*',bucket,1)
    ON CONFLICT (visitor) DO UPDATE SET writes=visitor_demo.write_counts.writes+1;
  INSERT INTO visitor_demo.contributions VALUES(request,who,which,target,unit_serial,revision,digest,stamp);
  canonical := jsonb_build_object('id',request::text,'recordedAt',stamp,'test',method);

  IF which='note' THEN
    INSERT INTO public.workspace_records(id,kind,recorded_at,data) VALUES(request::text,'evidence',stamp,canonical ||
      jsonb_build_object('kind','evidence','title',source->>'title','description',btrim(body),'context','Shared demo note',
        'action',jsonb_build_object('type','note','parentId',target,'unit',edition)));
  ELSE
    INSERT INTO public.verification_reviews(id,recorded_at,data) VALUES(request::text,stamp,canonical ||
      jsonb_build_object('evidenceIds',jsonb_build_array(coalesce(source#>>'{capture,reviewId}',target)),
        'scope',jsonb_build_object('selection','unit:' || unit_serial,'revision',revision),
        'decision','Reviewed','reason',btrim(body),'reviewer','Demo visitor'));
  END IF;
  RETURN NULL;
END $$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION visitor_demo.append_evidence(text,text,uuid,text,text,text,text) FROM PUBLIC;

--> statement-breakpoint

-- Initial reference rows historically required before the curated seed.
INSERT INTO public.acceptance_checks (id, data) VALUES ('acceptance-firefly-image', '{"id": "acceptance-firefly-image", "unit": {"serial": "REF-FFLY-01", "revision": "Earth-observation integration", "revisionId": "public-pixxel-firefly-ref"}, "owner": "Production · Image records", "buildId": "public-firefly-witness-build", "initial": {"mark": "Not visible throughout", "source": "Witness image archive A", "observation": "Part of the archived image sequence has no legible source identification."}, "issueId": "public-firefly-witness-issue", "artifact": "image", "changeId": "public-firefly-witness-decision", "comparison": {"run": "Witness image archive A", "rerun": "Witness image rerun B", "runId": "firefly-witness-a-1", "frames": [{"repeat": false, "original": false, "repeatImage": "/inspection/firefly/b-1.webp", "originalImage": "/inspection/firefly/a-1.webp"}, {"repeat": true, "original": false, "repeatImage": "/inspection/firefly/b-2.webp", "originalImage": "/inspection/firefly/a-2.webp"}, {"repeat": true, "original": false, "repeatImage": "/inspection/firefly/b-3.webp", "originalImage": "/inspection/firefly/a-3.webp"}, {"repeat": true, "original": true, "repeatImage": "/inspection/firefly/b-4.webp", "originalImage": "/inspection/firefly/a-4.webp"}, {"repeat": true, "original": true, "repeatImage": "/inspection/firefly/b-5.webp", "originalImage": "/inspection/firefly/a-5.webp"}, {"repeat": false, "original": false, "repeatImage": "/inspection/firefly/b-6.webp", "originalImage": "/inspection/firefly/a-6.webp"}], "rerunId": "firefly-witness-b-1", "evidenceId": "public-firefly-witness-evidence"}, "nextAction": "Compare the archived image and rerun, then submit the interval that shows the source identification.", "interfaceId": "public-firefly-witness-interface", "requirementId": "public-firefly-witness-requirement"}');

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('pixxel-firefly', 'Pixxel Firefly', 'Launched', 'Dawn identifies SatDrive on FFLY-1, FFLY-2 and FFLY-3. Pixxel documents the Firefly launch campaigns.', '[{"href": "https://www.dawnaerospace.com/heritage-and-missions", "title": "Dawn Aerospace heritage"}, {"href": "https://www.dawnaerospace.com/green-propulsion", "title": "Dawn Aerospace products"}, {"href": "https://www.pixxel.space/news/pixxel-launches-worlds-highest-resolution-hyperspectral-satellites-kickstarts-firefly-constellation-for-climate-action", "title": "Pixxel launch announcement"}, {"href": "https://www.pixxel.space/news/pixxel-launches-three-more-fireflies-with-spacex-paving-the-way-for-planetary-scale-hyperspectral-imaging", "title": "Pixxel second launch announcement"}]', 1);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('astroforge-odin', 'AstroForge Odin', 'Launched February 2025', 'AstroForge identifies Odin and dates its launch to February 26, 2025. Dawn attributes SatDrive to the spacecraft.', '[{"href": "https://www.dawnaerospace.com/heritage-and-missions", "title": "Dawn Aerospace heritage"}, {"href": "https://www.astroforge.com/odin-mission", "title": "AstroForge mission page"}]', 2);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('sidus-lizziesat', 'Sidus Space LizzieSat', 'Supplier agreement announced', 'Sidus announced an agreement to integrate Dawn propulsion into the LizzieSat platform.', '[{"href": "https://investors.sidusspace.com/news-events/press-releases/detail/56/sidus-space-engages-dawn-aerospace-to-implement-propulsion", "title": "Sidus supplier agreement"}]', 3);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('blue-canyon-lunar-relay', 'Blue Canyon Technologies lunar data relay', 'Supplier announcement', 'Dawn announced propulsion for two lunar relay satellites. Blue Canyon Technologies was named as the bus developer and payload integrator.', '[{"href": "https://www.dawnaerospace.com/latest-news/bct-lunar-relay-green-propulsion", "title": "Dawn Aerospace relay announcement"}]', 4);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('arkedge-lnss', 'ArkEdge Space Lunar Navigation Satellite System', 'Supplier selection announced', 'Dawn announced selection for one lunar navigation satellite. ArkEdge reports separate feasibility work for the wider constellation.', '[{"href": "https://www.dawnaerospace.com/latest-news/arkedge-lunar-satellite", "title": "Dawn Aerospace announcement"}, {"href": "https://arkedgespace.com/en?p=19410", "title": "ArkEdge Space feasibility study"}]', 5);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('aule-space', 'Aule Space docking demonstration', 'Announced September 2026', 'Dawn announced a contract to supply SatDrive for the planned demonstration.', '[{"href": "https://www.dawnaerospace.com/latest-news/aule-space-dawn-aerospace-satdrive-docking-mission", "title": "Dawn Aerospace announcement"}, {"href": "https://aule.space/", "title": "Aule Space company updates"}]', 6);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('uarx-ossie', 'UARX Space OSSIE', 'Launched October 2026', 'Dawn reported that OSSIE’s first flight carried SatDrive and a structural docking port.', '[{"href": "https://www.uarx.com/products/ossie.php", "title": "UARX Space OSSIE program"}, {"href": "https://www.dawnaerospace.com/latest-news/dftport-ossie", "title": "Dawn Aerospace docking port announcement"}, {"href": "https://www.linkedin.com/posts/dawnaerospace_refueling-heritage-update-our-activity-7511518700697677826-_S06", "title": "Dawn Aerospace launch update"}]', 7);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('oasis-beta', 'Tumbleweed Oasis Beta', 'Announced November 2026', 'Dawn announced a propulsion supply contract for the planned orbital research and return mission.', '[{"href": "https://www.dawnaerospace.com/latest-news/tumbleweed-oasis-beta-dawn-aerospace-propulsion", "title": "Dawn Aerospace announcement"}]', 8);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('cnes-platform-study', 'CNES spacecraft platform study', 'Study completed September 2026', 'Dawn reports completing the CNES-commissioned study with Infinite Orbits and Exotrail.', '[{"href": "https://www.dawnaerospace.com/latest-news/cnes-satellite-refuelling-study-completed", "title": "Dawn Aerospace study summary"}]', 9);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('georyder', 'GEOryder', 'Research program', 'Infinite Orbits coordinates this EU-funded development program and names Dawn as a development partner.', '[{"href": "https://www.dawnaerospace.com/latest-news/georyder-update", "title": "Dawn Aerospace program update"}, {"href": "https://infiniteorbits.io/blog/georyder/georyder-new-route-to-geo-for-small-satellites/", "title": "Infinite Orbits program account"}]', 10);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('satdrive', 'SatDrive', 'Product family', 'Dawn’s modular spacecraft propulsion systems.', '[{"href": "https://www.dawnaerospace.com/green-propulsion", "title": "Dawn Aerospace products"}]', 11);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('cubedrive', 'CubeDrive', 'Product family', 'Dawn’s integrated propulsion systems for CubeSat-class spacecraft.', '[{"href": "https://www.dawnaerospace.com/green-propulsion", "title": "Dawn Aerospace products"}]', 12);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('loop-network', 'Loop Network', 'Planned network', 'Dawn’s public in-orbit refueling program.', '[{"href": "https://www.dawnaerospace.com/loop-in-orbit-refueling-network", "title": "Dawn Aerospace Loop Network"}]', 13);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('d-orbit-origin', 'D-Orbit ION Lucas · Origin', 'Qualified inference', 'Dawn lists SCV001 among its D-Orbit propulsion users. D-Orbit identifies that carrier as Lucas and documents a third-party propulsion demonstration on Origin.', '[{"href": "https://www.dawnaerospace.com/latest-news/prevalence-of-nitrous-based-in-space-propellants", "title": "Dawn Aerospace D-Orbit account"}, {"href": "https://dorbit.space/origin-september-2020/", "title": "D-Orbit Origin mission"}]', 14);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('d-orbit-pulse', 'D-Orbit ION Laurentius · Pulse', 'Launched January 2021', 'Dawn names ION SCV002 in its propulsion demonstration history. Operator D-Orbit identifies the carrier as Laurentius on the Pulse mission.', '[{"href": "https://www.dawnaerospace.com/latest-news/prevalence-of-nitrous-based-in-space-propellants", "title": "Dawn Aerospace flight account"}, {"href": "https://dorbit.space/pulse-january-2021/", "title": "D-Orbit Pulse mission"}]', 15);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('hiber-three', 'Hiber Three', 'Launched March 2021', 'Dawn publicly identified its CubeSat propulsion unit aboard the Hiber Three commercial connectivity satellite.', '[{"href": "https://www.scoop.co.nz/stories/SC2103/S00037/dawn-aerospace-launches-eighth-in-space-propulsion-unit.htm", "title": "Dawn Aerospace press release"}, {"href": "https://hiber.global/hiber-successfully-launches-second-generation-satellite-via-spacexs-transporter-1/", "title": "Hiber spacecraft account"}]', 16);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('reditus-enos', 'Reditus Space ENOS', 'Supplier announced', 'Dawn announced SatDrive for Reditus Space’s ENOS microgravity research and manufacturing spacecraft. Reditus describes the ENOS Mk1 mission separately.', '[{"href": "https://www.dawnaerospace.com/latest-news/reditus", "title": "Dawn Aerospace supplier announcement"}, {"href": "https://www.reditus.space/news/enos-mission-announcement", "title": "Reditus Space mission announcement"}]', 17);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('cosmoserve-refueling-mou', 'Cosmoserve Space refueling collaboration', 'Exploratory MoU', 'Dawn and Cosmoserve announced an agreement to explore refueling and debris removal collaboration.', '[{"href": "https://www.dawnaerospace.com/latest-news/cosmoserve", "title": "Dawn Aerospace agreement announcement"}, {"href": "https://cosmoserve.space/", "title": "Cosmoserve Space announcement index"}]', 18);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('orbit-fab-collaboration', 'Orbit Fab refueling collaboration', 'Collaboration announced in 2021', 'Orbit Fab announced collaboration with Dawn on satellite refueling compatibility in 2021.', '[{"href": "https://www.orbitfab.com/news/dawn/", "title": "Orbit Fab collaboration announcement"}]', 19);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('dft-passive', 'Docking and Fluid Transfer (DFT) Passive Port', 'Qualification announced in 2024', 'Dawn reported environmental qualification of its passive docking and fluid transfer port.', '[{"href": "https://www.dawnaerospace.com/latest-news/dft-port-environmental-qualification", "title": "Dawn Aerospace qualification announcement"}]', 20);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('aurora-spaceplane', 'Aurora spaceplane', 'Dawn flight-test program', 'Dawn’s reusable suborbital research aircraft program. Dawn publishes its flight history separately from future program milestones.', '[{"href": "https://www.dawnaerospace.com/spaceplane-program", "title": "Dawn Aerospace spaceplane program"}]', 21);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('aurora-asu-leotims', 'Arizona State University LEO-TIMS', 'Research payload flown', 'Arizona State University confirms its thermal-infrared research camera flew aboard Dawn’s Aurora spaceplane.', '[{"href": "https://news.asu.edu/b/20260313-arizona-state-university-leotims-camera-flight-aurora-spaceplane-university-space", "title": "Arizona State University flight account"}, {"href": "https://www.dawnaerospace.com/latest-news/asu-payload", "title": "Dawn Aerospace payload account"}]', 22);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('aurora-oklahoma', 'Oklahoma suborbital research program', 'Partnership announced', 'Oklahoma and Dawn announced an Aurora partnership. Dawn later announced the selection of university-led research teams for future flights.', '[{"href": "https://oklahoma.gov/aerospace/outreach-advocacy/newsroom/oklahoma-space-port-announces-historic-partnership-with-dawn-aer.html", "title": "Oklahoma Department of Aerospace and Aeronautics"}, {"href": "https://www.dawnaerospace.com/latest-news/suborbital-spaceplane-challenge-winners-2026", "title": "Dawn Aerospace research selection"}]', 23);

--> statement-breakpoint

INSERT INTO public.public_references (id, title, status, summary, sources, "position") VALUES ('dawn-heritage-index', 'Dawn Aerospace heritage', 'Heritage snapshot', 'Dawn’s October 1, 2026 snapshot lists 59 satellites and 225 thrusters.', '[{"href": "https://www.dawnaerospace.com/heritage-and-missions", "title": "Dawn Aerospace heritage"}]', 0);

--> statement-breakpoint

INSERT INTO public.users (id, name, role, "position") VALUES ('reviewer', 'Maya Chen', 'Reviewer', 0);

--> statement-breakpoint

INSERT INTO public.users (id, name, role, "position") VALUES ('technician', 'Jamie Park', 'Technician', 1);

--> statement-breakpoint

INSERT INTO public.users (id, name, role, "position") VALUES ('quality', 'Sam Rivera', 'Quality lead', 2);

--> statement-breakpoint

INSERT INTO public.users (id, name, role, "position") VALUES ('research-partner', 'Alex Morgan', 'Research collaborator', 3);
