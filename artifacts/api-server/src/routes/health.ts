import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getOllamaStatus } from "../lib/automaticReview";
import { getPdfSignatureVerifierStatus } from "../lib/pdfSignature";

const router: IRouter = Router();

router.get("/healthz", async (req: Request, res: Response) => {
  try {
    await db.execute(sql`select 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Health check failed");
    res.status(503).json({ status: "unavailable" });
  }
});

router.get("/ollama-status", async (_req: Request, res: Response) => {
  res.json(await getOllamaStatus());
});

router.get("/verification-status", async (_req: Request, res: Response) => {
  const signatureVerifier = await getPdfSignatureVerifierStatus();
  res.json({
    signatureVerifier,
    frenchRegistry: {
      enabled: true,
      source: "https://annuaire-entreprises.data.gouv.fr",
      message: "Les SIREN/SIRET extraits sont recherchés automatiquement dans l’API publique officielle. Seuls ces identifiants sont transmis.",
    },
  });
});

export default router;
