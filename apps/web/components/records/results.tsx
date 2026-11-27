import { EmptyRecords } from "./empty";
import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function RecordResults<T extends { id: string }>({
  records, searchText, status, statusLabel = "Record status", searchLabel = "Search records",
  emptyMatch = "No matching records", empty, statusOptions, selectedStatus, onStatusChange, actions, resetKey, search, children,
}: {
  records: readonly T[];
  searchText: (record: T) => string;
  status?: (record: T) => string;
  statusLabel?: string;
  searchLabel?: string;
  emptyMatch?: string;
  empty?: string;
  statusOptions?: readonly string[];
  selectedStatus?: string;
  onStatusChange?: (value: string) => void;
  actions?: ReactNode;
  resetKey?: string | null;
  search?: { value: string; onChange: (value: string) => void };
  children: (records: readonly T[]) => ReactNode;
}) {
  const [draft, setDraft] = useState({ key: resetKey, text: "", status: "All" });
  const current = draft.key === resetKey ? draft : { key: resetKey, text: "", status: "All" };
  const query = search?.value ?? current.text;
  const options = statusOptions ?? (status ? [...new Set(records.map(status))].sort() : []);
  const choice = selectedStatus ?? (options.includes(current.status) ? current.status : "All");
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = records.filter(record => {
    if (choice !== "All" && status?.(record) !== choice) return false;
    if (!terms.length) return true;
    const text = searchText(record).toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
  const total = new Set(records.map(({ id }) => id)).size;
  const shown = new Set(filtered.map(({ id }) => id)).size;

  return (
    <>
      <div data-record-toolbar className="mb-3 flex flex-wrap items-center gap-2 text-[13px] [&_button]:shrink-0">
        <output aria-live="polite" aria-label="Matching records" className="text-muted-foreground tabular-nums">
          {shown}/{total}
        </output>
        <Input className="min-w-0 max-w-[480px] flex-[1_1_10rem]" type="search" aria-label={searchLabel} placeholder={searchLabel} value={query}
          onChange={event => {
            const text = event.target.value;
            if (search) search.onChange(text);
            else setDraft({ ...current, text });
          }}
        />
        {status && options.length > 0 && (
          <Select value={choice} onValueChange={value => {
            if (!value) return;
            if (onStatusChange) onStatusChange(value);
            else setDraft({ ...current, status: value });
          }}>
            <SelectTrigger aria-label={statusLabel}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {["All", ...options].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        {actions}
      </div>
      {shown ? children(filtered) : <EmptyRecords message={total ? emptyMatch : empty} />}
    </>
  );
}
