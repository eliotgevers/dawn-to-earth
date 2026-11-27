import type { StudyFiling } from "@/lib/archives/study";

// This edition pins the two cutaway drawings and their archived inspection sheets.
export const edition = "display-port-a-b-archive-1";
export const source = "https://www.dawnaerospace.com/latest-news/dft-port-environmental-qualification";

export const outcomes = ["Reuse evidence", "Do not reuse", "Leave unresolved", "Request evidence"] as const;
type Observation = {
  sheet: string;
  description: string;
  artwork?: string;
  entries?: { label: string; value: string; sourceId: string }[];
};
export type Feature = {
  id: string;
  name: string;
  question: string;
  basis: string;
  coverage: "Comparable" | "Changed" | "Missing view";
  reference: Observation;
  proposed: Observation | null;
  request: string;
  registration?: string;
  origin?: string;
};

export type InterfaceRecord = {
  key: string;
  name: string;
  connection: string;
  editions: readonly [string, string];
  features: readonly string[];
  filing: StudyFiling;
  archiveEdition?: string;
  records?: { requirement: string; reference: string; evidence: string; method: string };
  programContext?: boolean;
  fixtureViews?: readonly { image: string; caption: string }[];
};

// The filing describes the common interface. Each feature is a separately reviewable claim.
export const interfaces: readonly InterfaceRecord[] = [
  {
    key: "sample-tray", archiveEdition: "sample-tray-ts01-ts02-archive-1", name: "Sample tray and stand", connection: "Tray contact edge ↔ stop face",
    fixtureViews: [
      { image: "/study-media/tray-rigid.webp", caption: "Rigid stop" },
      { image: "/study-media/tray-soft.webp", caption: "Soft stop" },
    ],
    editions: ["TS-01", "TS-02"], features: ["tray-edge", "tray-index"],
    filing: { projectId: "public-dorbit-pulse", serial: "REF-PULSE-01", revisionId: "public-dorbit-pulse-ref" },
    records: { requirement: "bench-tray-stop-requirement", reference: "REQ-1103", evidence: "bench-tray-stop-evidence", method: "vibration" },
  },
  {
    key: "display-port", name: "Panel face and cover", connection: "Front marking plate ↔ transparent cover",
    editions: ["A", "B"], features: ["marking-window", "witness-stripe", "cover-tag"],
    filing: { projectId: "public-aule-docking", serial: "REF-AULE-01", revisionId: "public-aule-docking-ref" },
    programContext: true,
  },
  {
    key: "indicator-enclosure", archiveEdition: "indicator-enclosure-ic01-ic02-archive-1", name: "Indicator lead and lid",
    connection: "Lead sleeve ↔ enclosure lid", editions: ["IC-01", "IC-02"], features: ["lid-response"],
    filing: { projectId: "public-astroforge-odin", serial: "REF-ODIN-01", revisionId: "public-astroforge-odin-ref" },
    records: { requirement: "bench-cover-lead-requirement", reference: "REQ-1101", evidence: "bench-cover-lead-evidence", method: "communication" },
  },
  {
    key: "caption-display", name: "Caption and color key", connection: "Caption pointer ↔ swatch legend",
    editions: ["A", "B"], features: ["caption-pointer"],
    filing: { projectId: "public-georyder", serial: "REF-GEO-01", revisionId: "public-georyder-ref" },
  },
  {
    key: "display-index", name: "Index band and panel", connection: "Index marks ↔ panel opening",
    editions: ["A", "B"], features: ["index-notches"],
    filing: { projectId: "public-dawn-loop", serial: null, revisionId: "public-dawn-loop-ref" },
    programContext: true,
  },
];

const traySource = {
  origin: "Illustrated excerpts from the TS-01 and TS-02 stand inspection.",
  registration: "The stand index is fixed in both sheets.",
};
const trayRigid = { sheet: "A-TRAY-06", artwork: "/docking/A-TRAY-06-7ebed73646d3.svg" };
const traySoft = { sheet: "B-TRAY-06", artwork: "/docking/B-TRAY-06-d40c13a41d70.svg" };

