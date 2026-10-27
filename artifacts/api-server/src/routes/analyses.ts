import { randomUUID } from "node:crypto";
import {
  CreateAnalysisBody,
  CreateDocumentBody,
  CreateObservationBody,
  UpdateAnalysisBody,
  UpdateDocumentBody,
  UpdateObservationBody,
} from "@workspace/api-zod";
import {
  analysisDocumentsTable,
  analysisObservationsTable,
  analysesTable,
  db,
  documentUploadReservationsTable,
} from "@workspace/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { lookupFrenchRegistry, getRegistryCandidate } from "../lib/frenchRegistry";
import {
  getPdfSignatureVerifierStatus,
  verifyPdfSignature,
  type PdfSignatureResult,
} from "../lib/pdfSignature";
import {
  ALLOWED_CONCLUSIONS,
  canAttachDocument,
  canCompleteAnalysis,
  checkDocumentDateOrder,
  expectedDocumentCount,
  findSubsidyFieldDifferences,
  matchesFileSignature,
  verifyIbanChecksum,
  verifyMrzCheckDigit,
  verifySiretLuhn,
  type AnalysisMode,
} from "../lib/analysisRules";
import { ObjectStorageService, readObjectPrefix } from "../lib/objectStorage";
import {
  deleteLocalObject,
  getLocalObjectMetadata,
  createLocalObjectReadStream,
  readLocalObjectPrefix,
} from "../lib/localStorage";
import {
  AutomaticReviewError,
  createAutomaticReview,
  type ReviewDocumentInput,
} from "../lib/automaticReview";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const localDemoMode = process.env.DEMO_MODE_LOCAL === "true";
const conclusions = ALLOWED_CONCLUSIONS;

class DocumentAttachError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function ownerId(res: Response): string {
  return res.locals.userId as string;
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

async function readDocumentBytes(document: typeof analysisDocumentsTable.$inferSelect): Promise<Buffer> {
  const stream = localDemoMode
    ? createLocalObjectReadStream(document.objectPath)
    : (await objectStorage.getObjectEntityFile(document.objectPath)).createReadStream();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 20 * 1024 * 1024) {
      stream.destroy();
      throw new Error("The document exceeds the local signature verifier size limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function saveDocumentControlStatus(
  document: typeof analysisDocumentsTable.$inferSelect,
  controlStatus: Record<string, unknown>,
) {
  await db
    .update(analysisDocumentsTable)
    .set({ controlStatus, updatedAt: new Date() })
    .where(eq(analysisDocumentsTable.id, document.id));
  return controlStatus;
}

async function verifyStoredPdf(
  document: typeof analysisDocumentsTable.$inferSelect,
): Promise<PdfSignatureResult> {
  const verifier = await getPdfSignatureVerifierStatus();
  if (!verifier.available) {
    return {
      status: "unavailable",
      signaturesFound: 0,
      signer: null,
      signedAt: null,
      certificateStatus: "unknown",
      checkedAt: new Date().toISOString(),
      message: verifier.message,
    };
  }
  try {
    return await verifyPdfSignature(await readDocumentBytes(document));
  } catch (error) {
    return {
      status: "unavailable",
      signaturesFound: 0,
      signer: null,
      signedAt: null,
      certificateStatus: "unknown",
      checkedAt: new Date().toISOString(),
      message: error instanceof Error
        ? `La vérification locale a échoué : ${error.message}`
        : "La vérification locale du PDF a échoué.",
    };
  }
}

async function updateFrenchRegistryControl(
  document: typeof analysisDocumentsTable.$inferSelect,
) {
  const fields = document.extractedFields ?? {};
  const registryResult = await lookupFrenchRegistry(getRegistryCandidate(fields));
  const previousStatus = document.controlStatus && typeof document.controlStatus === "object"
    ? document.controlStatus as Record<string, unknown>
    : {};
  const controlStatus = {
    ...previousStatus,
    frenchRegistry: registryResult,
    "Consultation d’un registre externe": registryResult.status === "found_active" || registryResult.status === "found_closed"
      ? "performed"
      : registryResult.status,
  };
  await saveDocumentControlStatus(document, controlStatus);
  return controlStatus;
}

async function findOwnedAnalysis(analysisId: string, userId: string) {
  const [analysis] = await db
    .select()
    .from(analysesTable)
    .where(and(eq(analysesTable.id, analysisId), eq(analysesTable.ownerId, userId)))
    .limit(1);
  return analysis;
}

async function findOwnedDocument(documentId: string, userId: string) {
  const [document] = await db
    .select()
    .from(analysisDocumentsTable)
    .where(
      and(
        eq(analysisDocumentsTable.id, documentId),
        eq(analysisDocumentsTable.ownerId, userId),
      ),
    )
    .limit(1);
  return document;
}

function toAnalysis(analysis: typeof analysesTable.$inferSelect, documentCount: number) {
  return { ...analysis, documentCount };
}

router.get("/analyses/dashboard", async (req: Request, res: Response) => {
  try {
    const userId = ownerId(res);
    const analyses = await db
      .select()
      .from(analysesTable)
      .where(eq(analysesTable.ownerId, userId))
      .orderBy(desc(analysesTable.updatedAt));
    const documents = await db
      .select({ analysisId: analysisDocumentsTable.analysisId })
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.ownerId, userId));
    const counts = new Map<string, number>();
    for (const document of documents) {
      counts.set(document.analysisId, (counts.get(document.analysisId) ?? 0) + 1);
    }
    const data = analyses.map((analysis) =>
      toAnalysis(analysis, counts.get(analysis.id) ?? 0),
    );
    const countConclusion = (value: string) =>
      data.filter((analysis) => analysis.conclusion === value).length;
    res.json({
      totalAnalyses: data.length,
      totalDocuments: documents.length,
      compliant: countConclusion(conclusions[0]),
      doubtful: countConclusion(conclusions[1]),
      probableFraud: countConclusion(conclusions[2]),
      needsInformation: countConclusion(conclusions[3]),
      awaitingReview: data.filter((analysis) => analysis.status !== "completed").length,
      recent: data.slice(0, 5),
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not load analysis dashboard");
    res.status(500).json({ error: "Could not load dashboard" });
  }
});

router.get("/analyses", async (req: Request, res: Response) => {
  try {
    const userId = ownerId(res);
    const analyses = await db
      .select()
      .from(analysesTable)
      .where(eq(analysesTable.ownerId, userId))
      .orderBy(desc(analysesTable.updatedAt));
    const documents = await db
      .select({ analysisId: analysisDocumentsTable.analysisId })
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.ownerId, userId));
    const counts = new Map<string, number>();
    for (const document of documents) {
      counts.set(document.analysisId, (counts.get(document.analysisId) ?? 0) + 1);
    }
    res.json(analyses.map((analysis) => toAnalysis(analysis, counts.get(analysis.id) ?? 0)));
  } catch (error) {
    req.log.error({ err: error }, "Could not list analyses");
    res.status(500).json({ error: "Could not list analyses" });
  }
});

