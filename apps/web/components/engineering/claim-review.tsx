import { TableColumns } from "@/components/records/table";
import { useState } from "react";
import { LabeledSelect, TextField, NoteField } from "@/components/records/forms";
import { assumptions, compareStudy, outcomes, type ClaimStudy, type Judgment } from "@/db/workflows/qualification";

export type DraftJudgment = Omit<Judgment, "outcome"> & { outcome: Judgment["outcome"] | "" };

export function ClaimReview({ study, analysis, rowId, title, draft, editable, onChange }: {
  study: ClaimStudy; analysis: ReturnType<typeof compareStudy>; rowId: string; title: string; draft?: DraftJudgment; editable: boolean;
  onChange: (entry: DraftJudgment) => void;
}) {
  const choice = draft ?? { rowId, assumption: "recorded", outcome: "", reason: "" };
  const values = study.samples.flatMap(s=>s.value===null ? [] : [s.value]);
  const quantity = (v: number | null) => displayValue(v,study.unit);
  const range = [...new Set(values)].sort((a,b)=>a-b).map(quantity).join(", ") || "Unavailable";
  const citations = choice.citations ?? [];
  const isObservation = study.valueRole === "observed-result";
  function cite(locator: string, checked: boolean) {
    onChange({ ...choice, citations: checked ? [...citations, locator] : citations.filter(saved => saved !== locator) });
  }
  return <section className="grid min-w-0 gap-3" aria-label={title+" comparison"}>
    <dl className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-2">
      <div><dt className="mt-0.5 text-xs text-muted-foreground">Tested configuration · {study.dependency}</dt>
        <dd>{study.testedConfiguration}</dd><dt className="mt-0.5 text-xs text-muted-foreground mt-2">{study.quantity}</dt><dd>{range}</dd></div>
      <div><dt className="mt-0.5 text-xs text-muted-foreground">Proposed configuration · {study.dependency}</dt>
        <dd>{study.proposedConfiguration ?? "Unavailable"}</dd><dt className="mt-0.5 text-xs text-muted-foreground mt-2">{study.quantity}</dt>
        <dd>{quantity(study.proposedValue)}</dd><dd className="mt-0.5 text-xs text-muted-foreground">{study.targetSource}</dd></div>
    </dl>
    <ObservationSources study={study} title={title} editable={editable} citations={citations}
      onCite={cite} hasMissing={analysis.missing > 0} />
    <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">{comparisonNote(study, analysis)}</p>
    {editable && !isObservation && values.length > 0 && <TrialValue study={study} assumption={choice.assumption}/>}
    {editable ? <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <LabeledSelect label="Dependency basis" value={choice.assumption} options={Object.entries(assumptions).map(([value,label])=>({value,label}))}
          onChange={v=>{if(v && Object.hasOwn(assumptions,v)) {
            const assumption = v as Judgment["assumption"];
            onChange({...choice,assumption,outcome:choice.outcome==="applies" && compareStudy(study,assumption).result!=="Match" ? "" : choice.outcome});
          }}} />
        <LabeledSelect label="Claim decision" placeholder="Choose a decision" value={choice.outcome || null}
          options={Object.entries(outcomes).filter(([key])=>key!=="applies" || analysis.result==="Match").map(([value,label])=>({value,label}))}
          onChange={v=>{if(v && Object.hasOwn(outcomes,v)) onChange({...choice,outcome:v as Judgment["outcome"]});}} />
      </div>
      <NoteField label={<>Claim reason<span className="sr-only"> for {title}</span></>}
        form="qualification-proposal" required maxLength={1000} value={choice.reason}
          onChange={e=>onChange({...choice,reason:e.currentTarget.value})} />
    </> : choice.outcome ? <p className="text-sm"><strong>{outcomes[choice.outcome]}</strong> · {assumptions[choice.assumption]}<br/>{choice.reason}</p> : null}
  </section>;
}

