const utcDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const utcTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
  timeZone: "UTC",
});

export function formatUtcDateTime(value: string) {
  const timestamp = new Date(value);

  return `${utcDate.format(timestamp)}, ${utcTime.format(timestamp)} UTC`;
}
