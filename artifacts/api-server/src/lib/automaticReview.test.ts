import { describe, expect, it } from "vitest";
import {
  getQuotedPage,
  validateModelReview,
  type ReviewDocumentInput,
} from "./automaticReview";

const documents: ReviewDocumentInput[] = [{
  id: "document-1",
  fileName: "facture.pdf",
  category: "Facture",
  pageCount: 2,
  extractedText: "[Page 1 — texte PDF]\nFacture numéro F-2026\nMontant TTC : 120 EUR\n[Page 2 — texte PDF]\nConditions de règlement",
  extractedFields: { amount: "120 EUR" },
}];

function reviewWith(excerpts: string[]) {
  return JSON.stringify({
    riskScenario: "Modification possible du montant ou de l’émetteur.",
    conclusionSuggestion: "Informations complémentaires nécessaires",
    rationale: "Les citations doivent être vérifiées sur la pièce originale.",
    findings: excerpts.map((excerpt) => ({
      documentId: "document-1",
      classification: "FACT",
      field: null,
      value: null,
      excerpt,
      explanation: "Texte directement relevé.",
    })),
    alternativeExplanation: "Une correction de facture est possible.",
    additionalVerification: "Confirmer auprès de l’émetteur.",
    operationalAction: "Faire examiner la pièce avant décision.",
  });
}

describe("local AI review validation", () => {
  it("derives the page from verified quoted text", () => {
    expect(getQuotedPage(documents[0]!.extractedText!, "Montant TTC : 120 EUR")).toBe(1);
    expect(getQuotedPage(documents[0]!.extractedText!, "Conditions de règlement")).toBe(2);
    expect(getQuotedPage(documents[0]!.extractedText!, "Not in the document")).toBeNull();
  });

  it("accepts two distinct citations present in the source text", () => {
    const result = validateModelReview(
      reviewWith(["Facture numéro F-2026", "Montant TTC : 120 EUR"]),
      documents,
    );
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((finding) => finding.page)).toEqual([1, 1]);
  });

  it("rejects invented citations rather than storing them as facts", () => {
    expect(() => validateModelReview(
      reviewWith(["Facture numéro F-2026", "Montant TTC : 999 EUR"]),
      documents,
    )).toThrow(/could not be found/);
  });
});