router.post("/analyses", async (req: Request, res: Response) => {
  const parsed = CreateAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid analysis details" });
    return;
  }
  try {
    const id = randomUUID();
    await db.insert(analysesTable).values({
      id,
      ownerId: ownerId(res),
      mode: parsed.data.mode,
      title: parsed.data.title.trim(),
    });
    const [analysis] = await db
      .select()
      .from(analysesTable)
      .where(eq(analysesTable.id, id))
      .limit(1);
    if (!analysis) throw new Error("Created analysis could not be loaded");
    res.status(201).json(toAnalysis(analysis, 0));
  } catch (error) {
    req.log.error({ err: error }, "Could not create analysis");
    res.status(500).json({ error: "Could not create analysis" });
  }
});

router.get("/analyses/:analysisId", async (req: Request, res: Response) => {
  try {
    const analysis = await findOwnedAnalysis(routeParam(req.params.analysisId), ownerId(res));
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    const [documents, observations] = await Promise.all([
      db
        .select()
        .from(analysisDocumentsTable)
        .where(eq(analysisDocumentsTable.analysisId, analysis.id))
        .orderBy(analysisDocumentsTable.createdAt),
      db
        .select()
        .from(analysisObservationsTable)
        .where(eq(analysisObservationsTable.analysisId, analysis.id))
        .orderBy(desc(analysisObservationsTable.createdAt)),
    ]);
    res.json({ ...toAnalysis(analysis, documents.length), documents, observations });
  } catch (error) {
    req.log.error({ err: error }, "Could not load analysis");
    res.status(500).json({ error: "Could not load analysis" });
  }
});

