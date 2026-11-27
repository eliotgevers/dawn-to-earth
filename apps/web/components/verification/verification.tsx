"use client";

import { EmptyRecords } from "@/components/records/empty";
import { useEffect, useRef, useState } from "react";
import { WorkspaceOverview } from "@/components/records/layout";
import { MissingRecord, SectionTabs } from "@/components/workspace/section-tabs";
import { coreView, withSelections } from "@/lib/workspace-routes";
import { useSearchParams } from "next/navigation";
import { unitSelection, includesUnit, type SelectedItem } from "@/components/workspace/selection";
import {
  useItemSelection,
  clearRecordHash,
  focusRecordToolbar,
  focusRelatedRecord,
  replaceRecordHash,
  watchRecordLinks,
} from "@/components/workspace/navigation";
import {
  reviewRecord,
  reviewTest,
  methodIds, isVerificationTest,
  reviewScopeOptions,
  type EvidenceReview,
  type VerificationRecords,
  type VerificationTest,
} from "./model";
import { type RecordEntry } from "@/lib/records/journal";
import { useVerification } from "@/lib/workspace";
import { RelatedWork } from "@/components/workspace/related-work";
import { AcceptancePanel } from "./acceptance-panel";
import { VerificationMethod } from "@/components/verification/evidence";

import { verificationOverviewRows, methodEvidence, reviewInSelection } from "./outcomes";


function linkedEvidence(
  id: string,
  data: VerificationRecords,
  reviews: readonly EvidenceReview[],
) {
  const check = data.acceptanceChecks?.find(check => check.id === id || check.captures?.some(capture => capture.id === id));
  if (check) return { view: "overview" as const, id, unit: check.unit };
  const found = reviewRecord(data, id);
  if (!found?.record) {
    const review = reviews.find(entry => entry.id === id);
    const source = data.catalogEvidence?.find(row => row.review?.id === id);
    const archived = data.groundFiringFixture?.review;
    const test = review ? reviewTest(data, review) : source?.test ??
      (archived?.id === id ? "ground-firing" : methodIds.find(method => id === `review-history-${method}`));
    return test ? { view: test, id, history: true as const, review, unit: source?.unit ?? (archived?.id === id ? data.article : undefined) } : undefined;
  }
  const { record, test } = found;
  if (record.capture?.replaces) {
    const open = methodEvidence(data, test, reviews, [], record.id).find(row => row.record.id === record.id)?.opens;
    return open ? { view: test, id: open } : undefined;
  }
  return { view: test, id: record.id };
}

// Evidence can be inspected outside its unit, but a review belongs to its filed scope.
function unavailableReview(target: ReturnType<typeof linkedEvidence>, item: SelectedItem | undefined,
  data: VerificationRecords, scopes: ReturnType<typeof reviewScopeOptions>) {
  if (target?.unit && !includesUnit(item, target.unit)) return target.id;
  if (target?.review && !reviewInSelection(target.review, data, item, scopes)) return target.id;
}

