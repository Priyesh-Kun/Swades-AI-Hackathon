import { db } from "@my-better-t-app/db";
import { chunks, sessions, transcripts } from "@my-better-t-app/db/schema";
import { count, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";

import { getQueueDepth } from "../lib/redis";

const healthRouter = new Hono();

healthRouter.get("/", async (c) => {
  try {
    const [chunksAckedResult] = await db
      .select({ value: count() })
      .from(chunks)
      .where(isNotNull(chunks.ackedAt));

    const [chunksMissingResult] = await db
      .select({ value: count() })
      .from(chunks)
      .where(eq(chunks.missingFromBucket, 1));

    const sessionStatusCounts = await db
      .select({ status: sessions.status, value: count() })
      .from(sessions)
      .groupBy(sessions.status);

    const sessionMap: Record<string, number> = {};
    for (const row of sessionStatusCounts) {
      sessionMap[row.status] = row.value;
    }

    const transcriptStatusCounts = await db
      .select({ status: transcripts.status, value: count() })
      .from(transcripts)
      .groupBy(transcripts.status);

    const transcriptMap: Record<string, number> = {};
    for (const row of transcriptStatusCounts) {
      transcriptMap[row.status] = row.value;
    }

    const queueDepth = await getQueueDepth();

    return c.json({
      chunksAcked: chunksAckedResult?.value ?? 0,
      chunksMissingFromBucket: chunksMissingResult?.value ?? 0,
      sessions: {
        recording: sessionMap["recording"] ?? 0,
        stopped: sessionMap["stopped"] ?? 0,
        transcribing: sessionMap["transcribing"] ?? 0,
        done: sessionMap["done"] ?? 0,
        failed: sessionMap["failed"] ?? 0,
      },
      transcripts: {
        pending: transcriptMap["pending"] ?? 0,
        done: transcriptMap["done"] ?? 0,
        failed: transcriptMap["failed"] ?? 0,
        silent: transcriptMap["silent"] ?? 0,
      },
      workerQueueDepth: queueDepth,
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return c.json({ error: "Health check failed" }, 500);
  }
});

export default healthRouter;