router.post("/analyses/:analysisId/automatic-review", async (req: Request, res: Response) => {
  try {
    const analysis = await findOwnedAnalysis(routeParam(req.params.analysisId), ownerId(res));
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    if (analysis.mode !== "subsidy" && analysis.mode !== "independent_batch") {
      res.status(409).json({ error: "Unsupported analysis mode" });
      return;
    }
    const documents = await db
      .select({
        id: analysisDocumentsTable.id,
        fileName: analysisDocumentsTable.fileName,
        category: analysisDocumentsTable.category,
        pageCount: analysisDocumentsTable.pageCount,
        extractedText: analysisDocumentsTable.extractedText,
        extractedFields: analysisDocumentsTable.extractedFields,
      })
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.analysisId, analysis.id))
      .orderBy(analysisDocumentsTable.createdAt);
    const requiredCount = expectedDocumentCount(analysis.mode as AnalysisMode);
    if (documents.length !== requiredCount) {
      res.status(409).json({
        error: `Attach exactly ${requiredCount} documents before running the automatic review.`,
      });
      return;
    }
    const automaticReview = await createAutomaticReview(
      analysis.mode as AnalysisMode,
      documents as ReviewDocumentInput[],
    );
    if (analysis.mode === "subsidy") {
      const result = automaticReview.overall;
      if (!result) {
        throw new Error("The subsidy review did not return an overall conclusion.");
      }
      await db
        .update(analysesTable)
        .set({
          automaticReview,
          conclusion: result.conclusionSuggestion,
          conclusionRationale: result.rationale,
          alternativeExplanation: result.alternativeExplanation,
          additionalVerification: result.additionalVerification,
          operationalAction: result.operationalAction,
          status: "completed",
          updatedAt: new Date(),
        })
        .where(and(eq(analysesTable.id, analysis.id), eq(analysesTable.ownerId, ownerId(res))));
    } else {
      const resultByDocument = new Map(
        automaticReview.documents.map((entry) => [entry.documentId, entry.result]),
      );
      if (resultByDocument.size !== documents.length) {
        throw new Error("The independent review did not return one conclusion per document.");
      }
      await db.transaction(async (tx) => {
        for (const document of documents) {
          const result = resultByDocument.get(document.id);
          if (!result) {
            throw new Error(`The independent review returned no conclusion for ${document.fileName}.`);
          }
          await tx
            .update(analysisDocumentsTable)
            .set({
              reviewConclusion: result.conclusionSuggestion,
              reviewRationale: result.rationale,
              reviewAlternativeExplanation: result.alternativeExplanation,
              reviewVerification: result.additionalVerification,
              reviewAction: result.operationalAction,
              updatedAt: new Date(),
            })
            .where(eq(analysisDocumentsTable.id, document.id));
        }
        await tx
          .update(analysesTable)
          .set({ automaticReview, status: "completed", updatedAt: new Date() })
          .where(and(eq(analysesTable.id, analysis.id), eq(analysesTable.ownerId, ownerId(res))));
      });
    }
    res.json({ automaticReview });
  } catch (error) {
    if (error instanceof AutomaticReviewError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Could not run local automatic review");
    res.status(500).json({ error: "Could not run local automatic review" });
  }
});

router.patch("/analyses/:analysisId", async (req: Request, res: Response) => {
  const parsed = UpdateAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid analysis review" });
    return;
  }
  if (
    parsed.data.conclusion !== undefined &&
    parsed.data.conclusion !== null &&
    !conclusions.includes(parsed.data.conclusion)
  ) {
    res.status(400).json({ error: "Invalid conclusion" });
    return;
  }
  try {
    const id = routeParam(req.params.analysisId);
    const current = await findOwnedAnalysis(id, ownerId(res));
    if (!current) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    if (
      current.mode === "independent_batch" &&
      (parsed.data.conclusion != null || parsed.data.status === "completed")
    ) {
      res.status(400).json({
        error: "Independent documents must be concluded and completed individually",
      });
      return;
    }
    if (parsed.data.status === "completed" && !parsed.data.conclusion && !current.conclusion) {
      res.status(400).json({ error: "A conclusion is required before completing an analysis" });
      return;
    }
    if (parsed.data.status === "completed") {
      const attachedDocuments = await db
        .select({ id: analysisDocumentsTable.id })
        .from(analysisDocumentsTable)
        .where(eq(analysisDocumentsTable.analysisId, current.id));
      const requiredCount = expectedDocumentCount(current.mode as AnalysisMode);
      if (
        !canCompleteAnalysis(
          current.mode as AnalysisMode,
          attachedDocuments.length,
          parsed.data.conclusion ?? current.conclusion,
          parsed.data.conclusionRationale ?? current.conclusionRationale,
        )
      ) {
        res.status(400).json({
          error: `Exactly ${requiredCount} documents, an allowed conclusion and written rationale are required before completion`,
        });
        return;
      }
    }
    if (
      parsed.data.conclusion &&
      !(parsed.data.conclusionRationale?.trim() ?? current.conclusionRationale?.trim())
    ) {
      res.status(400).json({ error: "A written rationale is required for a conclusion" });
      return;
    }
    await db
      .update(analysesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(analysesTable.id, id), eq(analysesTable.ownerId, ownerId(res))));
    const [updated] = await db
      .select()
      .from(analysesTable)
      .where(and(eq(analysesTable.id, id), eq(analysesTable.ownerId, ownerId(res))))
      .limit(1);
    if (!updated) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    const documents = await db
      .select({ id: analysisDocumentsTable.id })
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.analysisId, id));
    res.json(toAnalysis(updated, documents.length));
  } catch (error) {
    req.log.error({ err: error }, "Could not update analysis");
    res.status(500).json({ error: "Could not update analysis" });
  }
});

