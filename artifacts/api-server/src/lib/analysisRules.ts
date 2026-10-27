export const ALLOWED_CONCLUSIONS = [
  "Conforme",
  "Douteux",
  "Fraude probable",
  "Informations complémentaires nécessaires",
] as const;

export type AnalysisMode = "subsidy" | "independent_batch";
export type Conclusion = (typeof ALLOWED_CONCLUSIONS)[number];

export function expectedDocumentCount(mode: AnalysisMode): number {
  return mode === "subsidy" ? 5 : 9;
}

export function canAttachDocument(mode: AnalysisMode, currentCount: number): boolean {
  return currentCount < expectedDocumentCount(mode);
}

export function canCompleteAnalysis(
  mode: AnalysisMode,
  currentCount: number,
  conclusion: string | null | undefined,
  rationale: string | null | undefined,
): boolean {
  return (
    currentCount === expectedDocumentCount(mode) &&
    ALLOWED_CONCLUSIONS.includes(conclusion as Conclusion) &&
    Boolean(rationale?.trim())
  );
}

export function mayCrossCompare(mode: AnalysisMode): boolean {
  return mode === "subsidy";
}

export function isSupportedUpload(
  fileName: string,
  mimeType: string,
  size: number,
): boolean {
  if (size <= 0 || size > 20 * 1024 * 1024) return false;
  const extension = fileName.toLowerCase().split(".").pop();
  const extensionType =
    extension === "pdf"
      ? "application/pdf"
      : extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "png"
          ? "image/png"
          : null;
  return extensionType !== null && extensionType === mimeType;
}

export function matchesFileSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "application/pdf") {
    return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return false;
}

function comparableValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function findSubsidyFieldDifferences(
  mode: AnalysisMode,
  documents: Array<{ label: string; fields: Record<string, unknown> }>,
): Array<{ field: string; values: Array<{ document: string; value: string }> }> {
  if (!mayCrossCompare(mode)) return [];
  const fieldNames = new Set(documents.flatMap((document) => Object.keys(document.fields)));
  const differences: Array<{
    field: string;
    values: Array<{ document: string; value: string }>;
  }> = [];
  for (const field of fieldNames) {
    const values = documents.flatMap((document) => {
      const raw = document.fields[field];
      if (typeof raw !== "string" || !raw.trim()) return [];
      return [{ document: document.label, value: raw.trim() }];
    });
    const normalized = new Set(values.map(({ value }) => comparableValue(value)));
    if (values.length > 1 && normalized.size > 1) {
      differences.push({ field, values });
    }
  }
  return differences;
}

export function verifyIbanChecksum(value: string): boolean {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = character >= "A" && character <= "Z"
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export function verifySiretLuhn(value: string): boolean {
  const digits = value.replace(/[ .]/g, "");
  if (!/^\d{14}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[index]);
    if ((digits.length - index) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function verifyMrzCheckDigit(data: string, checkDigit: string): boolean {
  if (!/^\d$/.test(checkDigit) || !/^[A-Z0-9<]+$/.test(data)) return false;
  const weights = [7, 3, 1];
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const character = data[index];
    const value =
      character === "<"
        ? 0
        : character >= "0" && character <= "9"
          ? Number(character)
          : character.charCodeAt(0) - 55;
    sum += value * weights[index % weights.length];
  }
  return sum % 10 === Number(checkDigit);
}

function parseDocumentDate(value: string): Date | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const european = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(trimmed);
  const year = iso ? Number(iso[1]) : european ? Number(european[3]) : NaN;
  const month = iso ? Number(iso[2]) : european ? Number(european[2]) : NaN;
  const day = iso ? Number(iso[3]) : european ? Number(european[1]) : NaN;
  if (![year, month, day].every(Number.isFinite)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function checkDocumentDateOrder(
  issueDate: string,
  expiryDate: string,
): "ordered" | "reversed" | "unreadable" {
  const issued = parseDocumentDate(issueDate);
  const expires = parseDocumentDate(expiryDate);
  if (!issued || !expires) return "unreadable";
  return issued <= expires ? "ordered" : "reversed";
}
