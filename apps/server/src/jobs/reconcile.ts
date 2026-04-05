import { db } from "@my-better-t-app/db";
import { chunks } from "@my-better-t-app/db/schema";
import { eq, isNotNull } from "drizzle-orm";

import { chunkExists } from "../lib/bucket";

const RECONCILE_INTERVAL_MS = 60_000;

export async function reconcile(): Promise<{ checked: number; missing: number }> {
  const ackedChunks = await db
    .select({ id: chunks.id, bucketKey: chunks.bucketKey })
    .from(chunks)
    .where(isNotNull(chunks.ackedAt));

  let missing = 0;

  for (const chunk of ackedChunks) {
    const exists = await chunkExists(chunk.bucketKey);
    if (!exists) {
      await db
        .update(chunks)
        .set({ missingFromBucket: 1 })
        .where(eq(chunks.id, chunk.id));
      missing++;
    } else {
      await db
        .update(chunks)
        .set({ missingFromBucket: 0 })
        .where(eq(chunks.id, chunk.id));
    }
  }

  return { checked: ackedChunks.length, missing };
}

export function startReconciliationLoop(): ReturnType<typeof setInterval> {
  console.log(`Reconciliation loop started (every ${RECONCILE_INTERVAL_MS / 1000}s)`);

  return setInterval(async () => {
    try {
      const result = await reconcile();
      if (result.missing > 0) {
        console.warn(`Reconciliation: ${result.missing}/${result.checked} chunks missing from bucket`);
      }
    } catch (error) {
      console.error("Reconciliation error:", error);
    }
  }, RECONCILE_INTERVAL_MS);
}
