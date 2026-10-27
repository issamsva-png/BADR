import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  analysisDocumentsTable,
  db,
  documentUploadReservationsTable,
} from "@workspace/db";
import { and, eq, gt, lt } from "drizzle-orm";
import express from "express";
import { Readable } from "node:stream";
import { Router, type IRouter, type Request, type Response } from "express";
import { isSupportedUpload } from "../lib/analysisRules";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  createLocalObjectReadStream,
  createLocalUpload,
  deleteLocalObject,
  getLocalObjectMetadata,
  writeLocalUpload,
} from "../lib/localStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const localDemoMode = process.env.DEMO_MODE_LOCAL === "true";
function ownerId(res: Response): string {
  return res.locals.userId as string;
}

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid upload metadata" });
    return;
  }
  const { name, size, contentType } = parsed.data;
  if (!isSupportedUpload(name, contentType, size)) {
    res.status(400).json({ error: "Only PDF, JPG and PNG files up to 20 MB are accepted" });
    return;
  }
  try {
    const localUpload = localDemoMode ? createLocalUpload() : null;
    const uploadURL =
      localUpload?.uploadURL ?? (await objectStorage.getObjectEntityUploadURL());
    const objectPath =
      localUpload?.objectPath ?? objectStorage.normalizeObjectEntityPath(uploadURL);
    const userId = ownerId(res);
    const expiredReservations = await db
      .select({ objectPath: documentUploadReservationsTable.objectPath })
      .from(documentUploadReservationsTable)
      .where(
        and(
          eq(documentUploadReservationsTable.ownerId, userId),
          lt(documentUploadReservationsTable.expiresAt, new Date()),
        ),
      );
    for (const expired of expiredReservations) {
      try {
        if (localDemoMode) {
          await deleteLocalObject(expired.objectPath);
        } else {
          const abandonedFile = await objectStorage.getObjectEntityFile(expired.objectPath);
          await abandonedFile.delete({ ignoreNotFound: true });
        }
      } catch {
        // An expired upload may never have created an object.
      }
    }
    await db
      .delete(documentUploadReservationsTable)
      .where(
        and(
          eq(documentUploadReservationsTable.ownerId, userId),
          lt(documentUploadReservationsTable.expiresAt, new Date()),
        ),
      );
    await db.insert(documentUploadReservationsTable).values({
      ownerId: userId,
      objectPath,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not request private document upload");
    res.status(500).json({ error: "Could not prepare document upload" });
  }
});

router.put(
  "/storage/local-upload/:uploadId",
  express.raw({ type: ["application/pdf", "image/jpeg", "image/png"], limit: "20mb" }),
  async (req: Request, res: Response) => {
    if (!localDemoMode) {
      res.status(404).end();
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "A PDF, JPG or PNG file body is required" });
      return;
    }
    const uploadId = Array.isArray(req.params.uploadId)
      ? req.params.uploadId[0]
      : req.params.uploadId;
    const objectPath = `/objects/uploads/${uploadId}`;
    try {
      const [reservation] = await db
        .select()
        .from(documentUploadReservationsTable)
        .where(
          and(
            eq(documentUploadReservationsTable.objectPath, objectPath),
            eq(documentUploadReservationsTable.ownerId, ownerId(res)),
            gt(documentUploadReservationsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!reservation) {
        res.status(403).json({ error: "Upload reservation is missing or expired" });
        return;
      }
      await writeLocalUpload(uploadId, req.get("content-type") ?? "", req.body);
      res.status(204).end();
    } catch (error) {
      req.log.error({ err: error }, "Could not store local demo upload");
      res.status(500).json({ error: "Could not store uploaded document" });
    }
  },
);

router.get("/storage/objects/*objectPath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.objectPath;
    const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
    const [document] = await db
      .select()
      .from(analysisDocumentsTable)
      .where(
        and(
          eq(analysisDocumentsTable.objectPath, objectPath),
          eq(analysisDocumentsTable.ownerId, ownerId(res)),
        ),
      )
      .limit(1);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (localDemoMode) {
      const metadata = await getLocalObjectMetadata(objectPath);
      res.setHeader("Content-Type", metadata.contentType);
      res.setHeader("Content-Length", String(metadata.size));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      createLocalObjectReadStream(objectPath).pipe(res);
      return;
    }
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const response = await objectStorage.downloadObject(file, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    req.log.error({ err: error }, "Could not stream private document");
    res.status(500).json({ error: "Could not retrieve document" });
  }
});

export default router;
