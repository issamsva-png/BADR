import { describe, expect, it } from "vitest";
import {
  ALLOWED_CONCLUSIONS,
  canAttachDocument,
  canCompleteAnalysis,
  checkDocumentDateOrder,
  expectedDocumentCount,
  findSubsidyFieldDifferences,
  isSupportedUpload,
  verifyIbanChecksum,
  verifyMrzCheckDigit,
  verifySiretLuhn,
} from "./analysisRules";

describe("analysis mode boundaries", () => {
  it("requires exactly five subsidy documents and one dossier-level row", () => {
    expect(expectedDocumentCount("subsidy")).toBe(5);
    expect(canAttachDocument("subsidy", 4)).toBe(true);
    expect(canAttachDocument("subsidy", 5)).toBe(false);
    expect(
      canCompleteAnalysis("subsidy", 5, "Informations complémentaires nécessaires", "Demander la page manquante."),
    ).toBe(true);
  });

  it("requires exactly nine independent documents and rejects incomplete completion", () => {
    expect(expectedDocumentCount("independent_batch")).toBe(9);
    expect(canAttachDocument("independent_batch", 8)).toBe(true);
    expect(canAttachDocument("independent_batch", 9)).toBe(false);
    expect(canCompleteAnalysis("independent_batch", 8, "Conforme", "Contrôle terminé.")).toBe(false);
  });

  it("does not compare independent documents with one another", () => {
    expect(
      findSubsidyFieldDifferences("independent_batch", [
        { label: "Document 1", fields: { name: "Alice" } },
        { label: "Document 2", fields: { name: "Bob" } },
      ]),
    ).toEqual([]);
  });

  it("normalizes accents and punctuation while preserving actual subsidy differences", () => {
    expect(
      findSubsidyFieldDifferences("subsidy", [
        { label: "Pièce 1", fields: { name: "Élodie Martin" } },
        { label: "Pièce 2", fields: { name: "Elodie-Martin" } },
        { label: "Pièce 3", fields: { name: "Élodie Martin" } },
      ]),
    ).toEqual([]);
    expect(
      findSubsidyFieldDifferences("subsidy", [
        { label: "Pièce 1", fields: { name: "Élodie Martin" } },
        { label: "Pièce 2", fields: { name: "Élodie Marin" } },
      ]),
    ).toEqual([
      {
        field: "name",
        values: [
          { document: "Pièce 1", value: "Élodie Martin" },
          { document: "Pièce 2", value: "Élodie Marin" },
        ],
      },
    ]);
  });
});

describe("document checks", () => {
  it("accepts supported formats and rejects mismatched or oversized uploads", () => {
    expect(isSupportedUpload("piece.pdf", "application/pdf", 100)).toBe(true);
    expect(isSupportedUpload("piece.jpg", "image/jpeg", 100)).toBe(true);
    expect(isSupportedUpload("piece.png", "image/png", 100)).toBe(true);
    expect(isSupportedUpload("piece.pdf", "image/jpeg", 100)).toBe(false);
    expect(isSupportedUpload("piece.exe", "application/pdf", 100)).toBe(false);
    expect(isSupportedUpload("piece.pdf", "application/pdf", 20 * 1024 * 1024 + 1)).toBe(false);
  });

  it("checks IBAN checksums without treating validity as proof of ownership", () => {
    expect(verifyIbanChecksum("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(verifyIbanChecksum("FR00 3000 6000 0112 3456 7890 189")).toBe(false);
  });

  it("checks SIRET's structural checksum", () => {
    expect(verifySiretLuhn("732 829 320 00074")).toBe(true);
    expect(verifySiretLuhn("732.829.320.00074")).toBe(true);
    expect(verifySiretLuhn("73282932000075")).toBe(false);
  });

  it("checks an MRZ check digit", () => {
    expect(verifyMrzCheckDigit("L898902C3", "6")).toBe(true);
    expect(verifyMrzCheckDigit("L898902C3", "5")).toBe(false);
  });

  it("detects reversed, ordered, and unreadable date pairs", () => {
    expect(checkDocumentDateOrder("01/12/2025", "2026-01-01")).toBe("ordered");
    expect(checkDocumentDateOrder("2026-01-02", "01/12/2025")).toBe("reversed");
    expect(checkDocumentDateOrder("date absente", "2026-01-01")).toBe("unreadable");
  });

  it("accepts only the four prescribed conclusion labels", () => {
    expect(ALLOWED_CONCLUSIONS).toEqual([
      "Conforme",
      "Douteux",
      "Fraude probable",
      "Informations complémentaires nécessaires",
    ]);
    expect(canCompleteAnalysis("subsidy", 5, "Fraude probable", "")).toBe(false);
  });
});
