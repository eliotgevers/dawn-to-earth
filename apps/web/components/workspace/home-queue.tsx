"use client";
import { EmptyRecords } from "@/components/records/empty";
import { badgeTones } from "@/components/records/presentation";

import { InternalLink } from "@/components/records/links";
import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { followRecordLink, recordDestination, setListLocation, useItemSelection, watchRecordFocus } from "./navigation";
import { Badge } from "@/components/ui/badge";
import { PersonField } from "@/components/records/forms";
import { homeItems, viewingPerson, type HomeData } from "@/lib/home-queue";
import { toolHref } from "@/lib/workspace-routes";

const priorities = {
  urgent: { label: "Needs attention", tone: "amber" },
  follow_up: { label: "Review first", tone: "blue" },
  routine: { label: "Ready to review", tone: "gray" },
} as const;

export function HomeQueue({ users, items }: HomeData) {
  const { selections } = useItemSelection();
  const requestedPerson = useSearchParams().get("person");
  const person = viewingPerson(users, requestedPerson)?.id ?? "";
  useEffect(() => watchRecordFocus(/^work-/), [person, items]);
  const people = new Map<string, (typeof users)[number]>(users.map((user) => [user.id, user]));

  return (
    <div className="mt-6 grid max-w-[900px] gap-6">
      <div className="w-full max-w-[246px]">
        <PersonField<string>
          label="Viewing as"
          people={users}
          showRole
          value={person}
          onChange={(next) => {
            if (next !== null) setListLocation(undefined, "person", next === "reviewer" ? null : next);
          }}
        />
      </div>
      {person === "research-partner" && <InternalLink href={toolHref("campaign")}>Open research campaigns</InternalLink>}
      {[
        { heading: "Needs your action", items: homeItems(items, person, "assigned"), waiting: false },
        { heading: "Waiting on others", items: homeItems(items, person, "waiting"), waiting: true },
      ].map(({ heading, items, waiting }) => (
        <section className="border-t pt-3.5" key={heading} aria-label={heading}>
          <h2 className="text-[17px] font-[650] tracking-tight">{heading}</h2>
          {items.length ? (
            <ol className="mt-2 grid gap-2">
              {items.map((item) => {
                const owner = people.get(item.assigneeId);
                const priority = priorities[item.priority];
                const id = `work-${item.id}`;
                return (
                  <li key={item.id}>
                    <Link id={id} href={recordDestination(item.href, selections)}
                      onClick={event => followRecordLink(event, id, selections)}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-lg border border-border bg-popover px-3 py-2.5 text-[13px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      <strong className="text-sm font-semibold wrap-anywhere">{item.title}</strong>
                      <Badge variant="outline" className={`h-6 max-sm:h-[22px] max-sm:px-[5px] ${badgeTones[waiting ? "gray" : priority.tone]}`}>
                        {waiting ? "Waiting" : priority.label}
                      </Badge>
                      <p className="col-span-full wrap-anywhere whitespace-pre-wrap">{item.reason}</p>
                      <div className="col-span-full flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {waiting && owner && <span>Waiting on {owner.name} · {owner.role}</span>}
                        <span>{item.location}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyRecords />
          )}
        </section>
      ))}
    </div>
  );
}
