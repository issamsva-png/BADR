import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type PdfSignatureResult = {
  status: "valid" | "invalid" | "unsigned" | "untrusted" | "unavailable";
  signaturesFound: number;
  signer: string | null;
  signedAt: string | null;
  certificateStatus: "trusted" | "expired" | "revoked" | "unknown" | "not_applicable";
  checkedAt: string;
  message: string;
};

function makeResult(
  status: PdfSignatureResult["status"],
  message: string,
  details: Partial<Pick<PdfSignatureResult, "signaturesFound" | "signer" | "signedAt" | "certificateStatus">> = {},
): PdfSignatureResult {
  return {
    status,
    signaturesFound: 0,
    signer: null,
    signedAt: null,
    certificateStatus: "unknown",
    checkedAt: new Date().toISOString(),
    ...details,
    message,
  };
}

export function classifyPdfSigOutput(output: string): PdfSignatureResult {
  const signatureCount = [...output.matchAll(/Signature\s+#\d+/gi)].length;
  if (signatureCount === 0) {
    return makeResult(
      "unsigned",
      "Aucune signature PDF intégrée détectée. Une image de signature visible n’est pas une signature électronique.",
      { signaturesFound: 0, certificateStatus: "not_applicable" },
    );
  }
  if (/Signature Validation:\s*Signature is Invalid\./i.test(output)) {
    return makeResult(
      "invalid",
      "Au moins une signature PDF est invalide ou le contenu signé a été modifié.",
      { signaturesFound: signatureCount, certificateStatus: "unknown" },
    );
  }
  if (!/Signature Validation:\s*Signature is Valid\./i.test(output)) {
    return makeResult(
      "unavailable",
      "Le vérificateur n’a pas pu établir l’intégrité cryptographique de la signature.",
      { signaturesFound: signatureCount, certificateStatus: "unknown" },
    );
  }
  const signer = output.match(/Signer Certificate Common Name:\s*(.+)/i)?.[1]?.trim() ?? null;
  const signedAt = output.match(/Signing Time:\s*(.+)/i)?.[1]?.trim() ?? null;
  const validSignatures = [...output.matchAll(/Signature Validation:\s*Signature is Valid\./gi)].length;
  if (validSignatures < signatureCount) {
    return makeResult(
      "unavailable",
      "Le vérificateur n’a pas pu établir l’intégrité de toutes les signatures présentes.",
      { signaturesFound: signatureCount, signer, signedAt, certificateStatus: "unknown" },
    );
  }
  if (/Not total document signed/i.test(output)) {
    return makeResult(
      "untrusted",
      "La signature couvre une révision antérieure, mais pas tout le PDF actuel ; le fichier a pu être modifié après signature.",
      { signaturesFound: signatureCount, signer, signedAt, certificateStatus: "unknown" },
    );
  }
  if (/Certificate Validation:\s*Certificate has been revoked/i.test(output)) {
    return makeResult(
      "invalid",
      "La signature est présente, mais le certificat du signataire est indiqué comme révoqué.",
      { signaturesFound: signatureCount, signer, signedAt, certificateStatus: "revoked" },
    );
  }
  if (/Certificate Validation:\s*Certificate has expired/i.test(output)) {
    return makeResult(
      "untrusted",
      "L’intégrité cryptographique est valide, mais le certificat du signataire est expiré.",
      { signaturesFound: signatureCount, signer, signedAt, certificateStatus: "expired" },
    );
  }
  const trustedCertificates = [...output.matchAll(/Certificate Validation:\s*Certificate is Trusted\./gi)].length;
  if (trustedCertificates >= signatureCount) {
    return makeResult(
      "valid",
      "L’intégrité cryptographique est valide et le vérificateur reconnaît le certificat comme fiable.",
      { signaturesFound: signatureCount, signer, signedAt, certificateStatus: "trusted" },
    );
  }
  return makeResult(
    "untrusted",
    "L’intégrité cryptographique de la signature est valide, mais la chaîne de confiance n’a pas pu être confirmée.",
    { signaturesFound: signatureCount, signer, signedAt, certificateStatus: "unknown" },
  );
}

export async function getPdfSignatureVerifierStatus(): Promise<{
  available: boolean;
  configuredPath: string | null;
  trustStoreConfigured: boolean;
  message: string;
}> {
  const configuredPath = process.env.PDFSIG_PATH?.trim() || null;
  const configuredTrustStore = process.env.PDFSIG_NSS_DIR?.trim();
  let trustStoreConfigured = false;
  if (configuredTrustStore) {
    try {
      trustStoreConfigured = (await stat(configuredTrustStore)).isDirectory();
    } catch {
      trustStoreConfigured = false;
    }
  }
  const executable = configuredPath ?? "pdfsig";
  try {
    await execFile(executable, ["-v"], { timeout: 3000, windowsHide: true });
    return {
      available: true,
      configuredPath,
      trustStoreConfigured,
      message: trustStoreConfigured
        ? "Le vérificateur local pdfsig et son magasin NSS configuré sont disponibles."
        : configuredTrustStore
          ? "pdfsig est disponible, mais le dossier de certificats PDFSIG_NSS_DIR est introuvable ou invalide."
          : "Le vérificateur local pdfsig est disponible ; configurez PDFSIG_NSS_DIR avec le magasin NSS de confiance pour valider les certificats.",
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      configuredPath,
      trustStoreConfigured,
      message: code === "ENOENT"
        ? "pdfsig est introuvable. Installez Poppler pour Windows et configurez PDFSIG_PATH ou le PATH."
        : "pdfsig n’a pas pu démarrer. Vérifiez son installation et sa configuration.",
    };
  }
}

export async function verifyPdfSignature(
  pdf: Buffer,
): Promise<PdfSignatureResult> {
  const verifier = await getPdfSignatureVerifierStatus();
  if (!verifier.available) {
    return makeResult("unavailable", verifier.message);
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "finovox-pdf-signature-"));
  const filePath = path.join(directory, "document.pdf");
  try {
    await writeFile(filePath, pdf, { flag: "wx" });
    const executable = verifier.configuredPath ?? "pdfsig";
    let output: string;
    const nssDirectory = process.env.PDFSIG_NSS_DIR?.trim();
    const args = [
      "-no-ocsp",
      ...(nssDirectory ? ["-nssdir", nssDirectory] : []),
      filePath,
    ];
    try {
      const result = await execFile(executable, args, {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const processError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      output = `${processError.stdout ?? ""}\n${processError.stderr ?? ""}`;
      if (!output.trim()) {
        return makeResult(
          "unavailable",
          processError.code === "ETIMEDOUT"
            ? "La vérification locale de la signature a dépassé le délai autorisé."
            : "pdfsig n’a pas pu analyser ce PDF.",
        );
      }
    }
    return classifyPdfSigOutput(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