router.delete("/analyses/:analysisId", async (req: Request, res: Response) => {
  try {
    const analysis = await findOwnedAnalysis(routeParam(req.params.analysisId), ownerId(res));
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    const documents = await db
      .select({ objectPath: analysisDocumentsTable.objectPath })
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.analysisId, analysis.id));
    for (const document of documents) {
      if (localDemoMode) {
        await deleteLocalObject(document.objectPath);
      } else {
        const file = await objectStorage.getObjectEntityFile(document.objectPath);
        await file.delete({ ignoreNotFound: true });
      }
    }
    await db
      .delete(analysesTable)
      .where(and(eq(analysesTable.id, analysis.id), eq(analysesTable.ownerId, ownerId(res))));
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Could not delete analysis");
    res.status(500).json({ error: "Could not delete analysis" });
  }
});

router.post("/analyses/:analysisId/documents", async (req: Request, res: Response) => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document details" });
    return;
  }
  try {
    const userId = ownerId(res);
    const analysis = await findOwnedAnalysis(routeParam(req.params.analysisId), userId);
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    if (!parsed.data.objectPath.startsWith("/objects/uploads/")) {
      res.status(400).json({ error: "Invalid private object path" });
      return;
    }
    const [reservation] = await db
      .select()
      .from(documentUploadReservationsTable)
      .where(
        and(
          eq(documentUploadReservationsTable.objectPath, parsed.data.objectPath),
          eq(documentUploadReservationsTable.ownerId, userId),
          gt(documentUploadReservationsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!reservation) {
      res.status(403).json({ error: "Upload reservation is missing or expired" });
      return;
    }
    const objectFile = localDemoMode
      ? null
      : await objectStorage.getObjectEntityFile(parsed.data.objectPath);
    const metadata = localDemoMode
      ? await getLocalObjectMetadata(parsed.data.objectPath)
      : (await objectFile!.getMetadata())[0];
    if (
      Number(metadata.size) !== parsed.data.size ||
      metadata.contentType !== parsed.data.mimeType
    ) {
      res.status(400).json({ error: "Uploaded file metadata does not match the reservation" });
      return;
    }
    const prefix = localDemoMode
      ? await readLocalObjectPrefix(parsed.data.objectPath)
      : await readObjectPrefix(objectFile!);
    if (!matchesFileSignature(parsed.data.mimeType, prefix)) {
      if (localDemoMode) {
        await deleteLocalObject(parsed.data.objectPath);
      } else {
        await objectFile!.delete({ ignoreNotFound: true });
      }
      await db
        .delete(documentUploadReservationsTable)
        .where(eq(documentUploadReservationsTable.id, reservation.id));
      res.status(400).json({ error: "File contents do not match the selected file type" });
      return;
    }
    const document = await db.transaction(async (tx) => {
      const [lockedAnalysis] = await tx
        .select()
        .from(analysesTable)
        .where(
          and(
            eq(analysesTable.id, analysis.id),
            eq(analysesTable.ownerId, userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!lockedAnalysis) {
        throw new DocumentAttachError("Analysis not found", 404);
      }
      const attachedDocuments = await tx
        .select({ id: analysisDocumentsTable.id })
        .from(analysisDocumentsTable)
        .where(eq(analysisDocumentsTable.analysisId, lockedAnalysis.id));
      if (!canAttachDocument(lockedAnalysis.mode as AnalysisMode, attachedDocuments.length)) {
        throw new DocumentAttachError(
          `This mode accepts a maximum of ${expectedDocumentCount(lockedAnalysis.mode as AnalysisMode)} documents`,
          409,
        );
      }
      const [activeReservation] = await tx
        .select()
        .from(documentUploadReservationsTable)
        .where(
          and(
            eq(documentUploadReservationsTable.objectPath, parsed.data.objectPath),
            eq(documentUploadReservationsTable.ownerId, userId),
            gt(documentUploadReservationsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!activeReservation) {
        throw new DocumentAttachError("Upload reservation is missing or expired", 403);
      }
      const documentId = randomUUID();
      await tx.insert(analysisDocumentsTable).values({
          id: documentId,
          analysisId: lockedAnalysis.id,
          ownerId: userId,
          fileName: parsed.data.fileName,
          mimeType: parsed.data.mimeType,
          size: parsed.data.size,
          objectPath: parsed.data.objectPath,
          category: parsed.data.category,
          pageCount: parsed.data.pageCount ?? 0,
          extractedText: parsed.data.extractedText ?? null,
          extractedFields: parsed.data.extractedFields ?? {},
          controlStatus: {
            ...(parsed.data.controlStatus ?? {}),
            "Vérification du format de fichier": "performed",
            fileSignature: {
              status: "performed",
              method: "Vérification locale de la signature du format du fichier",
              mimeType: parsed.data.mimeType,
              completedAt: new Date().toISOString(),
            },
          },
        });
      const [created] = await tx
        .select()
        .from(analysisDocumentsTable)
        .where(eq(analysisDocumentsTable.id, documentId))
        .limit(1);
      if (!created) throw new Error("Created document could not be loaded");
      await tx
        .delete(documentUploadReservationsTable)
        .where(eq(documentUploadReservationsTable.id, activeReservation.id));
      await tx
        .update(analysesTable)
        .set({ status: "in_review", automaticReview: null, updatedAt: new Date() })
        .where(eq(analysesTable.id, lockedAnalysis.id));
      return created;
    });
    await createDeterministicObservations({
      analysisId: analysis.id,
      documentId: document.id,
      ownerId: userId,
      fields: parsed.data.extractedFields ?? {},
    });
    await createSubsidyComparisonObservations(analysis.id, userId);
    let controlStatus: Record<string, unknown> = await updateFrenchRegistryControl(document);
    if (document.mimeType === "application/pdf") {
      const signatureVerification = await verifyStoredPdf(document);
      controlStatus = {
        ...controlStatus,
        pdfSignature: signatureVerification,
        "Signature cryptographique du PDF": signatureVerification.status,
      };
      await saveDocumentControlStatus(document, controlStatus);
    } else {
      controlStatus = {
        ...controlStatus,
        pdfSignature: {
          status: "not_applicable",
          signaturesFound: 0,
          signer: null,
          signedAt: null,
          certificateStatus: "not_applicable",
          checkedAt: new Date().toISOString(),
          message: "La vérification cryptographique des signatures PDF ne s’applique pas aux images.",
        },
      };
      await saveDocumentControlStatus(document, controlStatus);
    }
    const [updatedDocument] = await db
      .select()
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.id, document.id))
      .limit(1);
    res.status(201).json(updatedDocument ?? { ...document, controlStatus });
  } catch (error) {
    if (error instanceof DocumentAttachError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Could not attach document");
    res.status(500).json({ error: "Could not attach document" });
  }
});

router.post("/documents/:documentId/verify-signature", async (req: Request, res: Response) => {
  try {
    const document = await findOwnedDocument(routeParam(req.params.documentId), ownerId(res));
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (document.mimeType !== "application/pdf") {
      res.status(400).json({ error: "Cryptographic PDF signature verification only supports PDF files" });
      return;
    }
    const result = await verifyStoredPdf(document);
    const previousStatus = document.controlStatus && typeof document.controlStatus === "object"
      ? document.controlStatus as Record<string, unknown>
      : {};
    const controlStatus = {
      ...previousStatus,
      pdfSignature: result,
      "Signature cryptographique du PDF": result.status,
    };
    await saveDocumentControlStatus(document, controlStatus);
    res.json({ signatureVerification: result });
  } catch (error) {
    req.log.error({ err: error }, "Could not verify PDF signature");
    res.status(500).json({ error: "Could not verify PDF signature" });
  }
});

router.post("/documents/:documentId/verify-registry", async (req: Request, res: Response) => {
  try {
    const document = await findOwnedDocument(routeParam(req.params.documentId), ownerId(res));
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const controlStatus = await updateFrenchRegistryControl(document);
    res.json({ frenchRegistry: controlStatus.frenchRegistry });
  } catch (error) {
    req.log.error({ err: error }, "Could not verify French registry entry");
    res.status(500).json({ error: "Could not verify French registry entry" });
  }
});

router.patch("/documents/:documentId", async (req: Request, res: Response) => {
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document review" });
    return;
  }
  try {
    const document = await findOwnedDocument(routeParam(req.params.documentId), ownerId(res));
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const parentAnalysis = await findOwnedAnalysis(document.analysisId, ownerId(res));
    if (!parentAnalysis) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    const requestedConclusion = parsed.data.reviewConclusion;
    const finalConclusion = requestedConclusion === undefined
      ? document.reviewConclusion
      : requestedConclusion;
    const finalRationale = parsed.data.reviewRationale === undefined
      ? document.reviewRationale
      : parsed.data.reviewRationale;
    if (
      parentAnalysis.mode === "independent_batch" &&
      finalConclusion &&
      !finalRationale?.trim()
    ) {
      res.status(400).json({
        error: "A written rationale is required for each independent document conclusion",
      });
      return;
    }
    if (
      requestedConclusion !== undefined &&
      requestedConclusion !== null &&
      !conclusions.includes(requestedConclusion)
    ) {
      res.status(400).json({ error: "Invalid document conclusion" });
      return;
    }
    await db
      .update(analysisDocumentsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(analysisDocumentsTable.id, document.id));
    const [updated] = await db
      .select()
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.id, document.id))
      .limit(1);
    if (!updated) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (parsed.data.extractedFields !== undefined) {
      await updateFrenchRegistryControl(updated);
    }
    await db
      .update(analysesTable)
      .set({
        updatedAt: new Date(),
        ...(parsed.data.extractedText !== undefined ||
        parsed.data.extractedFields !== undefined ||
        parsed.data.category !== undefined
          ? { automaticReview: null }
          : {}),
        ...(parentAnalysis.mode === "independent_batch"
          ? { status: "in_review" }
          : {}),
      })
      .where(eq(analysesTable.id, document.analysisId));
    if (parentAnalysis.mode === "independent_batch") {
      const documents = await db
        .select({
          reviewConclusion: analysisDocumentsTable.reviewConclusion,
          reviewRationale: analysisDocumentsTable.reviewRationale,
        })
        .from(analysisDocumentsTable)
        .where(eq(analysisDocumentsTable.analysisId, document.analysisId));
      const allDocumentsReviewed =
        documents.length === expectedDocumentCount("independent_batch") &&
        documents.every(
          (candidate) =>
            candidate.reviewConclusion !== null &&
            Boolean(candidate.reviewRationale?.trim()),
        );
      if (allDocumentsReviewed) {
        await db
          .update(analysesTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(analysesTable.id, document.analysisId));
      }
    }
    const [updatedWithChecks] = await db
      .select()
      .from(analysisDocumentsTable)
      .where(eq(analysisDocumentsTable.id, document.id))
      .limit(1);
    res.json(updatedWithChecks ?? updated);
  } catch (error) {
    req.log.error({ err: error }, "Could not update document");
    res.status(500).json({ error: "Could not update document" });
  }
});

