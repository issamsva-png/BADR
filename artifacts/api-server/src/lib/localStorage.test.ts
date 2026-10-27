import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

let storage: typeof import("./localStorage");
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), "document-risk-local-storage-"));
  process.env.LOCAL_STORAGE_DIR = storageDir;
  storage = await import("./localStorage");
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
  delete process.env.LOCAL_STORAGE_DIR;
});

it("stores, reads, and removes a local demo upload", async () => {
  const upload = storage.createLocalUpload();
  const content = Buffer.from("%PDF-1.7 local test file");
  await storage.writeLocalUpload(upload.id, "application/pdf", content);

  await expect(storage.getLocalObjectMetadata(upload.objectPath)).resolves.toEqual({
    size: content.length,
    contentType: "application/pdf",
  });
  await expect(storage.readLocalObjectPrefix(upload.objectPath)).resolves.toEqual(
    content.subarray(0, 16),
  );

  const chunks: Buffer[] = [];
  for await (const chunk of storage.createLocalObjectReadStream(upload.objectPath)) {
    chunks.push(Buffer.from(chunk));
  }
  expect(Buffer.concat(chunks)).toEqual(content);

  await storage.deleteLocalObject(upload.objectPath);
  await expect(storage.getLocalObjectMetadata(upload.objectPath)).rejects.toThrow();
});

it("rejects object paths outside the local upload namespace", async () => {
  await expect(storage.getLocalObjectMetadata("/objects/../../package.json")).rejects.toThrow(
    "Invalid local object path",
  );
});
