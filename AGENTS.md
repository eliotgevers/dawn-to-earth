# Dawn to Earth

## Product and workflow criteria

Use the [product vision](README.md) to decide what belongs here. Follow a customer commitment through the project, unit, revision and source evidence. A useful tool lets an engineer answer a question, save a defensible result and leave the next person enough information to act.

- Walk the existing app before proposing an addition. Treat a reported example as a clue to a wider pattern. A missing Delete warrants checking how comparable records can be edited, archived or removed while retaining history.
- Give each section work that fits. Engineering explains the design decision, tradeoff and reason. Production records the work performed or the blocker. Verification states the observation, its source and what it supports. A missing document matters when it changes what someone can conclude or do.
- Cold-read a random selection of records across projects, systems and units. A teammate should understand the title and first detail without narration. Adjacent records should add evidence or a decision. Preserve missing coverage, conflicting observations and unresolved questions.
- Place a recurring job where users look for it. Put a record-specific action on its record. Make the result persistent, visible to the next person and reachable through the existing navigation. Reuse Grafana for time-series exploration. Use custom comparisons for judgments that require knowledge of the design, evidence or assumptions.
- Keep the project, serial, revision, source edition and recorded interval attached to a decision. Verify exact links and browser Back. Protect original sources, user edits and decision history as records evolve.
- For a record connection, name the artifact or action and the view it opens. Use the filed target ID and edition to construct the destination. Keep the full record title available for inspection. Group supporting links under their owning record, keep one entry for each destination, and use a primary action only for a documented next step.
- After a prototype works, walk the whole path again and remove duplicate steps, controls, reads and state. Preserve the engineering work it enables. Make routine design choices independently and ground harder calls in observed behavior or public evidence.
- Verify the running app at desktop and phone widths. Exercise representative actions and downstream results on disposable data, including an incomplete or wrong-scope case. Report what actually passed and identify what remains unverified.

## Backend and feature simplification

- Do not reintroduce a top-level features layer. Keep routes and server actions in `app/`, screens and interaction state with their section in `components/`, persistence and decision rules in `db/`, and portable data or helpers in `lib/`. Modules in `db/workflows/` are pure; screens can reuse their projections without importing the database connection.
- Keep query and mutation entry points findable by domain. Put a rule in one place; don't spread it across a query, an adapter, and a screen. Use a schema when it can make invalid states impossible without hiding a compatibility rule.
- Remove forwarding modules and unused routes when no supported consumer needs them. Keep required validation, scope, history, and transaction boundaries. Don't count relocated files or deleted tests as simpler implementation.
- For a structural change, trace one real policy before and after. Show where a teammate would make that change, what path was removed, and how a focused regression check preserves behavior. Prefer Ousterhout's small interfaces around meaningful behavior and Fowler's incremental, verifiable refactorings over new frameworks.

## UI terminology

Keep the existing global header and its “Demo Data” disclosure. Use this as the sole visible disclosure across the app. Use ordinary operator terminology for board titles, chart labels, record fields, and statuses. Preserve technical uses of words such as “sample,” including sample number and sample rate.

Keep all fixtures, measurements, and review records synthetic. Use local demo data and controls, and avoid real test specifications, equipment integrations, or claims about Dawn Aerospace’s internal methods.

## Board design

Use headings when they help readers navigate or distinguish records. Omit headings and subtitles that repeat nearby labels. Build simple, fictional records around recognizable aerospace work. Use fields that support a decision, show evidence, or explain a handoff.

## Catalog acceptance checklist

- Each real catalog entry cites credible public evidence of Dawn Aerospace involvement, or a documented and explicitly qualified inference supported by evidence beyond a shared launch.
- Check the relationship at the level of the entry. A customer relationship, follow-on mission, common launch vehicle, or close date cannot establish that Dawn supplied a particular spacecraft.
- Record the decision, sources, and remaining uncertainty in [Catalog provenance](docs/catalog-sources.md). Keep fictional workflows and their saved identifiers independent of public references.

## Project skills

Use the project-local UI SDK guidance for named controls, focus, and keyboard checks. For shadcn/ui, use the project-local copy of the [maintainer skill](https://github.com/shadcn-ui/ui/tree/45bbf9ba23c9c0f63d38887947e5fb06f59c7da3/skills/shadcn). Review updates before copying them and preserve the local removal of automatic CLI execution and wildcard shell permissions. Apply [Vercel React Best Practices](https://github.com/vercel-labs/agent-skills/tree/5a37a6329fbad3666c3207392a6a7c0110e92efb/skills/react-best-practices) when editing React and Next.js views.