function ObservationSources({ study, title, citations, editable, onCite, hasMissing }: {
  study: ClaimStudy; title: string; citations: string[]; editable: boolean; hasMissing: boolean;
  onCite: (locator: string, checked: boolean) => void;
}) {
  const cited = new Set(citations);
  return (
    <details open={study.valueRole === "observed-result" || cited.size > 0 ? true : undefined}>
      <summary className="w-fit cursor-pointer font-medium">{hasMissing ? "Archive entries" : "Original observations"} ({study.samples.length})</summary>
      <table className="mt-2 w-full text-left text-sm">
        <TableColumns
          caption={`${title} archived observations and citations`}
          labels={["Source locator", study.quantity, "Recorded result", ...(editable || cited.size ? ["Cited"] : [])]}
        />
        <tbody className="divide-y">{study.samples.map(sample => <tr key={sample.locator}>
          <th className="py-1 pr-2 font-normal" scope="row">{sample.locator}</th>
          <td className="pr-2">{displayValue(sample.value, study.unit)}</td><td>{sample.finding === "Unrecorded" ? "No observation filed" : sample.finding}</td>
          {editable ? <td><label className="inline-flex min-h-8 min-w-8 items-center justify-center">
            <input type="checkbox" checked={cited.has(sample.locator)}
              onChange={event => onCite(sample.locator, event.currentTarget.checked)} />
            <span className="sr-only">Cite {sample.locator}</span>
          </label></td> : cited.size > 0 && <td>{cited.has(sample.locator) ? "Yes" : "—"}</td>}
        </tr>)}</tbody>
      </table>
    </details>
  );
}

function comparisonNote(study: ClaimStudy, analysis: ReturnType<typeof compareStudy>) {
  const parts: string[] = [];
  if (analysis.applicable) {
    const basis = study.valueRole === "observed-result" ? "recorded views show the requested result"
      : "observations at the proposed value demonstrated the claim";
    parts.push(`${analysis.confirmed} of ${analysis.applicable} ${basis}.`);
  } else if (study.samples.some(sample => sample.value !== null)) {
    parts.push("No observation at the proposed value.");
  }
  if (analysis.exception) parts.push(`${analysis.exception} recorded exception${analysis.exception === 1 ? "" : "s"}.`);
  if (analysis.missing) parts.push(`${analysis.missing} observation${analysis.missing === 1 ? " is" : "s are"} unavailable.`);
  if (analysis.dependency === "unknown") parts.push("The dependency still needs confirmation.");
  else if (analysis.dependency === "changed") {
    parts.push("The tested and proposed configurations differ.");
  }
  return parts.join(" ");
}

function displayValue(value: number | null, unit: string) {
  if (value === null) return "Unavailable";
  return `${value} ${value === 1 && unit.endsWith("s") ? unit.slice(0,-1) : unit}`;
}

function TrialValue({study, assumption}: {study: ClaimStudy; assumption: Judgment["assumption"]}) {
  const [trial,setTrial] = useState("");
  const trialValue = trial.trim() ? Number(trial) : null;
  const trialAnalysis = trialValue !== null && Number.isFinite(trialValue) && trialValue >= 0 ?
    compareStudy({ ...study, proposedValue: trialValue }, assumption) : undefined;
  const quantity = (v:number | null) => displayValue(v,study.unit);
  return <details>
      <summary className="w-fit cursor-pointer text-sm">Try a different {study.quantity.toLowerCase()}</summary>
      <TextField label={`Comparison value (${study.unit})`} labelClassName="mt-2 max-w-xs"
        type="number" min={0} step="any" value={trial} onChange={event=>setTrial(event.target.value)} />
      {trialAnalysis && <p role="status" className="mt-0.5 text-xs text-muted-foreground mt-2">
        {trialAnalysis.result} · {trialAnalysis.confirmed} demonstrated of {trialAnalysis.applicable} samples at {quantity(trialValue)}.
        {" "}The recorded decision still uses {quantity(study.proposedValue)}.
      </p>}
    </details>;
}
