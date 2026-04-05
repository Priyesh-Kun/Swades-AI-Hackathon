/**
 * OPFS (Origin Private File System) helpers for durable client-side chunk storage.
 * Chunks are persisted here BEFORE any network call, ensuring no data loss
 * even if the tab closes or network drops.
 */

const CHUNKS_DIR = "chunks";

async function getChunksDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(CHUNKS_DIR, { create: true });
}

export async function persistChunkToOPFS(chunkId: string, blob: Blob): Promise<void> {
  const dir = await getChunksDir();
  const file = await dir.getFileHandle(`${chunkId}.wav`, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function readChunkFromOPFS(chunkId: string): Promise<Blob | null> {
  try {
    const dir = await getChunksDir();
    const file = await dir.getFileHandle(`${chunkId}.wav`);
    const fileData = await file.getFile();
    return fileData;
  } catch {
    return null;
  }
}

export async function deleteChunkFromOPFS(chunkId: string): Promise<void> {
  try {
    const dir = await getChunksDir();
    await dir.removeEntry(`${chunkId}.wav`);
  } catch {
    // File may already be deleted
  }
}

export async function listOPFSChunks(): Promise<string[]> {
  const dir = await getChunksDir();
  const ids: string[] = [];
  for await (const [name] of dir.entries()) {
    if (name.endsWith(".wav")) {
      ids.push(name.replace(".wav", ""));
    }
  }
  return ids;
}

export async function getOPFSStorageUsage(): Promise<{ used: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  }
  return { used: 0, quota: 0 };
}
