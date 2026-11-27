import { acceptanceHref, acceptanceState, imageComparisonConnection, inspectInterval } from "@/components/verification/acceptance";
import { isVerificationTest, methodIds, methods, reviewScopeOptions } from "@/components/verification/model";
import { evidenceSearchText, methodRecords, reviewHistory, verificationOverviewRows } from "@/components/verification/outcomes";
import { combinedItemDetails, includesUnit, type ItemSelection } from "@/components/workspace/selection";
import { db } from "@/db/connection";
import { readVerificationWorkspace } from "@/db/verification/evidence";
import { recordActivity, sameUnit, visibleRecordNotes } from "@/lib/records/journal";
import { filedReference, findingConnection, recordHref, recordUnitLabel } from "@/lib/records/links";
import { toolHref, tools, withSelections } from "@/lib/workspace-routes";
import type { AskContext, AskSource } from "../sources";

type View = "verification-overview" | "evidence" | "acceptance" | "acceptance-history" | "review" | "verification-comparison" | "verification-sources";

export async function verificationSources(view: View, scope: readonly ItemSelection[], context?: AskContext): Promise<AskSource[]> {
  const kind = "Verification" as const;
  if (view === "verification-sources") {
    return (["exchange", "recall"] as const).map(id => ({
      id, kind, title: tools[id].name, excerpt: id === "exchange" ? "Open Sources → Bundles." : "Open Sources → Certificates.",
      href: withSelections(toolHref(id), scope),
    }));
  }
  if (!scope.length) return [];
  if (!db) throw new Error("Database is unavailable");

  const { records: { catalog, verification: data }, evidenceHistory, reviews, findings } = await readVerificationWorkspace(db);
  const item = combinedItemDetails(catalog, scope);
  if (!item) return [];
  const reviewScopes = reviewScopeOptions(catalog, scope);

  if (view === "verification-overview") {
    return verificationOverviewRows(item, data, reviews, evidenceHistory, reviewScopes).map(row => ({
      id: row.id, kind, title: row.title, excerpt: [row.status, `${row.evidenceCount} evidence records`,
        row.activity && `Last activity ${row.activity}`].filter(Boolean).join(" · "),
      href: withSelections("/verification?view=" + row.id, scope),
    }));
  }
  if (view === "verification-comparison") {
    return data.acceptanceChecks.filter(check => includesUnit(item, check.unit)).flatMap(check => {
      const pair = check.comparison;
      const link = imageComparisonConnection(check);
      if (!pair || !link) return [];
      const unit = recordUnitLabel(check.unit);
      const interval = inspectInterval(pair, 1, pair.frames.length);
      const saved = findings.filter(f => f.checkId === check.id && sameUnit(f, check.unit) && f.archiveId === pair.evidenceId);

      return [
        { id: pair.evidenceId, ref: check.id, kind, title: link.label, href: link.href,
          excerpt: [unit, "Original: " + pair.run, "Rerun: " + pair.rerun, pair.frames.length + " paired frames",
            interval && `Identification visible in ${interval.original} original and ${interval.repeat} rerun frames`,
            saved.length + " filed findings"].filter(Boolean).join(" · ") },
        ...saved.map(f => {
          const finding = findingConnection(f);
          return { id: f.id, kind, title: finding.label, href: finding.href,
            excerpt: [unit, f.archive?.run, f.archive?.rerun, f.observation].filter(Boolean).join(" · ").slice(0, 550) };
        }),
      ];
    });
  }
  if (view === "acceptance" || view === "acceptance-history") {
    return data.acceptanceChecks.filter(check => includesUnit(item, check.unit)).flatMap(check => {
      const state = acceptanceState(check);
      if (view === "acceptance-history") {
        return state.submissions.map(capture => ({
          id: capture.id, kind, title: state.artifact.title + " · " + capture.recordedAt, href: acceptanceHref(check, capture.id),
          excerpt: [recordUnitLabel(check.unit), capture.id === state.current?.id ? "Current" : "Superseded",
            capture.review?.decision ?? "No decision filed", capture.review?.reviewer, capture.source, capture.observation].filter(Boolean).join(" · ").slice(0, 550),
        }));
      }
      return [{
        id: check.id, kind, title: state.artifact.title, href: acceptanceHref(check),
        excerpt: [recordUnitLabel(check.unit), state.stage, check.owner, state.blocker, state.nextAction].filter(Boolean).join(" · "),
      }];
    });
  }

  const method = context?.method ?? (context?.path === "/verification" ? context.view : undefined);
  const selectedMethods = isVerificationTest(method) ? [method] : methodIds;
  return selectedMethods.flatMap(test => {
    const { records, visibleReviews } = methodRecords({ test, data, item, reviews, activity: evidenceHistory, reviewScopes });
    // For these archival methods the assistant reports record identity and disposition only.
    const documentary = test !== "ground-firing" && test !== "pressure";
    if (view === "review") {
      return reviewHistory(data, visibleReviews, reviewScopes).map(({ review, reviewer, scopeLabel, label, links }) => ({
        id: review.id, kind, title: `${methods[test].label} · ${label}`,
        excerpt: [scopeLabel, reviewer, review.recordedAt, ...links.map(link => link.title), documentary && review.reason].filter(Boolean).join(" · ").slice(0, 550),
        href: withSelections(recordHref("verification", review.id, undefined, { view: test }), scope),
      }));
    }
    const filters = context?.path === "/verification" && context.view === test ? context : undefined;
    const choice = test === "ground-firing" ? filters?.type : filters?.status;
    const terms = filters?.q?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const matches = records.filter(row => (!choice || choice === "All" || choice === (test === "ground-firing" ? row.record.type : row.status ?? "Needs review"))
      && terms.every(term => evidenceSearchText(row).toLocaleLowerCase().includes(term)));

    return matches.toSorted((a, b) => (b.record.recordedAt ?? "").localeCompare(a.record.recordedAt ?? "")).map(({ record, status, retest }) => {
      const reference = filedReference(record.reference);
      const unit = record.unit ?? data.article;
      const notes = documentary && context?.id === record.id
        ? visibleRecordNotes(recordActivity(evidenceHistory, record.id, unit)).slice(0, 3).map(note => note.description)
        : [];

      return {
        id: record.id, ref: reference, kind, title: [reference, record.title].filter(Boolean).join(" · "),
        excerpt: [methods[test].label, recordUnitLabel(unit), record.type, status ?? "Needs review", retest && `Retest ${retest}`,
          record.recordedAt, documentary && record.observation, ...notes].filter(Boolean).join(" · ").slice(0, 650),
        href: recordHref("verification", record.id, unit, { view: test }),
      };
    });
  });
}
