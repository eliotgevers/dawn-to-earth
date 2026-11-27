import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

const url = process.env.DATABASE_URL;
export const db = url ? drizzle({
  connection: {
    url,
    ...(process.env.DATABASE_CA_CERT ? { ssl: { ca: process.env.DATABASE_CA_CERT, rejectUnauthorized: true } } : {}),
    connect_timeout: 3,
    // Each Vercel instance has its own pool against the same small demo database.
    ...(process.env.VERCEL === "1" ? { max: 2, idle_timeout: 5 } : {}),
    // Hot reload can orphan a development pool. Let postgres.js close its idle connections.
    ...(process.env.NODE_ENV === "development" ? { idle_timeout: 2 } : {}),
  },
}) : undefined;

type Database = NonNullable<typeof db>;
export type WorkspaceDatabase = Omit<Database, "$client">;
export type Reader = Pick<WorkspaceDatabase, "select">;

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Serialize eligibility checks and their writes across all workspace workflows, including bootstrap.
export function writeTransaction<T>(db: WorkspaceDatabase, write: (tx: Transaction) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dawn-workspace-write'))`);

    return write(tx);
  });
}

export type RecordWriter = Pick<WorkspaceDatabase, "select" | "insert" | "update">;

export function fail(error: string, status = 409) {
  return { error, status } as const;
}