export const features: readonly Feature[] = [
  {
    id: "marking-window",
    name: "Identifier window",
    question: "Does the window still show the complete N4 identifier?",
    basis: "The lettering and border stayed the same. A reuse judgment here covers reading the identifier from the front only.",
    coverage: "Comparable",
    reference: { sheet: "A-FACE-01", artwork: "/docking/A-FACE-01-de2e6894cd20.svg", description: "N4 sits entirely inside the window. Both side margins are visible." },
    proposed: { sheet: "B-FACE-01", artwork: "/docking/B-FACE-01-bef2587bd8a6.svg", description: "The full N4 and both side margins remain visible in the front view." },
    request: "Identify the extra view needed to judge the identifier.",
  },
  {
    id: "witness-stripe",
    name: "Witness stripe",
    question: "Does the old appearance record cover the revised witness stripe?",
    basis: "A reader using the old appearance sheet would treat B’s deliberate break as a defect. The B sheet is the source for the revised mark.",
    coverage: "Changed",
    reference: { sheet: "A-STRIPE-02", artwork: "/docking/A-STRIPE-02-fa965195b07b.svg", description: "A single charcoal stripe crosses the amber panel." },
    proposed: { sheet: "B-STRIPE-02", artwork: "/docking/B-STRIPE-02-6e0fe9bd3de2.svg", description: "A visible amber gap separates the two charcoal strokes." },
    request: "Describe the observation needed for the two-part mark.",
  },
  {
    id: "cover-tag",
    name: "Dust-cover tag",
    question: "Can a reader still see the tag under the revised cover?",
    basis: "The B drawing puts the cover edge over the tag. Its front sheet leaves the exposed face out of view. An underside observation is needed to judge readability.",
    coverage: "Missing view",
    reference: { sheet: "A-TAG-03", artwork: "/docking/A-TAG-03-ba98b299cb0b.svg", description: "The inspection sheet shows the complete amber tag beneath the clear cover." },
    proposed: null,
    request: "Specify the missing view and which part of the tag it must show.",
  },
  {
    id: "caption-pointer",
    name: "Caption pointer",
    question: "Does the caption still point unambiguously to the teal swatch?",
    basis: "The old inspection supports the teal swatch in A. In B the tip lands in the gap, so the A image cannot settle which swatch a reader would identify.",
    coverage: "Changed",
    reference: { sheet: "A-POINTER-04", artwork: "/docking/A-POINTER-04-14ccac7604e5.svg", description: "The pointer ends inside the teal swatch." },
    proposed: { sheet: "B-POINTER-04", artwork: "/docking/B-POINTER-04-994960acd253.svg", description: "The pointer ends at the pale gap between the two swatches." },
    request: "Describe the revised pointer view needed to identify a single swatch.",
  },
  {
    id: "index-notches",
    name: "Index marks",
    question: "Can all four marks still be counted on the display band?",
    basis: "The face detail from A shows the complete index. For B, a reviewer needs to decide whether three visible marks still support the intended reading.",
    coverage: "Changed",
    reference: { sheet: "A-INDEX-05", artwork: "/docking/A-INDEX-05-77c750640a6b.svg", description: "Four ivory marks stand apart on the charcoal band." },
    proposed: { sheet: "B-INDEX-05", artwork: "/docking/B-INDEX-05-4ae7cabad1c4.svg", description: "The amber panel hides the third mark. Three remain visible from the face." },
    request: "Describe the reading to check with the revised band.",
  },
  {
    ...traySource, id: "tray-edge", name: "Contact edge",
    question: "Does the revised stop leave the edge of the tray unmarked?",
    basis: "The soft stop removed the visible scuff in this comparison. That observation covers the edge surface only. The tray’s final position is a separate claim.",
    coverage: "Changed",
    reference: { ...trayRigid, description: "The rigid stop left a scuff where the tray contacted the stand." },
    proposed: { ...traySoft, description: "The contact edge stayed clean against the soft stop after the same recorded motion." },
    request: "Identify the edge condition that needs another inspection.",
  },
  {
    ...traySource, id: "tray-index", name: "Index alignment",
    question: "Does the tray return to the stand’s index after the stop material changes?",
    basis: "A clean edge cannot establish the registration of the tray. The stand mark stayed fixed, but the soft-stop inspection shows the tray mark displaced.",
    coverage: "Changed",
    reference: { ...trayRigid, description: "The tray mark lined up with the stand index after contact with the rigid stop." },
    proposed: { ...traySoft, description: "The tray mark finished beyond the stand index with the soft stop." },
    request: "Specify the registration view needed to judge the revised tray.",
  },
  {
    id: "lid-response", name: "Lid-closed reply",
    question: "Does the indicator still reply with the lid closed after the clip moves?",
    origin: "Archived reply records from the IC-01 and IC-02 indicator comparison.",
    basis: "The closed-lid reply appears with the offset clip. The log establishes communication in these two lid positions. Rear-port access remains unobserved.",
    coverage: "Changed",
    reference: {
      sheet: "IC-01", description: "Center clip. The reply appears with the lid open. The closed-lid request has no recorded reply.",
      entries: [
        { label: "Lid open", value: "Indicator visible", sourceId: "IC-01-open-lid-out" },
        { label: "Lid closed", value: "No reply recorded", sourceId: "IC-01-closed-lid-in" },
      ],
    },
    proposed: {
      sheet: "IC-02", description: "Offset clip. Both the open-lid and closed-lid requests have a recorded reply.",
      entries: [
        { label: "Lid open", value: "Indicator visible", sourceId: "IC-02-open-lid-out" },
        { label: "Lid closed", value: "Indicator visible", sourceId: "IC-02-closed-lid-out" },
      ],
    },
    request: "Identify the additional observation needed for the revised clip.",
  },
];

