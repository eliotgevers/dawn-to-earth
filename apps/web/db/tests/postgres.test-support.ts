import { test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import type { WorkspaceDatabase } from "../connection";

const url = process.env.WORKBENCH_TEST_DATABASE_URL;

// The test database must be explicitly supplied. Even successful scenarios roll back.
export type TestTransaction = Parameters<Parameters<WorkspaceDatabase["transaction"]>[0]>[0];

export function databaseTest(name: string, verify: (tx: TestTransaction) => Promise<void>) {
  test.skipIf(!url)(name, async () => {
    if (!url) throw new Error("WORKBENCH_TEST_DATABASE_URL is required.");
    const db = drizzle(url);
    const rollback = new Error("Scenario complete");
    try {
      await db.transaction(async (tx) => {
        await verify(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await db.$client.end();
    }
  });
}
