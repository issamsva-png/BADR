export type DocumentProfile = {
  category: string;
  confidence: number;
  riskScenario: string;
};

const documentPatterns: Array<{
  category: string;
  terms: RegExp[];
  riskScenario: string;
}> = [
  {
    category: "Pièce d’identité",
    terms: [/carte nationale/, /carte d.identite/, /passport|passeport/, /\bmrz\b/, /date de naissance/],
    riskScenario: "Scénario à examiner : substitution d’identité, modification d’une donnée ou réemploi d’une pièce expirée. Ce scénario est une piste de contrôle, pas un signal observé.",
  },
  {
    category: "Relevé d’identité bancaire",
    terms: [/\brib\b/, /releve d.identite bancaire/, /\biban\b/, /\bbic\b/],
    riskScenario: "Scénario à examiner : substitution des coordonnées bancaires ou modification du titulaire. Un IBAN valide ne prouve ni le titulaire ni l’authenticité de la pièce.",
  },
  {
    category: "Relevé bancaire",
    terms: [/releve de compte/, /releve bancaire/, /\bsolde\b/, /\boperations\b/],
    riskScenario: "Scénario à examiner : altération d’un solde, d’une opération ou d’une période. Les valeurs extraites ne sont pas vérifiées auprès de la banque.",
  },
  {
    category: "Facture",
    terms: [/\bfacture\b/, /montant ht/, /montant ttc/, /numero de facture/],
    riskScenario: "Scénario à examiner : modification du montant, du bénéficiaire ou de la date, ou facture non émise par le fournisseur indiqué. Aucune authenticité n’est présumée.",
  },
  {
    category: "Devis",
    terms: [/\bdevis\b/, /offre commerciale/, /bon pour accord/],
    riskScenario: "Scénario à examiner : modification d’un montant, d’un fournisseur ou d’une durée de validité. Une différence peut aussi provenir d’une version révisée.",
  },
  {
    category: "Contrat",
    terms: [/\bcontrat\b/, /\bparties\b/, /signe par/, /date d.effet/],
    riskScenario: "Scénario à examiner : modification des parties, de la date d’effet ou des clauses, ou présentation d’une version non signée. Le texte extrait ne vérifie pas les signatures.",
  },
  {
    category: "Justificatif de domicile",
    terms: [/justificatif de domicile/, /facture d.electricite/, /facture de gaz/, /facture d.eau/],
    riskScenario: "Scénario à examiner : modification de l’identité, de l’adresse ou de la date, ou document hors période requise. Ces critères dépendent de la procédure applicable.",
  },
  {
    category: "Document d’immatriculation d’entreprise",
    terms: [/\bkbis\b/, /extrait d.immatriculation/, /\brcs\b/, /\bsiret\b/, /\bsiren\b/],
    riskScenario: "Scénario à examiner : modification d’une identité d’entreprise ou présentation d’informations périmées. Le registre officiel n’est pas interrogé automatiquement.",
  },
  {
    category: "Demande de subvention",
    terms: [/\bsubvention\b/, /demande d.aide/, /dossier de financement/, /montant demande/],
    riskScenario: "Scénario à examiner dans le dossier lié : altération d’une donnée ou pièce justificative, ou incohérence entre les cinq pièces. Une différence n’établit pas une fraude.",
  },
];

export function classifyDocument(text: string, fileName: string): DocumentProfile {
  const content = `${fileName}\n${text}`
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr");
  const ranked = documentPatterns
    .map((pattern) => ({
      ...pattern,
      score: pattern.terms.reduce(
        (score, term) => score + (term.test(content) ? 1 : 0),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score === 0) {
    return {
      category: "Document non identifié",
      confidence: 0,
      riskScenario: "Scénario à examiner : altération, substitution ou présentation d’une pièce non pertinente. Identifier d’abord le type de document et les critères de la procédure ; aucune anomalie n’est présumée.",
    };
  }

  return {
    category: best.category,
    confidence: Math.min(95, 45 + best.score * 12),
    riskScenario: best.riskScenario,
  };
}

export function suggestedReview(profile: DocumentProfile) {
  const verificationByType: Record<string, string> = {
    "Pièce d’identité": "Comparer les champs transcrits à l’original et appliquer la procédure autorisée de contrôle d’identité ; une MRZ cohérente n’authentifie pas le document.",
    "Relevé d’identité bancaire": "Comparer le titulaire sur l’original et confirmer le compte par un canal sûr déjà connu ; une clé IBAN valide ne confirme pas le titulaire.",
    "Relevé bancaire": "Contrôler la période et les lignes citées sur l’original, puis confirmer auprès de la banque par un canal de contact indépendant.",
    Facture: "Vérifier le montant, la date et l’émetteur sur l’original, puis confirmer auprès du fournisseur via des coordonnées déjà connues.",
    Devis: "Confirmer la version, le montant et la validité auprès du fournisseur via des coordonnées déjà connues.",
    Contrat: "Comparer la version et les signataires à l’original ; confirmer les signatures auprès des parties par un canal indépendant.",
    "Justificatif de domicile": "Comparer le nom, l’adresse et la date à l’original et appliquer les critères de validité de la procédure.",
    "Document d’immatriculation d’entreprise": "Vérifier l’état actuel de l’entreprise dans le registre officiel applicable ; aucune consultation de registre n’a été faite par Finovox.",
    "Demande de subvention": "Comparer les faits et montants dans les cinq pièces liées, puis confirmer les écarts sur les originaux ou auprès des émetteurs.",
  };
  const verification = verificationByType[profile.category] ??
    "Identifier le document, vérifier les champs extraits sur l’original et confirmer auprès de l’émetteur avec un canal de contact indépendant.";
  return {
    alternative: "Une différence peut résulter d’une erreur OCR, d’une correction, d’une version révisée ou d’une mise en page différente ; vérifier l’original avant de conclure.",
    verification,
    action: "Demander un original ou une copie lisible si nécessaire, documenter le contrôle réellement effectué et transmettre pour revue humaine avant toute décision défavorable.",
  };
}
