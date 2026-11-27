import { Children, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function RecordTable({ className, ...props }: ComponentProps<"table">) {
  return (
    <table
      className={cn(
        "w-full border-collapse text-left text-[13px]",
        "[&_th]:bg-muted [&_th]:py-2.25 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground",
        "[&_td]:py-3.25 [&_:is(th,td)]:px-4 max-sm:[&_:is(th,td)]:px-2.5 max-sm:[&_td]:py-2.25",
        className,
      )}
      {...props}
    />
  );
}

export function TableColumns({ caption, labels, className }: {
  caption?: string;
  labels: readonly string[];
  className?: string;
}) {
  return <>
    {caption && <caption className="sr-only">{caption}</caption>}
    <thead className={className}>
      <tr>{Children.map(labels, label => <th scope="col">{label}</th>)}</tr>
    </thead>
  </>;
}
