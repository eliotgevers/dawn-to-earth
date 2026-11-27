// Only an empty selection prompts the user to choose a scope.
export function EmptyRecords({ unselected = false, message = "Unavailable" }: { unselected?: boolean; message?: string }) {
  return <p className="mt-1 text-[13px] leading-normal text-muted-foreground">
    {unselected ? "Select an item first" : message}
  </p>;
}

export function Loading() {
  return <p className="mt-1 text-[13px] leading-normal text-muted-foreground" role="status">Loading…</p>;
}
