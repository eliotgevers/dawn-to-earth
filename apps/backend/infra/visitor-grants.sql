-- Run as an administrator, supplying two distinct role names to psql.
ALTER TABLE visitor_demo.contributions OWNER TO :"visitor_owner";
ALTER FUNCTION visitor_demo.append_evidence(text,text,uuid,text,text,text,text) OWNER TO :"visitor_owner";
GRANT USAGE ON SCHEMA public, visitor_demo TO :"visitor_owner";
GRANT SELECT (verification) ON public.workspace_baseline TO :"visitor_owner";
GRANT SELECT (data) ON public.workspace_records TO :"visitor_owner";
GRANT INSERT (id,kind,recorded_at,data) ON public.workspace_records TO :"visitor_owner";
GRANT INSERT (id,recorded_at,data) ON public.verification_reviews TO :"visitor_owner";
GRANT SELECT,INSERT,UPDATE,DELETE ON visitor_demo.write_counts TO :"visitor_owner";
GRANT USAGE ON SCHEMA visitor_demo TO :"visitor_role";
GRANT EXECUTE ON FUNCTION visitor_demo.append_evidence(text,text,uuid,text,text,text,text) TO :"visitor_role";