function useEvidenceNavigation(tab: string, selectionUrl: string, data: VerificationRecords, reviews: readonly EvidenceReview[]) {
  const pendingFocus = useRef<string | null>(null);
  const previousView = useRef(tab);
  const [selected, setSelected] = useState<string>();
  const [target, setTarget] = useState<ReturnType<typeof linkedEvidence>>();
  const [missing, setMissing] = useState<string>();
  const linked = target?.id;

  function noteSaved(record: RecordEntry) {
    if (!record.test) return;
    replaceRecordHash(record.id);
    pendingFocus.current = record.id;
    setMissing(undefined);
    setSelected(record.id);
    setTarget({ view: record.test, id: record.id });
  }

  function removeNote(id: string) {
    clearRecordHash(id);
    setSelected((current) => (current === id ? undefined : current));
    setTarget(current => current?.id === id ? undefined : current);
    pendingFocus.current = null;
    focusRecordToolbar();
  }

  useEffect(
    () =>
      watchRecordLinks((id, event) => {
        setMissing(undefined);
        const switched = previousView.current !== tab;
        previousView.current = tab;
        if (!id) {
          setTarget(undefined);
          if (event || switched) setSelected(undefined);
          pendingFocus.current = null;
          return;
        }
        const target = linkedEvidence(id, data, reviews);
        const url = new URL(window.location.href);
        if (!target) {
          if (document.getElementById(id)) return;
          setMissing(id);
          setSelected(undefined);
          setTarget(undefined);
          pendingFocus.current = null;
          return;
        }
        if (target.view === "overview" && !url.searchParams.has("item")) {
          url.searchParams.set("item", unitSelection(target.unit.serial, target.unit.revisionId));
          window.history.replaceState(window.history.state, "", url);
        }
        pendingFocus.current = id;
        setTarget(target);
        setSelected(target.id);
      }),
    [tab, data, reviews, selectionUrl],
  );

  useEffect(() => {
    const id = pendingFocus.current;
    if (id && linked) {
      // Browser Back restores scroll after popstate; the destination may mount after the route refresh.
      const frame = requestAnimationFrame(() => {
        if (focusRelatedRecord(id) || focusRelatedRecord(linked)) pendingFocus.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [linked, selected, data]);

  return { target, selected, missing, setSelected, setTarget, noteSaved, removeNote };
}

export function Verification({ localWorkspace }: { localWorkspace: boolean }) {
  const query = useSearchParams();
  const tab = coreView("verification", query.get("view"));
  const workspace = useVerification();
  const { records: { verification: data, catalog }, evidenceHistory, reviews, toolTasks } = workspace;
  const { item, selections, selectItems, selectionUrl } = useItemSelection(catalog);
  const { target, selected, missing, setSelected, setTarget, noteSaved, removeNote } =
    useEvidenceNavigation(tab, selectionUrl, data, reviews);
  const linked = target?.id;
  const active = target?.view ?? tab;
  const reviewScopes = reviewScopeOptions(catalog, selections);
  const unavailable = missing ?? (query.has("item") ? unavailableReview(target, item, data, reviewScopes) : undefined);
  const focusHeading = useRef(false);

  function openTest(id: VerificationTest) {
    focusHeading.current = true;
    setSelected(undefined);
    window.history.pushState(null, "", withSelections("/verification?view=" + id, selections));
  }

  function evidenceHeading(heading: HTMLHeadingElement | null) {
    if (focusHeading.current && heading) {
      heading.focus();
      focusHeading.current = false;
    }
  }

  let content = <EmptyRecords unselected />;
  if (unavailable) {
    content = <MissingRecord id={unavailable} />;
  } else if (isVerificationTest(active)) {
    if (item || linked) content = (
      <VerificationMethod
        key={active}
        localWorkspace={localWorkspace}
        test={active}
        item={item}
        data={data}
        reviews={reviews}
        activity={evidenceHistory}
        removeNote={removeNote}
        reviewScopes={reviewScopes}
        selectedId={selected}
        exact={target?.history ? undefined : linked}
        evidenceHeading={evidenceHeading}
        noteSaved={noteSaved}
        onSelect={(id) => setSelected((current) => (current === id ? undefined : id))}
      />
    );
  } else if (item) {
    content = <>
      <WorkspaceOverview kind="verification" openTest={openTest} rows={verificationOverviewRows(item, data, reviews, evidenceHistory, reviewScopes)} />
      <AcceptancePanel checks={data.acceptanceChecks.filter(check => includesUnit(item, check.unit))}
        linked={linked} onCollapse={() => setTarget(undefined)} />
      <RelatedWork item={item} section="verification" tasks={toolTasks} />
    </>;
  }

  return (
    <SectionTabs section="verification" active={active} catalog={catalog} selections={selections} onChange={selectItems}>
      {content}
    </SectionTabs>
  );
}
