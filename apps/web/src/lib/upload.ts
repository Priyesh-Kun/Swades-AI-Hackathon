/**
 * Chunk upload pipeline with retry logic.
 * Pattern: persist to OPFS FIRST → upload to server with retries → delete from OPFS on success.
 */

import { deleteChunkFromOPFS, persistChunkToOPFS } from "./opfs";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RETRY_BACKOFF = 2;

export type ChunkUploadStatus = "pending" | "persisted" | "uploading" | "acked" | "failed";

export interface UploadableChunk {
  chunkId: string;
  sessionId: string;
  index: number;
  blob: Blob;
  status: ChunkUploadStatus;
  error?: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadWithRetry(
  url: string,
  body: string,
  retries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;
  let delay = RETRY_DELAY_MS;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      // Don't retry client errors (4xx), only server errors (5xx) or network failures
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }

      lastError = new Error(`Server returned ${res.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Network error");
    }

    if (attempt < retries) {
      await sleep(delay);
      delay *= RETRY_BACKOFF;
    }
  }

  throw lastError ?? new Error("Upload failed after retries");
}

export async function uploadChunk(chunk: UploadableChunk): Promise<{ ok: boolean; error?: string }> {
  try {
    // Step 1: Persist to OPFS first (durable local buffer)
    await persistChunkToOPFS(chunk.chunkId, chunk.blob);

    // Step 2: Upload to server with retries
    const base64 = await blobToBase64(chunk.blob);
    const body = JSON.stringify({
      chunkId: chunk.chunkId,
      sessionId: chunk.sessionId,
      index: chunk.index,
      data: base64,
    });

    const res = await uploadWithRetry(`${SERVER_URL}/api/chunks/upload`, body);

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Server returned ${res.status}: ${text}` };
    }

    // Step 3: Only delete from OPFS after server ack
    await deleteChunkFromOPFS(chunk.chunkId);

    return { ok: true };
  } catch (error) {
    // Chunk stays in OPFS for recovery
    return { ok: false, error: error instanceof Error ? error.message : "Upload failed" };
  }
}

export async function uploadChunkFromOPFS(
  chunkId: string,
  sessionId: string,
  index: number,
  blob: Blob,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base64 = await blobToBase64(blob);
    const body = JSON.stringify({
      chunkId,
      sessionId,
      index,
      data: base64,
    });

    const res = await uploadWithRetry(`${SERVER_URL}/api/chunks/upload`, body);

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Server returned ${res.status}: ${text}` };
    }

    // Delete from OPFS after successful re-upload
    await deleteChunkFromOPFS(chunkId);

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Re-upload failed" };
  }
}
