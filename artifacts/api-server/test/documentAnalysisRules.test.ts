import { describe, expect, it } from "vitest";
import {
  classifyDocument,
  suggestedReview,
} from "../../document-risk-analyst/src/lib/documentAnalysisRules";

describe("local document classification", () => {
  it("recognizes common evidence types without treating classification as a fraud finding", () => {
    expect(classifyDocument("Facture numéro F-2026, montant TTC 120 EUR", "piece.pdf").category)
      .toBe("Facture");
    expect(classifyDocument("Relevé d’identité bancaire IBAN FR76", "rib.pdf").category)
      .toBe("Relevé d’identité bancaire");
    expect(classifyDocument("Contrat signé par les deux parties", "contrat.pdf").category)
      .toBe("Contrat");
    expect(classifyDocument("Texte générique sans indice de type", "document.pdf").category)
      .toBe("Document non identifié");
    expect(classifyDocument("Facture", "piece.pdf").riskScenario)
      .toContain("Aucune authenticité n’est présumée");
  });

  it("supplies type-specific next checks while preserving human review", () => {
    const suggestion = suggestedReview(
      classifyDocument("Extrait Kbis SIRET 73282932000074", "kbis.pdf"),
    );
    expect(suggestion.verification).toContain("registre officiel");
    expect(suggestion.action).toContain("revue humaine");
  });
});
