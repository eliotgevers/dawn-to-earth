import type { AuroraFlight } from "@/db/schema";

export const edition = "aurora-payload-atlas-01";

export const outcomes = ["Finding", "Follow-up"] as const;

export type EventId = "card-in" | "slate-out";
export const events: Record<EventId, string> = {
  "card-in": "Card enters view",
  "slate-out": "End slate appears",
};

export type ProfilePoint = [number, number, number];
type Recording = {
  id: string;
  // A dot is an unreadable target in a present frame. Null is an absent frame.
  frames: readonly (string | null)[];
  events: Record<EventId, number>;
  // Positions in the edition's tabletop illustration. Each position identifies one archive slot.
  displayPoints?: ProfilePoint[];
};

export type PayloadPair = {
  id: string;
  title: string;
  question: string;
  subject: string;
  glyphs: string;
  metric: string;
  profileEdition?: string;
  setting?: "bench";
  reviewed: Recording;
  reference: Recording;
};

export const pairs: readonly PayloadPair[] = [
  {
    id: "corner-card", title: "Four-corner image card", subject: "Image continuity",
    question: "Can all four corner targets be seen throughout the capture? Two frames are missing from the returned strip.",
    glyphs: "ABCD", metric: "Visible corner targets", profileEdition: "CARD-PROFILE/1",
    reviewed: {
      id: "CARD-17/2",
      displayPoints: [
        [-3.8,.2,.65], [-3.4,.30,.62], [-3.05,.63,.55], [-2.6,1.13,.43], [-2.05,1.7,.31],
        [-1.46,2.08,.1], [-.85,2.40,-.09], [-.2,2.52,-.19], [.48,2.5,-.2], [1.12,2.35,-.1],
        [1.68,2.07,.04], [2.2,1.68,.2], [2.69,1.12,.37], [3.15,.61,.55], [3.65,.24,.63],
      ],
      events: { "card-in": 4, "slate-out": 13 },
      frames: ["....", "....", "....", "AB..", "ABCD", "ABCD", "ABCD", null, null, "ABCD", "ABCD", "ABCD", "AB..", "....", "...."],
    },
    reference: {
      id: "CARD-09/1",
      displayPoints: [
        [-3.72,.18,-.45], [-3.25,.45,-.62], [-2.64,1.05,-.84], [-2.05,1.55,-1.03], [-1.44,1.94,-1.15],
        [-.88,2.19,-1.25], [-.23,2.32,-1.28], [.45,2.29,-1.26], [1.07,2.1,-1.20], [1.7,1.81,-1.10],
        [2.23,1.49,-.99], [2.7,.99,-.82], [3.17,.53,-.6], [3.67,.20,-.46],
      ],
      events: { "card-in": 3, "slate-out": 11 },
      frames: ["....", "....", "AB..", "ABCD", "ABCD", "ABCD", "ABCD", "ABCD", "ABCD", "ABCD", "AB..", "....", "....", "...."],
    },
  },
  {
    id: "caption-strip", title: "Caption strip at the frame edge", subject: "Image framing",
    question: "Does the right edge cut off the caption in the returned images, and does the reference cover those frames?",
    glyphs: "FRAMES", metric: "Legible caption letters", profileEdition: "TEXT-PROFILE/1",
    reviewed: {
      id: "TEXT-12/1",
      displayPoints: [
        [-3.75,.2,.55], [-3.22,.55,.72], [-2.70,1.0,.97], [-2.16,1.48,1.13], [-1.57,1.91,1.2],
        [-.96,2.18,1.16], [-.31,2.31,.94], [.34,2.34,.60], [1.03,2.24,.20], [1.65,2.02,-.20],
        [2.19,1.64,-.58], [2.68,1.18,-.78], [3.18,.68,-.77], [3.72,.22,-.59],
      ],
      events: { "card-in": 3, "slate-out": 13 },
      frames: ["......", "......", "FRA...", "FRAMES", "FRAMES", "FRAMES", "FRAME.", "FRAM..", "FRAM..", "FRAM..", "FRAM..", "FRAME.", "FR....", "......"],
    },
    reference: {
      id: "TEXT-05/3",
      displayPoints: [
        [-3.63,.18,-.5], [-3.2,.38,-.38], [-2.70,.78,-.18], [-2.15,1.19,.02], [-1.59,1.53,.11],
        [-1.04,1.80,.12], [-.45,1.97,.02], [.19,1.98,-.20], [.86,1.85,-.55], [1.5,1.62,-.88],
        [2.03,1.33,-1.18], [2.55,.98,-1.36],
      ],
      events: { "card-in": 4, "slate-out": 11 },
      frames: ["......", "......", "......", "FRA...", "FRAMES", "FRAMES", "FRAMES", "FRAMES", "FRAMES", "FRAMES", "FR....", "......"],
    },
  },
  {
    id: "edge-mask", title: "Edge mask on a camera card", subject: "Camera field of view", setting: "bench",
    question: "The returned card loses its outer mark as it passes behind the mask. Does the reference show the same loss?",
    glyphs: "ABCD", metric: "Visible corner targets", profileEdition: "MASK-STRIP/1",
    reviewed: {
      id: "MASK-21/1",
      displayPoints: [
        [-3.45,.46,.82],[-2.86,.47,.70],[-2.24,.52,.57],[-1.60,.55,.48],[-.98,.58,.41],[-.30,.62,.38],
        [.37,.62,.40],[1.02,.61,.45],[1.66,.57,.49],[2.27,.54,.58],[2.89,.50,.68],[3.46,.47,.80],
      ],
      events: { "card-in": 3, "slate-out": 11 },
      frames: ["....","....","ABCD","ABCD","ABCD","ABC.","ABC.","ABC.","ABCD","ABCD","....","...."],
    },
    reference: {
      id: "MASK-18/1",
      displayPoints: [
        [-3.42,.41,-.88],[-2.73,.45,-.76],[-2.04,.51,-.68],[-1.33,.56,-.61],[-.63,.60,-.58],
        [.07,.62,-.57],[.77,.61,-.59],[1.45,.58,-.64],[2.14,.54,-.71],[2.85,.48,-.79],[3.47,.45,-.87],
      ],
      events: { "card-in": 2, "slate-out": 10 },
      frames: ["....","ABCD","ABCD","ABCD","ABCD","ABCD",null,"ABCD","ABCD","....","...."],
    },
  },
  {
    id: "tray-witness", title: "Sample tray corner marks", subject: "Tray image orientation", setting: "bench",
    question: "Both images show two marks through the tray window. Do they show the same two corners?",
    glyphs: "ABCD", metric: "Visible tray corners", profileEdition: "TRAY-SEQUENCE/1",
    reviewed: {
      id: "TRAY-04/2",
      displayPoints: [
        [-3.4,.31,-.3], [-2.8,.39,-.15], [-2.13,.46,.18], [-1.42,.52,.55], [-.69,.55,.83],
        [.07,.53,.91], [.81,.5,.84], [1.51,.45,.66], [2.20,.4,.45], [2.87,.36,.32], [3.46,.31,.28],
      ],
      events: { "card-in": 3, "slate-out": 10 },
      frames: ["....","....","ABCD","ABCD","AB..","AB..","AB..","ABCD","ABCD","....","...."],
    },
    reference: {
      id: "TRAY-02/1",
      displayPoints: [
        [-3.4,.31,-.75], [-2.67,.37,-.73], [-1.9,.44,-.64], [-1.14,.49,-.57], [-.38,.54,-.55],
        [.38,.53,-.6], [1.15,.48,-.72], [1.92,.43,-.83], [2.67,.37,-.86], [3.47,.30,-.82],
      ],
      events: { "card-in": 2, "slate-out": 9 },
      frames: ["....","ABCD","ABCD","..CD","..CD","..CD","ABCD","ABCD","....","...."],
    },
  },
];

