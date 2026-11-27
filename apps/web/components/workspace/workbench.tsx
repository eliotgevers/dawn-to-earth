"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { watchRecordFocus, useItemSelection } from "@/components/workspace/navigation";
import { MissingRecord, SectionTabs, SectionSubview } from "./section-tabs";
import { includesUnit, type SelectedItem } from "@/components/workspace/selection";
import { tools, toolHref, toolTab, withSelections } from "@/lib/workspace-routes";
import { caseMatches, type ToolCommand, type ToolContext, type ToolId } from "@/db/workflows/cases";

export type ToolProps = ToolContext & {
  personName: (id: unknown, fallback?: string) => string;
  selectedItem?: SelectedItem;
  submit: (command: Omit<ToolCommand, "dossier">) => Promise<{ eventId: string; error?: never } | { error: string; eventId?: never }>;
};

function scopedCases({ cases, dossier }: ToolContext, selected: SelectedItem | undefined, caseId: string | undefined, explicitScope: boolean) {
  if (caseId) {
    const missing = !dossier || (explicitScope && dossier.unit && !includesUnit(selected, dossier.unit));
    return { rows: cases, missing: missing ? caseId : undefined };
  }
  if (!selected) return { rows: cases };

  const rows = cases.filter(row => caseMatches(row, selected));
  return { rows, empty: !rows.length };
}

export function Workbench({ tool, View, state, caseId, save }: {
  tool: ToolId;
  View: ComponentType<ToolProps>;
  state: ToolContext;
  caseId?: string;
  save: ToolProps["submit"];
}) {
  const { workspace } = state;
  const { item, selections, selectionUrl, selectItems } = useItemSelection(workspace.catalog);
  const scoped = scopedCases(state, item, caseId, new URLSearchParams(selectionUrl).has("item"));
  const router = useRouter();
  const names = new Map<unknown, string>(workspace.actors.map(({ id, name }) => [id, name]));
  const [missingAnchor, setMissingAnchor] = useState("");
  useEffect(() => watchRecordFocus(undefined, setMissingAnchor), [state, selectionUrl]);
  const submit: ToolProps["submit"] = async (command) => {
    try {
      return await save(command);
    } catch {
      return { error: "Connection lost. Reopen the case before retrying." };
    }
  };
  const section = tools[tool].section;
  const parent = toolTab(tool).id;
  return (
    <SectionTabs section={section} active={parent} catalog={workspace.catalog} selections={selections}
        onChange={next => {
          selectItems(next);
          if (caseId) router.replace(withSelections(toolHref(tool), next), { scroll: false });
        }}>
          <SectionSubview section={section} parent={parent} active={tool} selections={selections}>
            {parent === "build" && !caseId && (
              <h2 className="mb-2.75">
                {tool === "traveler" ? "Traveler" : "Completed order studies"}
              </h2>
            )}
            {scoped.missing ? <MissingRecord id={scoped.missing} /> : scoped.empty && tool !== "audit" ? (
              <p className="mt-0.5 text-xs text-muted-foreground">Unavailable</p>
            ) : (
              <>
                {missingAnchor && <MissingRecord id={missingAnchor} />}
                <View
                  key={caseId ?? tool}
                  {...state}
                  cases={scoped.rows}
                  personName={(id, fallback = "Unavailable") => names.get(id) ?? fallback}
                  selectedItem={item}
                  submit={submit}
                />
              </>
            )}
          </SectionSubview>
    </SectionTabs>
  );
}
