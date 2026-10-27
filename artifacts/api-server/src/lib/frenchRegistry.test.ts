import { afterEach, describe, expect, it, vi } from "vitest";
import { getRegistryCandidate, lookupFrenchRegistry } from "./frenchRegistry";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("French registry lookup", () => {
  it("accepts only candidate SIREN and SIRET identifiers", () => {
    expect(getRegistryCandidate({ siret: "123 456 789 00012" })).toBe("12345678900012");
    expect(getRegistryCandidate({ siren: "123456789" })).toBe("123456789");
    expect(getRegistryCandidate({ siret: "not an identifier" })).toBeNull();
  });

  it("does not send a request when no usable identifier was extracted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupFrenchRegistry(null);

    expect(result.status).toBe("not_applicable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queries the public API using only the exact extracted identifier", async () => {
    const fetchMock = vi.fn(async (input: URL) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://recherche-entreprises.api.gouv.fr");
      expect(url.searchParams.get("q")).toBe("12345678900012");
      expect([...url.searchParams.keys()]).toEqual(["q"]);
      return new Response(JSON.stringify({
        results: [{
          siren: "123456789",
          nom_complet: "Entreprise de test",
          etat_administratif: "A",
          matching_etablissements: [{
            siret: "12345678900012",
            etat_administratif: "A",
            adresse: "Adresse de test",
          }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupFrenchRegistry("12345678900012");

    expect(result.status).toBe("found_active");
    expect(result.name).toBe("Entreprise de test");
    expect(result.establishmentAddress).toBe("Adresse de test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an explicit unavailable status when the official service fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    const result = await lookupFrenchRegistry("987654321");

    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("503");
  });

  it("does not infer an administrative status absent from the official response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [{ siren: "192837465", nom_complet: "Entreprise sans statut" }],
    }), { status: 200 })));

    const result = await lookupFrenchRegistry("192837465");

    expect(result.status).toBe("found_status_unknown");
  });
});
