const REGISTRY_API = "https://recherche-entreprises.api.gouv.fr/search";
const REGISTRY_SOURCE = "https://annuaire-entreprises.data.gouv.fr";
const requestCache = new Map<string, { expiresAt: number; value: FrenchRegistryResult }>();
let lastRequestAt = 0;

export type FrenchRegistryResult = {
  status: "found_active" | "found_closed" | "found_status_unknown" | "not_found" | "not_applicable" | "unavailable";
  identifier: string | null;
  identifierType: "SIREN" | "SIRET" | null;
  name: string | null;
  establishmentAddress: string | null;
  source: string;
  checkedAt: string;
  message: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedIdentifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return /^\d{9}$|^\d{14}$/.test(digits) ? digits : null;
}

function resultEntryMatches(
  entry: Record<string, unknown>,
  identifier: string,
): { establishment: Record<string, unknown> | null } | null {
  if (identifier.length === 9 && entry.siren === identifier) {
    return { establishment: null };
  }
  const establishments = [
    record(entry.siege),
    ...(Array.isArray(entry.matching_etablissements)
      ? entry.matching_etablissements.map(record)
      : []),
  ].filter((item): item is Record<string, unknown> => item !== null);
  const establishment = establishments.find((item) => item.siret === identifier);
  return establishment ? { establishment } : null;
}

function unavailable(identifier: string, identifierType: "SIREN" | "SIRET", message: string): FrenchRegistryResult {
  return {
    status: "unavailable",
    identifier,
    identifierType,
    name: null,
    establishmentAddress: null,
    source: REGISTRY_SOURCE,
    checkedAt: new Date().toISOString(),
    message,
  };
}

export function getRegistryCandidate(fields: Record<string, unknown>): string | null {
  return normalizedIdentifier(fields.siret) ?? normalizedIdentifier(fields.siren);
}

export async function lookupFrenchRegistry(
  candidate: string | null,
): Promise<FrenchRegistryResult> {
  const identifier = normalizedIdentifier(candidate);
  const checkedAt = new Date().toISOString();
  if (!identifier) {
    return {
      status: "not_applicable",
      identifier: null,
      identifierType: null,
      name: null,
      establishmentAddress: null,
      source: REGISTRY_SOURCE,
      checkedAt,
      message: "Aucun SIREN/SIRET exploitable n’a été extrait ; aucune requête n’a été envoyée.",
    };
  }
  const identifierType = identifier.length === 9 ? "SIREN" : "SIRET";
  const cached = requestCache.get(identifier);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const waitMs = Math.max(0, lastRequestAt + 160 - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
  const url = new URL(REGISTRY_API);
  url.searchParams.set("q", identifier);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Finovox document review" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      const result = unavailable(
        identifier,
        identifierType,
        response.status === 429
          ? "L’API officielle limite actuellement les requêtes. Réessayez plus tard."
          : `L’API officielle a répondu avec le statut HTTP ${response.status}.`,
      );
      requestCache.set(identifier, { expiresAt: Date.now() + 30_000, value: result });
      return result;
    }
    const payload: unknown = await response.json();
    const body = record(payload);
    const entries = body && Array.isArray(body.results) ? body.results : [];
    const match = entries
      .map(record)
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => ({ entry, matched: resultEntryMatches(entry, identifier) }))
      .find((item) => item.matched !== null);

    let result: FrenchRegistryResult;
    if (!match?.matched) {
      result = {
        status: "not_found",
        identifier,
        identifierType,
        name: null,
        establishmentAddress: null,
        source: REGISTRY_SOURCE,
        checkedAt: new Date().toISOString(),
        message: "Aucun résultat public exact pour cet identifiant. Certaines entités peuvent ne pas être diffusibles par l’API.",
      };
    } else {
      const establishment = match.matched.establishment;
      const administrativeStatus = establishment
        ? establishment.etat_administratif
        : match.entry.etat_administratif;
      const status = administrativeStatus === "A"
        ? "found_active"
        : administrativeStatus === "C" || administrativeStatus === "F"
          ? "found_closed"
          : "found_status_unknown";
      result = {
        status,
        identifier,
        identifierType,
        name: readString(match.entry.nom_complet) ?? readString(match.entry.nom_raison_sociale),
        establishmentAddress: establishment ? readString(establishment.adresse) : null,
        source: REGISTRY_SOURCE,
        checkedAt: new Date().toISOString(),
        message: status === "found_active"
          ? "Identifiant trouvé dans les données publiques françaises ; statut administratif actif à la date de consultation."
          : status === "found_closed"
            ? "Identifiant trouvé dans les données publiques françaises ; statut administratif cessé ou fermé à la date de consultation."
            : "Identifiant trouvé dans les données publiques françaises ; l’API ne fournit pas de statut administratif exploitable.",
      };
    }
    requestCache.set(identifier, { expiresAt: Date.now() + 5 * 60_000, value: result });
    return result;
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError"
      ? "Délai dépassé lors de la consultation du registre officiel."
      : "Le registre officiel est temporairement inaccessible.";
    return unavailable(identifier, identifierType, detail);
  }
}
