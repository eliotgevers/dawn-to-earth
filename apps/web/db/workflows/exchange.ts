import { isObject, type ToolCommand, type ToolContext, type WorkCase, type WorkEvent } from "./cases";

export const maxBundleBytes = 24 * 1024;
const maxFiles = 16;
const key = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const docTypes = ["installation", "index", "cover"] as const;
type DocType = (typeof docTypes)[number];
type Destination = { id: string; title: string; type: DocType; sourceId: string; required?: boolean };
export type Request = { sender: string; destinations: Destination[]; corrections?: string[]; prepared?: string };
type FileEntry = {
  name: string;
  type: DocType;
  serial: string;
  revisionId: string;
  text: string;
  derivedFrom?: string;
  sourceId?: string;
  lotId?: string;
  recordedBy?: string;
};
export type Manifest = { id: string; sender: string; files: FileEntry[] };
export type Match = {
  file: FileEntry;
  destination?: Destination;
  options: Destination[];
  state: "Ready" | "Choose destination" | "Held";
  reason: string;
};
export type Receipt = Exclude<ReturnType<typeof decide>, string>["data"];

export function requestFor(item: WorkCase) {
  return item.data as Request;
}

function safeKey(value: unknown): value is string {
  return typeof value === "string" && key.test(value);
}

function documentName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._-]{0,119}$/u.test(value)
  );
}

function label(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  );
}

export function bundleFilename(value: unknown): value is string {
  return (
    label(value, 120) && /\.(json|txt)$/i.test(value) && !/[\/\\\u202a-\u202e\u2066-\u2069]/u.test(value)
  );
}

export function receiptsFor(item: WorkCase) {
  return item.history.filter(event => event.kind === "bundle-imported").reverse();
}

export function receivedBundle(manifest: Manifest, events: readonly WorkEvent[]) {
  return events.find(event => event.tool === "exchange" && event.kind === "bundle-imported" &&
    event.data.bundleId === manifest.id && event.data.receivedFrom === manifest.sender);
}

export function filedDestinations(history: readonly WorkEvent[]) {
  const files = history.flatMap(event => (event.data as Receipt).files
    .filter(file => file.destinationId)
    .map(file => ({ event, file })));

  return Map.groupBy(files, ({ file }) => file.destinationId!);
}

export function parseBundle(raw: unknown): Manifest | string {
  if (
    typeof raw !== "string" ||
    raw.length > maxBundleBytes ||
    new TextEncoder().encode(raw).length > maxBundleBytes
  ) {
    return "Choose a UTF-8 JSON bundle of 24 KB or less.";
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.startsWith("\uFEFF") ? raw.slice(1) : raw);
  } catch {
    return "This file contains invalid JSON. Check the file contents and upload it again.";
  }
  if (
    !isObject(data) ||
    !safeKey(data.id) ||
    !label(data.sender, 100) ||
    !Array.isArray(data.files) ||
    data.files.length < 1 ||
    data.files.length > maxFiles
  )
    return "Include a bundle ID, sender and 1–16 text files.";
  const names = new Set<string>();
  for (const [i, file] of data.files.entries()) {
    if (
      !isObject(file) ||
      !documentName(file.name) ||
      !docTypes.some((t) => t === file.type) ||
      !safeKey(file.serial) ||
      !safeKey(file.revisionId) ||
      typeof file.text !== "string" ||
      !file.text.trim() ||
      file.text.length > 4000 ||
      file.text.includes("\u0000") ||
      (file.derivedFrom !== undefined && !documentName(file.derivedFrom)) ||
      [file.sourceId, file.lotId].some((v) => v !== undefined && !safeKey(v)) ||
      (file.recordedBy !== undefined && !label(file.recordedBy, 100))
    ) {
      return `File ${i + 1} needs a simple filename, document type, serial, revision and 1–4,000 characters of text.`;
    }
    const normalizedName = file.name.normalize("NFC").toLowerCase();
    if (names.has(normalizedName)) return "Each file needs a unique filename.";
    names.add(normalizedName);
  }

  return data as Manifest;
}

