import { test } from "bun:test";
import { mergeEvidence } from "../seed/preserve";
import assert from "node:assert/strict";

test("re-bootstrap preserves authored observations, review bases, and a reader's ordering", () => {
  // Two whole records from the earlier published seed. The manifest recognizes these field values.
  const unit = { serial: "LK-014", revisionId: "bench-a", revision: "Rev A" };
  const original = [
    {
      id: "leak-joint-inspection", title: "Seal witness-mark inspection", type: "Inspection", unit,
      observation: "Witness marks aligned with the pre-capture reference image.",
      source: "Joint inspection sheet · L14-B", supports: "Alignment of the recorded witness marks.",
      relatedEvidenceIds: ["leak-capture"],
    },
    {
      id: "bracket-fit-evidence", title: "Bracket fit follow-up", type: "Inspection", unit, content: "bracket",
      supports: "Observed fit of the replacement bracket following rework.",
      source: "Bracket rework fit inspection · VI14-B",
    },
  ];
  const curated = [...original.map(row => ({ ...row, observation: "Editorial correction" })), { id: "extra", title: "New attachment", observation: "New attachment" }];
  const saved = [{ ...original[0], id: "my-observation", observation: "My entry" }, original[1], original[0], { id: "local", title: "Personal attachment", observation: "Personal attachment" }];
  const retained = new Set([original[0].id]);
  const result = mergeEvidence(saved, curated, retained);
  assert.deepEqual(result, [saved[0], curated[1], original[0], saved[3], curated[2]]);
  assert.deepEqual(mergeEvidence(result, curated, retained), result);
  const edited = { ...original[1], observation: "My new fit observation" };
  assert.deepEqual(mergeEvidence([edited], [curated[1]], new Set()), [edited]);
});
