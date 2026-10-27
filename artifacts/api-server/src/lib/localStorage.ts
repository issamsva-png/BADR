import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const localStorageRoot = path.resolve(
  process.env.LOCAL_STORAGE_DIR || path.resolve(process.cwd(), "local-storage"),
);
const uploadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createLocalUpload() {
  const id = randomUUID();
  return {
    id,
    objectPath: `/objects/uploads/${id}`,
    uploadURL: `http://127.0.0.1:${process.env.API_PORT || process.env.PORT || "5000"}/api/storage/local-upload/${id}`,
  };
}

function getUploadId(objectPath: string): string {
  const id = objectPath.match(/^\/objects\/uploads\/([^/]+)$/)?.[1];
  if (!id || !uploadIdPattern.test(id)) {
    throw new Error("Invalid local object path");
  }
  return id;
}

function getFilePaths(id: string) {
  if (!uploadIdPattern.test(id)) throw new Error("Invalid local upload identifier");
  return {
    content: path.join(localStorageRoot, `${id}.blob`),
    metadata: path.join(localStorageRoot, `${id}.json`),
  };
}

export async function writeLocalUpload(
  id: string,
  contentType: string,
  content: Buffer,
): Promise<void> {
  const files = getFilePaths(id);
  await mkdir(localStorageRoot, { recursive: true });
  await writeFile(files.content, content, { flag: "wx" });
  await writeFile(
    files.metadata,
    JSON.stringify({ contentType }),
    { flag: "wx" },
  );
}

export async function getLocalObjectMetadata(objectPath: string) {
  const files = getFilePaths(getUploadId(objectPath));
  const [fileStat, metadataContent] = await Promise.all([
    stat(files.content),
    readFile(files.metadata, "utf8"),
  ]);
  const metadata: unknown = JSON.parse(metadataContent);
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("contentType" in metadata) ||
    typeof metadata.contentType !== "string"
  ) {
    throw new Error("Invalid local object metadata");
  }
  return { size: fileStat.size, contentType: metadata.contentType };
}

export async function readLocalObjectPrefix(objectPath: string): Promise<Buffer> {
  const files = getFilePaths(getUploadId(objectPath));
  const stream = createReadStream(files.content, { start: 0, end: 15 });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createLocalObjectReadStream(objectPath: string) {
  return createReadStream(getFilePaths(getUploadId(objectPath)).content);
}

export async function deleteLocalObject(objectPath: string): Promise<void> {
  const files = getFilePaths(getUploadId(objectPath));
  await Promise.all([
    rm(files.content, { force: true }),
    rm(files.metadata, { force: true }),
  ]);
}