router.delete("/documents/:documentId", async (req: Request, res: Response) => {
  try {
    const document = await findOwnedDocument(routeParam(req.params.documentId), ownerId(res));
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (localDemoMode) {
      await deleteLocalObject(document.objectPath);
    } else {
      const file = await objectStorage.getObjectEntityFile(document.objectPath);
      await file.delete({ ignoreNotFound: true });
    }
    await db.delete(analysisDocumentsTable).where(eq(analysisDocumentsTable.id, document.id));
    await db
      .update(analysesTable)
      .set({ automaticReview: null, updatedAt: new Date() })
      .where(eq(analysesTable.id, document.analysisId));
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Could not delete document");
    res.status(500).json({ error: "Could not delete document" });
  }
});

router.post("/analyses/:analysisId/observations", async (req: Request, res: Response) => {
  const parsed = CreateObservationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid observation" });
    return;
  }
  try {
    const analysis = await findOwnedAnalysis(routeParam(req.params.analysisId), ownerId(res));
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    if (parsed.data.documentId) {
      const document = await findOwnedDocument(parsed.data.documentId, ownerId(res));
      if (!document || document.analysisId !== analysis.id) {
        res.status(400).json({ error: "Observation document must belong to this analysis" });
        return;
      }
    }
    const observationId = randomUUID();
    await db.insert(analysisObservationsTable).values({
        id: observationId,
        analysisId: analysis.id,
        ownerId: ownerId(res),
        documentId: parsed.data.documentId ?? null,
        classification: parsed.data.classification,
        severity: parsed.data.severity,
        page: parsed.data.page ?? null,
        field: parsed.data.field ?? null,
        observedValue: parsed.data.observedValue ?? null,
        description: parsed.data.description,
        method: parsed.data.method,
        confidence: parsed.data.confidence ?? null,
        resolved: parsed.data.resolved ?? false,
        source: "analyst",
      });
    const [observation] = await db
      .select()
      .from(analysisObservationsTable)
      .where(eq(analysisObservationsTable.id, observationId))
      .limit(1);
    if (!observation) throw new Error("Created observation could not be loaded");
    await db
      .update(analysesTable)
      .set({ status: "in_review", updatedAt: new Date() })
      .where(eq(analysesTable.id, analysis.id));
    res.status(201).json(observation);
  } catch (error) {
    req.log.error({ err: error }, "Could not create observation");
    res.status(500).json({ error: "Could not create observation" });
  }
});

