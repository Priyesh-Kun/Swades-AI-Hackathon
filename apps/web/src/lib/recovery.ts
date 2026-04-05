/**
 * Recovery module: on reconnect, poll the server for missing chunks
 * and re-upload them from OPFS.
 */

import { listOPFSChunks, readChunkFromOPFS } from "./opfs";
import { uploadChunkFromOPFS } from "./upload";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

export interface RecoveryResult {
  total: number;
  recovered: number;
  failed: number;
  errors: string[];
}

/**
 * Recover missing chunks for a specific session.
 * 1. Ask server which chunks are missing from the bucket
 * 2. Re-upload those from OPFS
 */
export async function recoverMissingChunks(sessionId: string): Promise<RecoveryResult> {
  const result: RecoveryResult = { total: 0, recovered: 0, failed: 0, errors: [] };

  try {
    const res = await fetch(`${SERVER_URL}/api/chunks/missing?sessionId=${sessionId}`);
    if (!res.ok) {
      result.errors.push(`Server returned ${res.status}`);
      return result;
    }

    const { missingChunkIds } = (await res.json()) as { missingChunkIds: string[] };
    result.total = missingChunkIds.length;

    for (const chunkId of missingChunkIds) {
      const blob = await readChunkFromOPFS(chunkId);
      if (blob) {
        // Extract index from chunkId format: `${sessionId}-${index}`
        const indexStr = chunkId.split("-").pop();
        const index = indexStr ? Number.parseInt(indexStr, 10) : 0;

        const uploadResult = await uploadChunkFromOPFS(chunkId, sessionId, index, blob);
        if (uploadResult.ok) {
          result.recovered++;
        } else {
          result.failed++;
          result.errors.push(`${chunkId}: ${uploadResult.error}`);
        }
      } else {
        result.failed++;
        result.errors.push(`${chunkId}: not found in OPFS`);
      }
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "Recovery failed");
  }

  return result;
}

/**
 * Recover any orphaned chunks in OPFS that haven't been uploaded.
 * This catches chunks that were persisted but never uploaded
 * (e.g., tab closed before upload started).
 */
export async function recoverOrphanedChunks(sessionId: string): Promise<RecoveryResult> {
  const result: RecoveryResult = { total: 0, recovered: 0, failed: 0, errors: [] };

  try {
    const opfsChunks = await listOPFSChunks();
    const sessionChunks = opfsChunks.filter((id) => id.startsWith(sessionId));
    result.total = sessionChunks.length;

    for (const chunkId of sessionChunks) {
      const blob = await readChunkFromOPFS(chunkId);
      if (blob) {
        const indexStr = chunkId.split("-").pop();
        const index = indexStr ? Number.parseInt(indexStr, 10) : 0;

        const uploadResult = await uploadChunkFromOPFS(chunkId, sessionId, index, blob);
        if (uploadResult.ok) {
          result.recovered++;
        } else {
          result.failed++;
          result.errors.push(`${chunkId}: ${uploadResult.error}`);
        }
      }
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "Orphan recovery failed");
  }

  return result;
}