const auroraFiling = { projectId: "public-dawn-aurora", serial: "REF-AURORA-01", revisionId: "public-dawn-aurora-ref" };
export const filings: Record<string, {projectId: string; serial: string; revisionId: string}> = {
  "corner-card": auroraFiling,
  "caption-strip": auroraFiling,
  "tray-witness": { projectId: "public-tumbleweed-oasis-beta", serial: "REF-OASIS-01", revisionId: "public-tumbleweed-oasis-beta-ref" },
  "edge-mask": { projectId: "public-reditus-enos", serial: "REF-ENOS-01", revisionId: "public-reditus-enos-ref" },
};

export function subjectFor(pair: PayloadPair, event: EventId) {
  return `${pair.reviewed.id}~${pair.reference.id}@${event}`;
}

export function resolveSubject(subject: string) {
  for (const pair of pairs) {
    for (const event of Object.keys(events) as EventId[]) {
      if (subjectFor(pair, event) === subject) return { pair, event };
    }
  }

  return null;
}

export function debriefQuery(pair: PayloadPair, event: EventId) {
  return { pair: pair.id, align: event, edition };
}

export function visibleCount(sample: string) {
  return Array.from(sample).filter(mark => mark !== ".").length;
}

export function sourceFor(subject: string) {
  const anchor = resolveSubject(subject);

  return anchor ? { label: `${anchor.pair.title} · ${events[anchor.event]}`, ...anchor } : undefined;
}

