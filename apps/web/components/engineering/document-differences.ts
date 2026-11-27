import type { DesignEdition } from "@/db/engineering/design";

type Edition = Pick<DesignEdition, "fields" | "figure">;
type Figure = NonNullable<Edition["figure"]>;
type Box = { x: number; y: number; width: number; height: number };
export type DocumentField = {
  key: string; label: string; before?: string; after?: string;
  earlierBox?: Box; comparedBox?: Box; changed: boolean; difference: string; positionNote?: string;
};

export function sameRegistration(a?: Figure | null, b?: Figure | null) {
  return Boolean(a?.registrationId && a.registrationId === b?.registrationId);
}

function normalizedBox(figure: Figure | null, key: string): Box | undefined {
  const box = figure?.regions.find(r => r.fieldKey === key);
  if (!box || !figure || figure.width <= 0 || figure.height <= 0) return;
  return { x: box.x / figure.width, y: box.y / figure.height, width: box.width / figure.width, height: box.height / figure.height };
}

export function comparisonFields(earlier: Edition, later: Edition): DocumentField[] {
  const old = new Map(earlier.fields.map(f => [f.key, f]));
  const current = new Map(later.fields.map(f => [f.key, f]));
  const registration = sameRegistration(earlier.figure, later.figure);
  return [...new Map([...old, ...current])].map(([key, field]) => {
    const before = old.get(key), after = current.get(key);
    const earlierBox = normalizedBox(earlier.figure, key), comparedBox = normalizedBox(later.figure, key);
    const placed = registration && earlierBox && comparedBox;
    const moved = placed && (earlierBox.x !== comparedBox.x || earlierBox.y !== comparedBox.y);
    const resized = placed && (earlierBox.width !== comparedBox.width || earlierBox.height !== comparedBox.height);
    const textChanged = before?.value !== after?.value;
    let positionNote: string | undefined;
    if (!before && !comparedBox) positionNote = "The compared edition records this field without a sheet region.";
    else if (!after && !earlierBox) positionNote = "The earlier edition records this field without a sheet region.";
    else if (before && after && !placed) {
      if (!registration) positionNote = "The two editions do not have a shared sheet registration.";
      else positionNote = "A sheet region is missing for this field in one or both editions.";
    }
    const difference = before && after
      ? [textChanged ? "Text changed" : "Text unchanged", moved && "Moved", resized && "Resized",
          !placed ? "Placement unknown" : !moved && !resized && "Placement unchanged"]
      : [before ? "Removed" : "Added", positionNote && "Placement unknown"];
    return { key, label: field.label, before: before?.value, after: after?.value, earlierBox, comparedBox,
      changed: Boolean(!before || !after || textChanged || moved || resized), difference: difference.filter(Boolean).join(" · "), positionNote };
  });
}
