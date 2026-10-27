import { describe, expect, it } from "vitest";
import { classifyPdfSigOutput } from "./pdfSignature";

describe("PDF signature output classification", () => {
  it("does not mistake an unsigned PDF for a verified signature", () => {
    const result = classifyPdfSigOutput("File 'document.pdf' does not contain any signatures");

    expect(result.status).toBe("unsigned");
    expect(result.signaturesFound).toBe(0);
  });

  it("requires both valid signed bytes and a trusted certificate for a valid result", () => {
    const result = classifyPdfSigOutput([
      "Signature #1:",
      "Signer Certificate Common Name: Test Signer",
      "Signing Time: 2026-10-24T12:00:00Z",
      "Signature Validation: Signature is Valid.",
      "Certificate Validation: Certificate is Trusted.",
    ].join("\n"));

    expect(result.status).toBe("valid");
    expect(result.signer).toBe("Test Signer");
    expect(result.certificateStatus).toBe("trusted");
  });

  it("keeps a cryptographically valid but untrusted certificate distinct", () => {
    const result = classifyPdfSigOutput([
      "Signature #1:",
      "Signature Validation: Signature is Valid.",
      "Certificate Validation: Certificate issuer is unknown.",
    ].join("\n"));

    expect(result.status).toBe("untrusted");
    expect(result.certificateStatus).toBe("unknown");
  });

  it("does not declare a prior revision valid for the current PDF", () => {
    const result = classifyPdfSigOutput([
      "Signature #1:",
      "Signature Validation: Signature is Valid.",
      "Certificate Validation: Certificate is Trusted.",
      "Not total document signed",
    ].join("\n"));

    expect(result.status).toBe("untrusted");
    expect(result.message).toContain("pas tout le PDF actuel");
  });

  it("flags invalid and revoked signatures", () => {
    expect(classifyPdfSigOutput([
      "Signature #1:",
      "Signature Validation: Signature is Invalid.",
    ].join("\n")).status).toBe("invalid");
    expect(classifyPdfSigOutput([
      "Signature #1:",
      "Signature Validation: Signature is Valid.",
      "Certificate Validation: Certificate has been revoked.",
    ].join("\n")).certificateStatus).toBe("revoked");
  });
});