type ArchivedSource = NonNullable<ReturnType<typeof sourceFor>>;

export function isArchivedSource(value: unknown): value is ArchivedSource {
  if (!value || typeof value !== "object" || !("event" in value) || !("pair" in value)) return false;
  const { pair, event } = value as Partial<ArchivedSource>;
  if (!pair || !event || !Object.hasOwn(events, event)) return false;
  if (![pair.title, pair.question, pair.subject, pair.id, pair.glyphs, pair.metric].every(s => typeof s === "string" && s.length > 0)) return false;

  return [pair.reviewed, pair.reference].every(run => run && typeof run.id === "string" && Array.isArray(run.frames)
    && run.frames.length > 0 && run.frames.every(value => value === null || typeof value === "string" && value.length === pair.glyphs.length)
    && run.events && Object.keys(events).every(key => Number.isInteger(run.events[key as EventId]) && run.events[key as EventId] >= 1 && run.events[key as EventId] <= run.frames.length));
}

export function hasFiledProfile(pair: PayloadPair) {
  return typeof pair.profileEdition === "string" && [pair.reviewed, pair.reference].every(run =>
    Array.isArray(run.displayPoints) && run.displayPoints.length === run.frames.length &&
    run.displayPoints.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)));
}

// A present frame with no legible marks is an observation; a missing frame is a coverage gap.
export function alignedFrames(pair: PayloadPair, event: EventId) {
  const offset = pair.reference.events[event] - pair.reviewed.events[event];

  return pair.reviewed.frames.map((returned, i) => {
    const frame = i + 1;
    const referenceFrame = frame + offset;
    const reference = pair.reference.frames[referenceFrame - 1];
    const state = returned === null || reference == null ? "gap"
      : returned === reference ? "match" : "different";

    return { frame, returned, referenceFrame, reference, state } as const;
  });
}

export type AlignedFrame = ReturnType<typeof alignedFrames>[number];

export function intervalCoverage(rows: readonly AlignedFrame[]) {
  return {
    paired: rows.filter(row => row.state !== "gap").length,
    matching: rows.filter(row => row.state === "match").length,
    returnedMissing: rows.filter(row => row.returned === null).length,
    referenceMissing: rows.filter(row => row.reference == null).length,
  };
}

type Precision = AuroraFlight["precision"];
export type FlightDateRange = {start: string; end: string; precision: Precision};

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function periodBounds(value: string): FlightDateRange | null {
  const parts = /^(?:(\d{1,2}) )?(?:([A-Za-z]+) )?(\d{4})$/.exec(value);
  if (!parts) return null;
  const [, day, name, year] = parts;
  if (!name) return day ? null : {start: year + "-01-01", end: year + "-12-31", precision: "year"};
  const month = months.indexOf(name) + 1;
  if (month === 0) return null;

  const leapYear = +year % 4 === 0 && (+year % 100 !== 0 || +year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  const prefix = year + "-" + String(month).padStart(2, "0") + "-";
  if (!day) return {start: prefix + "01", end: prefix + days, precision: "month"};
  if (+day < 1 || +day > days) return null;
  const exact = prefix + day.padStart(2, "0");

  return {start: exact, end: exact, precision: "day"};
}

// The boundaries of a published period are useful for month navigation.
// Only precision "day" identifies an event on a particular calendar day.
export function flightDateRange(flight: Pick<AuroraFlight, "period" | "precision">): FlightDateRange | null {
  const period = flight.period.trim().replace(/\s+/g, " ");
  if (flight.precision !== "range") {
    const bounds = periodBounds(period);
    return bounds?.precision === flight.precision ? bounds : null;
  }

  const sides = period.split(/\s*[–—]\s*|\s+-\s+/);
  if (sides.length !== 2) return null;
  let [from, to] = sides;
  const last = periodBounds(to);
  if (!last) return null;
  // “28–30 July 2021” and “June–July 2025” inherit the common month or year.
  if (/^\d{1,2}$/.test(from)) from += to.replace(/^\d{1,2}/, "");
  else if (!/\d{4}$/.test(from)) from += " " + to.slice(-4);

  const first = periodBounds(from);
  if (!first || first.start > last.end) return null;

  return {start: first.start, end: last.end, precision: "range"};
}
