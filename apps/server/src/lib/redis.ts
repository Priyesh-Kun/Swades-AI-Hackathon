import { env } from "@my-better-t-app/env/server";
import Redis from "ioredis";

export const redis = new Redis(env.REDIS_URL);

const TRANSCRIPTION_QUEUE = "transcription_jobs";

export async function enqueueTranscriptionJob(sessionId: string, bucketKeys: string[]): Promise<void> {
  await redis.lpush(
    TRANSCRIPTION_QUEUE,
    JSON.stringify({ sessionId, bucketKeys, type: "full_session" }),
  );
}

export async function getQueueDepth(): Promise<number> {
  return redis.llen(TRANSCRIPTION_QUEUE);
}