export function matchBundle(
  item: WorkCase,
  manifest: Manifest,
  choices: Record<string, unknown>,
  prior: { has(id: string): boolean } = new Set<string>(),
) {
  const { destinations } = requestFor(item);
  const originals = new Map<string, Match>();
  function classify(file: FileEntry): Match {
    const hold = (reason: string): Match => ({ file, options: [], state: "Held", reason });
    if (file.serial !== item.unit?.serial) return hold(`Serial mismatch · received ${file.serial}`);
    if (file.revisionId !== item.unit.revisionId)
      return hold(`Revision mismatch · received ${file.revisionId}`);
    if (file.derivedFrom) {
      const original = originals.get(file.derivedFrom);
      if (!original) return hold("Original is missing or is itself derived");
      if (original.file.serial !== file.serial || original.file.revisionId !== file.revisionId)
        return hold("Original has a different serial or revision");
      if (!original.destination) return hold("File the original before its derivative");
    }
    if (
      file.type === "installation" &&
      (file.derivedFrom || !file.sourceId || !file.lotId || !file.recordedBy)
    ) {
      return hold("Installation correction requires an original, its register ID, recorded lot and author");
    }
    const options = destinations.filter(
      (d) => d.type === file.type && (!file.sourceId || file.sourceId === d.sourceId),
    );
    if (!options.length) return hold("No matching document destination");
    const choice = Object.hasOwn(choices, file.name) ? choices[file.name] : undefined;
    const automatic = file.sourceId && options.length === 1 ? options[0] : undefined;
    const match = { file, options: automatic ? [] : options };
    if (choice === "hold") return { ...match, state: "Held", reason: "Retained without filing" };
    const destination = choice === undefined ? automatic : options.find(d => d.id === choice);
    if (destination) return { ...match, destination, state: "Ready", reason: "" };

    return {
      ...match,
      state: "Choose destination",
      reason: options.length > 1 ? "Multiple destinations match" : "Confirm the destination for the unreferenced file",
    };
  }
  // Classify originals once, even if a derived file appears first in the received manifest.
  for (const file of manifest.files) {
    if (!file.derivedFrom) originals.set(file.name, classify(file));
  }
  const rows = manifest.files.map(file => originals.get(file.name) ?? classify(file));
  const missing = destinations.filter(
    (d) => d.required && !prior.has(d.id) && !rows.some((r) => r.destination?.id === d.id),
  );
  const accepted = rows.filter(row => row.destination).length;
  const invalidChoice = Object.entries(choices).some(([name, value]) => {
    const row = rows.find(entry => entry.file.name === name);

    return !row || (value !== "hold" && (!row.destination || row.destination.id !== value));
  });
  const problem = invalidChoice ? "One destination is invalid for the received file."
    : rows.some(row => row.state === "Choose destination") ? "Resolve each ambiguous destination or retain the file without filing."
    : !accepted ? "At least one file must match an exact destination." : undefined;

  return { rows, missing, accepted, problem };
}

export function readBundle(item: WorkCase, raw: string, filename: unknown) {
  if (!bundleFilename(filename)) return "Choose a .json or .txt bundle to import.";
  const manifest = parseBundle(raw);
  if (typeof manifest !== "string" && manifest.sender !== requestFor(item).sender)
    return `The sender does not match this request from ${requestFor(item).sender}.`;

  return manifest;
}

export function decide(context: ToolContext, command: ToolCommand) {
  const item = command.dossier;
  const unit = item.unit;
  if (!unit || command.action !== "import") return "Choose an open exchange request.";
  const { raw, sourceName, choices } = command.data;
  if (typeof raw !== "string" || typeof sourceName !== "string" || !isObject(choices)) return "Choose a .json or .txt bundle to import.";
  const manifest = readBundle(item, raw, sourceName);
  if (typeof manifest === "string") return manifest;
  if (receivedBundle(manifest, context.relatedEvents))
    return "This sender’s bundle ID already has an immutable receipt.";
  const registered = context.workspace.catalog.units.find(row => row.serial === unit.serial);
  if (!registered?.configurations.some(edition => edition.revisionId === unit.revisionId))
    return "The requested unit and revision are unavailable.";
  const prior = filedDestinations(receiptsFor(item));
  const { rows, missing, problem } = matchBundle(item, manifest, choices, prior);
  if (problem) return problem;
  const permittedRegisters = new Set(requestFor(item).corrections);
  const receipt = {
    bundleId: manifest.id,
    receivedFrom: manifest.sender,
    manifest: raw,
    sourceName,
    files: rows.map(({ file, destination, reason }) => ({
      fileId: file.name,
      derivedFrom: file.derivedFrom,
      destinationId: destination?.id,
      destinationTitle: destination?.title,
      destinationRecord: destination?.sourceId,
      matchedBy: destination
        ? Object.hasOwn(choices, file.name)
          ? "Recipient selection"
          : "Exact source record"
        : undefined,
      reason,
    })),
    missing: missing.map(({ id, title }) => ({ id, title })),
    lotCorrections: rows.flatMap(({ file, destination }) => {
      // Only an original, attributed installation passes matching above.
      if (file.type !== "installation" || !destination || !file.lotId || !permittedRegisters.has(destination.sourceId)) return [];

      return [{ lotId: file.lotId, serial: file.serial, revisionId: file.revisionId,
        sourceId: destination.sourceId, fileId: file.name }];
    }),
  };

  return { kind: "bundle-imported", title: `Received ${manifest.id} · ${manifest.sender}`, data: receipt };
}