router.patch("/observations/:observationId", async (req: Request, res: Response) => {
  const parsed = UpdateObservationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid observation update" });
    return;
  }
  try {
    const [observation] = await db
      .select()
      .from(analysisObservationsTable)
      .where(
        and(
          eq(analysisObservationsTable.id, routeParam(req.params.observationId)),
          eq(analysisObservationsTable.ownerId, ownerId(res)),
        ),
      )
      .limit(1);
    if (!observation) {
      res.status(404).json({ error: "Observation not found" });
      return;
    }
    await db
      .update(analysisObservationsTable)
      .set(parsed.data)
      .where(eq(analysisObservationsTable.id, observation.id));
    const [updated] = await db
      .select()
      .from(analysisObservationsTable)
      .where(eq(analysisObservationsTable.id, observation.id))
      .limit(1);
    if (!updated) {
      res.status(404).json({ error: "Observation not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    req.log.error({ err: error }, "Could not update observation");
    res.status(500).json({ error: "Could not update observation" });
  }
});

router.delete("/observations/:observationId", async (req: Request, res: Response) => {
  try {
    const [observation] = await db
      .select()
      .from(analysisObservationsTable)
      .where(
        and(
          eq(analysisObservationsTable.id, routeParam(req.params.observationId)),
          eq(analysisObservationsTable.ownerId, ownerId(res)),
        ),
      )
      .limit(1);
    if (!observation) {
      res.status(404).json({ error: "Observation not found" });
      return;
    }
    await db
      .delete(analysisObservationsTable)
      .where(eq(analysisObservationsTable.id, observation.id));
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Could not delete observation");
    res.status(500).json({ error: "Could not delete observation" });
  }
});

export default router;

async function createDeterministicObservations({
  analysisId,
  documentId,
  ownerId,
  fields,
}: {
  analysisId: string;
  documentId: string;
  ownerId: string;
  fields: Record<string, unknown>;
}) {
  const observations: Array<typeof analysisObservationsTable.$inferInsert> = [];
  const addCheck = (
    key: string,
    classification: "FACT" | "SIGNAL",
    description: string,
    value: string,
  ) => {
    observations.push({
      analysisId,
      documentId,
      ownerId,
      classification,
      severity: classification === "SIGNAL" ? "medium" : "low",
      field: key,
      observedValue: value,
      description,
      method: "Contrôle déterministe local sur le champ transcrit ; confirmer la valeur sur le document original.",
      confidence: null,
      source: "deterministic",
    });
  };
  const iban = fields.iban;
  if (typeof iban === "string" && iban.trim()) {
    const valid = verifyIbanChecksum(iban);
    addCheck(
      "iban",
      valid ? "FACT" : "SIGNAL",
      valid
        ? "La structure et la clé de contrôle de l’IBAN sont cohérentes. Cela ne confirme ni le titulaire du compte ni l’authenticité du document."
        : "La structure ou la clé de contrôle de l’IBAN est incohérente. Une erreur OCR ou de transcription est possible ; vérifiez la valeur sur l’original.",
      iban,
    );
  }
  const siret = fields.siret;
  if (typeof siret === "string" && siret.trim()) {
    const valid = verifySiretLuhn(siret);
    addCheck(
      "siret",
      valid ? "FACT" : "SIGNAL",
      valid
        ? "Le format du SIRET et le contrôle de Luhn sont cohérents. Cela ne confirme ni l’immatriculation actuelle ni l’authenticité du document."
        : "Le format du SIRET ou le contrôle de Luhn est incohérent. Vérifiez la transcription et les règles applicables à cet identifiant.",
      siret,
    );
  }
  const mrzData = fields.mrzCheckData;
  const mrzDigit = fields.mrzCheckDigit;
  if (typeof mrzData === "string" && typeof mrzDigit === "string") {
    const valid = verifyMrzCheckDigit(mrzData, mrzDigit);
    addCheck(
      "MRZ check digit",
      valid ? "FACT" : "SIGNAL",
      valid
        ? "La clé de contrôle MRZ fournie est mathématiquement cohérente. Cela n’authentifie pas la pièce d’identité."
        : "La clé de contrôle MRZ fournie est incohérente. Une erreur OCR ou de transcription est possible.",
      `${mrzData} / ${mrzDigit}`,
    );
  }
  const issueDate = fields.issueDate;
  const expiryDate = fields.expiryDate;
  if (typeof issueDate === "string" && typeof expiryDate === "string") {
    const dateCheck = checkDocumentDateOrder(issueDate, expiryDate);
    if (dateCheck !== "unreadable") {
      addCheck(
        "Date order",
        dateCheck === "ordered" ? "FACT" : "SIGNAL",
        dateCheck === "ordered"
          ? "Les dates d’émission et d’expiration transcrites sont dans l’ordre chronologique."
          : "La date d’émission transcrite est postérieure à la date d’expiration. Vérifiez les deux dates sur le document original.",
        `${issueDate} / ${expiryDate}`,
      );
    }
  }
  if (observations.length > 0) {
    await db.insert(analysisObservationsTable).values(observations);
  }
}

async function createSubsidyComparisonObservations(analysisId: string, ownerId: string) {
  const [analysis] = await db
    .select({ mode: analysesTable.mode })
    .from(analysesTable)
    .where(eq(analysesTable.id, analysisId))
    .limit(1);
  if (!analysis || analysis.mode !== "subsidy") return;

  const documents = await db
    .select({
      id: analysisDocumentsTable.id,
      fileName: analysisDocumentsTable.fileName,
      extractedFields: analysisDocumentsTable.extractedFields,
    })
    .from(analysisDocumentsTable)
    .where(eq(analysisDocumentsTable.analysisId, analysisId));
  if (documents.length !== expectedDocumentCount("subsidy")) return;

  const differences = findSubsidyFieldDifferences(
    "subsidy",
    documents.map((document) => ({
      label: document.id,
      fields: document.extractedFields,
    })),
  );
  const observations: Array<typeof analysisObservationsTable.$inferInsert> = [];
  for (const difference of differences) {
    const baseline = difference.values[0];
    if (!baseline) continue;
    const baselineDocument = documents.find(
      (candidate) => candidate.id === baseline.document,
    );
    if (!baselineDocument) continue;
    for (const differingValue of difference.values.slice(1)) {
      const document = documents.find(
        (candidate) => candidate.id === differingValue.document,
      );
      if (!document) continue;
      observations.push({
        id: randomUUID(),
        analysisId,
        documentId: document.id,
        ownerId,
        classification: "SIGNAL",
        severity: "medium",
        field: difference.field,
        observedValue: differingValue.value,
        description: `Écart de cohérence automatique pour le champ « ${difference.field} » : « ${differingValue.value} » dans cette pièce, contre « ${baseline.value} » dans « ${baselineDocument.fileName} ». Un écart peut être légitime ou provenir d’une erreur OCR ; vérifiez les deux originaux avant toute conclusion.`,
        method: "Comparaison déterministe des champs extraits entre les 5 pièces du dossier subvention ; vérification humaine requise.",
        confidence: null,
        resolved: false,
        source: "deterministic",
      });
    }
  }
  if (observations.length > 0) {
    await db.insert(analysisObservationsTable).values(observations);
  }
}