export function interfaceFor(featureId: string) {
  return interfaces.find(record => record.features.includes(featureId));
}

// Both the record list and the open comparison resolve the same filed inspection point.
export function selectInterface(subjects: readonly string[], query: URLSearchParams, findingSubject?: string) {
  const keys = new Set(subjects.map(subject => subject.split("/")[0]));
  const historicalKey = findingSubject?.split("/")[0];
  if (historicalKey) keys.add(historicalKey);
  const records = interfaces.filter(record => keys.has(record.key));
  const request = query.get("compare");
  if (!request) return { records };
  const point = query.get("feature");
  const explicitKey = request === "interface" ? undefined : request;
  const key = historicalKey ?? (point ? interfaceFor(point)?.key : explicitKey);
  const record = key ? records.find(row => row.key === key) : records.length === 1 ? records[0] : undefined;
  if (!record) return { records, unavailable: !!key || !!point || !records.length };
  if ((explicitKey && record.key !== explicitKey) || (point && !record.features.includes(point)))
    return { records, unavailable: true };

  const points = features.filter(feature => record.features.includes(feature.id));

  return { records, record, points, feature: points.find(feature => feature.id === point) ?? points[0] };
}

export function subjectFor(record: InterfaceRecord, featureId: string) {
  return [record.key, record.editions.join("+"), featureId].join("/");
}

export type DockingSource = {
  label: string;
  edition: string;
  referenceRevision: string;
  proposedRevision: string;
  feature: Feature;
};

export function sourceFor(subject: string): DockingSource | undefined {
  const [key, , featureId] = subject.split("/");
  const record = interfaces.find(item => item.key === key);

  if (!record || !record.features.includes(featureId) || subjectFor(record, featureId) !== subject) return;
  const feature = features.find(item => item.id === featureId);
  if (!feature) return;

  return {
    label: feature.name,
    edition: record.archiveEdition ?? edition,
    referenceRevision: record.editions[0],
    proposedRevision: record.editions[1],
    feature,
  };
}

function isObservation(value: unknown): value is Observation {
  return !!value && typeof value === "object" && "sheet" in value && typeof value.sheet === "string"
    && "description" in value && typeof value.description === "string"
    && (!("entries" in value) || (Array.isArray(value.entries) && value.entries.every(entry =>
      entry && typeof entry === "object" && typeof entry.label === "string"
      && typeof entry.value === "string" && typeof entry.sourceId === "string")))
    && (!("artwork" in value) || (typeof value.artwork === "string" && /^\/docking\/[AB]-[A-Z]+-\d+-[0-9a-f]{12}\.svg$/.test(value.artwork)));
}

export function isDockingSource(value: unknown): value is DockingSource {
  if (!value || typeof value !== "object" || !("feature" in value) || !value.feature
      || typeof value.feature !== "object") return false;
  const feature = value.feature;

  return "edition" in value && typeof value.edition === "string"
    && "label" in value && typeof value.label === "string"
    && "referenceRevision" in value && typeof value.referenceRevision === "string" && !!value.referenceRevision.trim()
    && "proposedRevision" in value && typeof value.proposedRevision === "string" && !!value.proposedRevision.trim()
    && "id" in feature && typeof feature.id === "string" && "name" in feature && typeof feature.name === "string"
    && "question" in feature && typeof feature.question === "string" && "basis" in feature && typeof feature.basis === "string"
    && "coverage" in feature && ["Comparable", "Changed", "Missing view"].includes(String(feature.coverage))
    && "reference" in feature && isObservation(feature.reference)
    && "proposed" in feature && (feature.proposed === null || isObservation(feature.proposed))
    && (!("origin" in feature) || typeof feature.origin === "string")
    && (!("registration" in feature) || typeof feature.registration === "string")
    && "request" in feature && typeof feature.request === "string";
}

export function reviewOutcomes(feature: Feature) {
  return outcomes.filter(outcome => outcome !== "Reuse evidence" || feature.coverage === "Comparable");
}
