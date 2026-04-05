import { db } from "@my-better-t-app/db";
import { chunks, sessions, transcripts } from "@my-better-t-app/db/schema";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { chunkExists, putChunk } from "../lib/bucket";
import { enqueueTranscriptionJob } from "../lib/redis";

const chunksRouter = new Hono();

chunksRouter.post("/sessions/create", async (c) => {
  const body = await c.req.json<{ sessionId: string }>();
  const { sessionId } = body;

  if (!sessionId) {
    return c.json({ ok: false, error: "sessionId required" }, 400);
  }

  try {
    await db.insert(sessions).values({
      id: sessionId,
      status: "recording",
    }).onConflictDoNothing();

    return c.json({ ok: true, sessionId });
  } catch (error) {
    console.error("Session create failed:", error);
    return c.json({ ok: false, error: "Create failed" }, 500);
  }
});

chunksRouter.post("/sessions/:sessionId/stop", async (c) => {
  const sessionId = c.req.param("sessionId");

  try {
    await db
      .update(sessions)
      .set({ status: "stopped", stoppedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    return c.json({ ok: true });
  } catch (error) {
    console.error("Session stop failed:", error);
    return c.json({ ok: false, error: "Stop failed" }, 500);
  }
});

chunksRouter.post("/sessions/:sessionId/transcribe", async (c) => {
  const sessionId = c.req.param("sessionId");

  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) {
      return c.json({ ok: false, error: "Session not found" }, 404);
    }

    if (session.status === "transcribing") {
      return c.json({ ok: false, error: "Already transcribing" }, 409);
    }

    const sessionChunks = await db
      .select({ id: chunks.id, bucketKey: chunks.bucketKey, index: chunks.index })
      .from(chunks)
      .where(eq(chunks.sessionId, sessionId))
      .orderBy(asc(chunks.index));

    if (sessionChunks.length === 0) {
      return c.json({ ok: false, error: "No chunks found for session" }, 400);
    }

    await db
      .update(sessions)
      .set({ status: "transcribing", totalChunks: sessionChunks.length })
      .where(eq(sessions.id, sessionId));

    await enqueueTranscriptionJob(sessionId, sessionChunks.map((c) => c.bucketKey));

    return c.json({
      ok: true,
      sessionId,
      chunksCount: sessionChunks.length,
      message: "Transcription job enqueued",
    });
  } catch (error) {
    console.error("Transcribe request failed:", error);
    return c.json({ ok: false, error: "Transcribe failed" }, 500);
  }
});

chunksRouter.post("/upload", async (c) => {
  const body = await c.req.json<{
    chunkId: string;
    sessionId: string;
    index: number;
    data: string;
  }>();

  const { chunkId, sessionId, index, data } = body;

  if (!chunkId || !sessionId || index === undefined || !data) {
    return c.json({ ok: false, error: "Missing required fields" }, 400);
  }

  const bucketKey = `recordings/${sessionId}/${chunkId}.wav`;

  try {
    const buffer = Buffer.from(data, "base64");

    await putChunk(bucketKey, buffer);

    await db.insert(chunks).values({
      id: chunkId,
      sessionId,
      index,
      bucketKey,
      ackedAt: new Date(),
    }).onConflictDoUpdate({
      target: chunks.id,
      set: {
        bucketKey,
        ackedAt: new Date(),
        missingFromBucket: 0,
      },
    });

    return c.json({ ok: true, chunkId });
  } catch (error) {
    console.error("Chunk upload failed:", error);
    return c.json({ ok: false, error: "Upload failed" }, 500);
  }
});

chunksRouter.get("/missing", async (c) => {
  const sessionId = c.req.query("sessionId");

  if (!sessionId) {
    return c.json({ ok: false, error: "sessionId required" }, 400);
  }

  try {
    const sessionChunks = await db
      .select({ id: chunks.id, bucketKey: chunks.bucketKey })
      .from(chunks)
      .where(eq(chunks.sessionId, sessionId));

    const missingChunkIds: string[] = [];
    for (const chunk of sessionChunks) {
      const exists = await chunkExists(chunk.bucketKey);
      if (!exists) {
        missingChunkIds.push(chunk.id);
      }
    }

    return c.json({ ok: true, missingChunkIds });
  } catch (error) {
    console.error("Missing chunks check failed:", error);
    return c.json({ ok: false, error: "Check failed" }, 500);
  }
});

chunksRouter.get("/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) {
      return c.json({ ok: false, error: "Session not found" }, 404);
    }

    const sessionTranscripts = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.sessionId, sessionId))
      .orderBy(asc(transcripts.startTime));

    const sessionChunks = await db
      .select({
        id: chunks.id,
        index: chunks.index,
        ackedAt: chunks.ackedAt,
        missingFromBucket: chunks.missingFromBucket,
      })
      .from(chunks)
      .where(eq(chunks.sessionId, sessionId))
      .orderBy(asc(chunks.index));

    return c.json({
      ok: true,
      session,
      chunks: sessionChunks,
      transcript: sessionTranscripts,
    });
  } catch (error) {
    console.error("Session fetch failed:", error);
    return c.json({ ok: false, error: "Fetch failed" }, 500);
  }
});

export default chunksRouter;
