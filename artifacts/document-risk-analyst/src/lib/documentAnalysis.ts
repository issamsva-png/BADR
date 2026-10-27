import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker } from "tesseract.js";
import { classifyDocument } from "./documentAnalysisRules";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ProgressUpdate = (message: string) => void;

export type ProcessedDocument = {
  category: string;
  extractedText: string;
  extractedFields: Record<string, unknown>;
  controlStatus: Record<string, unknown>;
  pageCount: number;
};

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_OCR_PAGES = 40;
const MAX_CANVAS_PIXELS = 12_000_000;
type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

function addCandidate(
  fields: Record<string, unknown>,
  key: string,
  value: string | undefined,
) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (normalized && !fields[key]) fields[key] = normalized;
}

function findLabeledValue(
  lines: string[],
  label: RegExp,
  valuePattern: RegExp,
): string | undefined {
  for (const line of lines) {
    const labelMatch = label.exec(line);
    if (!labelMatch) continue;
    const remainder = line.slice(labelMatch.index + labelMatch[0].length);
    const match = valuePattern.exec(remainder);
    if (match?.[0]) return match[0].trim();
  }
  return undefined;
}

export function extractCandidateFields(text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  addCandidate(
    fields,
    "iban",
    text.match(/\b[A-Z]{2}\s?\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/i)?.[0],
  );
  addCandidate(
    fields,
    "siret",
    text.match(/\b\d{3}(?:[ .]?\d{3}){2}[ .]?\d{5}\b/)?.[0],
  );
  addCandidate(
    fields,
    "siren",
    findLabeledValue(
      lines,
      /\bSIREN\b/i,
      /\b\d(?:[\s.]?\d){8}\b/,
    ),
  );
  addCandidate(
    fields,
    "issueDate",
    findLabeledValue(
      lines,
      /\b(?:date\s+(?:d['’]?émission|de\s+délivrance)|délivré[e]?\s+le)\b/i,
      /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/,
    ),
  );
  addCandidate(
    fields,
    "expiryDate",
    findLabeledValue(
      lines,
      /\b(?:date\s+(?:d['’]?expiration|de\s+validité)|valable\s+jusqu['’]?au|expire\s+le)\b/i,
      /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/,
    ),
  );
  addCandidate(
    fields,
    "amount",
    findLabeledValue(
      lines,
      /\b(?:montant(?:\s+(?:demandé|total|de\s+la\s+subvention))?|somme\s+totale)\b/i,
      /(?:\d[\d\s.,]*\s?(?:€|EUR))/i,
    ),
  );
  addCandidate(
    fields,
    "beneficiary",
    findLabeledValue(
      lines,
      /\b(?:bénéficiaire|demandeur|raison\s+sociale|nom\s+du\s+titulaire)\b/i,
      /[A-ZÀ-ÖØ-Þ][\p{L}'’.-]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}'’.-]+){0,5}/u,
    ),
  );

  const mrzLines = lines.filter((line) => /^[A-Z0-9<]{25,44}$/i.test(line));
  if (mrzLines.length > 0) {
    fields.mrzLines = mrzLines;
    const passportLine = mrzLines.find((line) => line.length === 44);
    if (passportLine) {
      fields.mrzCheckData = passportLine.slice(0, 9);
      fields.mrzCheckDigit = passportLine[9];
    }
  }

  return fields;
}

async function runOcr(
  image: HTMLCanvasElement | File,
  onProgress: ProgressUpdate,
  pageDescription: string,
  worker: OcrWorker,
): Promise<{ text: string; confidence: number }> {
  const result = await worker.recognize(image, {}, {}, `${pageDescription}`);
  onProgress(`${pageDescription} — OCR terminé`);
  return { text: result.data.text.trim(), confidence: result.data.confidence };
}

async function processDocument(
  file: File,
  onProgress: ProgressUpdate,
  getWorker: () => Promise<OcrWorker>,
): Promise<ProcessedDocument> {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
    onProgress(`Reconnaissance OCR locale de ${file.name}…`);
    const worker = await getWorker();
    const result = await runOcr(file, onProgress, file.name, worker);
    const extractedFields = extractCandidateFields(result.text);
    const profile = classifyDocument(result.text, file.name);
    return {
      category: profile.category,
      extractedText: result.text,
      extractedFields,
      pageCount: 1,
      controlStatus: {
        "OCR / extraction du texte": result.text ? "performed" : "impossible",
        "Détection de type": "performed",
        ocr: {
          method: "Tesseract.js — français + anglais (local)",
          confidence: Math.round(result.confidence),
          pages: 1,
          completedAt: new Date().toISOString(),
        },
        autoAnalysis: {
          method: "Classification locale par règles lexicales",
          documentType: profile.category,
          typeConfidence: profile.confidence,
          riskScenario: profile.riskScenario,
          conclusion: "Aucun verdict automatique",
        },
      },
    };
  }

  if (file.type !== "application/pdf") {
    throw new Error(`Format non pris en charge pour l’analyse : ${file.name}`);
  }

  onProgress(`Lecture du PDF ${file.name}…`);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  const confidenceValues: number[] = [];
  let usedOcr = false;

  try {
    if (pdf.numPages > MAX_OCR_PAGES) {
      throw new Error(
        `${file.name} contient ${pdf.numPages} pages. La limite d’analyse actuelle est de ${MAX_OCR_PAGES} pages par PDF.`,
      );
    }

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress(`Lecture de la page ${pageNumber}/${pdf.numPages} de ${file.name}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const textItems = content.items
        .filter((item): item is typeof item & { str: string; transform: number[] } =>
          "str" in item && Array.isArray(item.transform),
        )
        .map((item) => ({ text: item.str, y: item.transform[5] ?? 0 }))
        .sort((left, right) => right.y - left.y);
      const lines: Array<{ y: number; text: string }> = [];
      for (const item of textItems) {
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.y - item.y) < 3) line.text = `${line.text} ${item.text}`;
        else lines.push({ y: item.y, text: item.text });
      }
      const embeddedText = lines
        .sort((left, right) => right.y - left.y)
        .map((line) => line.text.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");

      if (embeddedText.replace(/\s/g, "").length >= 24) {
        pageTexts.push(`[Page ${pageNumber} — texte PDF]\n${embeddedText}`);
        continue;
      }

      usedOcr = true;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2,
        Math.sqrt(MAX_CANVAS_PIXELS / (baseViewport.width * baseViewport.height)),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error(`Impossible de préparer la page ${pageNumber} de ${file.name} pour l’OCR.`);
      }
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await runOcr(
        canvas,
        onProgress,
        `${file.name}, page ${pageNumber}/${pdf.numPages}`,
        await getWorker(),
      );
      pageTexts.push(`[Page ${pageNumber} — OCR]\n${result.text}`);
      confidenceValues.push(result.confidence);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  const extractedText = pageTexts.join("\n\n").trim();
  const extractedFields = extractCandidateFields(extractedText);
  const profile = classifyDocument(extractedText, file.name);
  const averageConfidence = confidenceValues.length
    ? Math.round(
        confidenceValues.reduce((total, confidence) => total + confidence, 0) /
          confidenceValues.length,
      )
    : null;

  return {
    category: profile.category,
    extractedText,
    extractedFields,
    pageCount: pdf.numPages,
    controlStatus: {
      "OCR / extraction du texte": extractedText ? "performed" : "impossible",
      "Détection de type": "performed",
      ocr: {
        method: usedOcr ? "Tesseract.js — français + anglais (local)" : "Extraction texte native PDF",
        confidence: averageConfidence,
        pages: pdf.numPages,
        completedAt: new Date().toISOString(),
      },
      autoAnalysis: {
        method: "Classification locale par règles lexicales",
        documentType: profile.category,
        typeConfidence: profile.confidence,
        riskScenario: profile.riskScenario,
        conclusion: "Aucun verdict automatique",
      },
    },
  };
}

export async function processDocuments(
  files: File[],
  onProgress: ProgressUpdate,
): Promise<ProcessedDocument[]> {
  let workerPromise: Promise<OcrWorker> | undefined;
  const getWorker = () => {
    workerPromise ??= createWorker("fra+eng", 1, {
      logger: (message) => {
        if (message.status === "recognizing text") {
          onProgress(`Reconnaissance OCR : ${Math.round(message.progress * 100)} %`);
        }
      },
    });
    return workerPromise;
  };

  try {
    const results: ProcessedDocument[] = [];
    for (const file of files) {
      results.push(await processDocument(file, onProgress, getWorker));
    }
    return results;
  } finally {
    if (workerPromise) await (await workerPromise).terminate();
  }
}
