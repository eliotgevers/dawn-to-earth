// Read-only audit of selectable scopes, recorded work and persona queues.
import { deepStrictEqual } from "node:assert";
import { isRemovedRecord, sameUnit } from "@/lib/records/journal";
import { db } from "../connection";
import { readEngineering, readProduction } from "../records/assembly";
import { readVerificationWorkspace } from "../verification/evidence";
import { readHome } from "../records/work";
import { combinedItemDetails, includesUnit, requirementApplies, type ItemSelection } from "@/components/workspace/selection";
import { isCatalogArchived } from "@/components/catalog/store";
import { engineeringOverviewRows } from "@/components/engineering/overview";
import { productionBuilds, productionRegister } from "@/components/production/builds";
import { methodEvidence } from "@/components/verification/outcomes";
import { methodIds, methods as testMethods } from "@/components/verification/model";
import { engineeringScope } from "@/components/records/schema";

if (!db) throw Error("Set DATABASE_URL before checking coverage.");
try {
  const [design, factory, tests, home] = await Promise.all([
    readEngineering(db), readProduction(db),
    readVerificationWorkspace(db), readHome(db),
  ]);
  if (!("engineeringWork" in design)) throw Error("Engineering work is unavailable.");
  const { catalog, verification } = tests.records;
  const scopes: ItemSelection[] = [
    ...catalog.projects.filter(({ id }) => !isCatalogArchived(catalog, "project", id)).map(({ id }) => `project:${id}` as const),
    ...catalog.systems.filter(({ id }) => !isCatalogArchived(catalog, "system", id)).map(({ id }) => `system:${id}` as const),
    ...catalog.revisions.filter(({ systemId }) => !isCatalogArchived(catalog, "system", systemId)).map(({ id }) => `revision:${id}` as const),
    ...catalog.units.filter(({ serial }) => !isCatalogArchived(catalog, "unit", serial)).map(({ serial }) => `unit:${serial}` as const),
  ];
  const local = factory.local;
  const builds = productionBuilds(factory.records, local, factory.execution);
  const methods = methodIds.map((id) => methodEvidence(verification, id, tests.reviews, tests.evidenceHistory).map(row => row.record));
  const evidence = methods.flat();
  const assembly = new Map([...design.records.engineering, ...factory.records.production].map(record => [record.id, record]));
  for (const entry of verification.catalogEvidence ?? []) {
    const build = assembly.get(entry.build.id);
    if (!requirementApplies(catalog, entry.requirement.id, entry.unit.revisionId, entry.unit) || assembly.get(entry.requirement.id)?.kind !== "requirement" ||
        !sameUnit(build?.unit, entry.unit)) throw Error("Untraceable evidence: " + entry.id);
    if (!entry.source?.trim() || !entry.observation?.trim() || !entry.supports?.trim())
      throw Error("Evidence is missing its source, observation or supported conclusion: " + entry.id);
  }
  const issueRows = factory.records.production.filter(row => row.kind === "issue");
  const columns = ["Engineering", "Engineering overview", "Active builds", "Completed builds", "Issues", "Production overview",
    "Evidence", "Unit targets", "Acceptance cases", ...methodIds.map(id => testMethods[id].label),
    "Evidence with event clocks", "Archived clock runs", "Evidence with elapsed readings"];
  console.log(["Selection", ...columns].join("\t"));
  for (const scope of scopes) {
    const item = combinedItemDetails(catalog, [scope]);
    if (!item) throw Error("Unreachable Catalog selection: " + scope);
    const visible = (row: (typeof issueRows)[number]) => includesUnit(item, row.unit ?? verification.article) &&
      !isRemovedRecord(row.id, local, row.unit ?? verification.article);
    const unitsBuilds = builds.filter(({record}) => visible(record));
    const issues = issueRows.filter(visible);
    const overview = productionRegister(factory, item, "overview")!.rows;
    const expectedIds = [...unitsBuilds.map(({ record }) => record.id), ...issues.map(issue => issue.id)].sort();
    deepStrictEqual(overview.map(row => row.id).sort(), expectedIds, "Overview differs from Builds and Issues: " + scope);
    const listedIssues = productionRegister(factory, item, "issue")!.rows;
    deepStrictEqual(listedIssues.map(row => row.id).sort(), issues.map(row => row.id).sort(), "Incorrect issue scope: " + scope);

    const scopedMethods = methods.map(entries => entries.filter(({unit}) => includesUnit(item, unit)));
    const scopedEvidence = scopedMethods.flat();
    // A document, image or review may be Electronics evidence without supplying a clocked run.
    const clocks = scopedEvidence.flatMap(record => record.exchangeArchive ?? []);
    const counts = [
      design.records.engineering.filter(engineeringScope(item, local)).length,
      engineeringOverviewRows(design, item).length,
      unitsBuilds.filter(build => build.filter === "active").length,
      unitsBuilds.filter(build => build.filter === "completed").length, issues.length, overview.length,
      scopedEvidence.length, item.members.length,
      verification.acceptanceChecks.filter(({unit}) => includesUnit(item, unit)).length,
      ...scopedMethods.map(entries => entries.length),
      clocks.length,
      clocks.reduce((total, { prior, current }) => {
        return total + new Set([prior, current].filter(log => log.events.length).map(log => log.id)).size;
      }, 0),
      scopedEvidence.filter(record => record.numericSeries?.length).length,
    ];
    console.log([scope, ...counts].join("\t"));
  }
  console.log("Persona\tAssigned work\tWaiting on others");
  for (const {name, id} of home.users) {
    console.log([name, home.items.filter(item => item.assigneeId === id).length,
      home.items.filter(item => item.waitingUserIds.some(person => person === id)).length].join("\t"));
  }
  for (const item of design.workItems) {
    const target = new URL(item.href, "http://localhost");
    const selected = combinedItemDetails(catalog, [target.searchParams.get("item") as ItemSelection]);
    const id = target.hash.slice(1);
    if (!evidence.some(entry => (entry.id === id || entry.capture?.handoffId === id) && includesUnit(selected, entry.unit)))
      throw Error("Unreachable assignment: " + item.id);
  }
} finally {
  await db.$client.end();
}
