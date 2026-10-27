# Runbook — Finovox

## État et limites du mode local

Le projet utilise Node.js, React/Vite, Express, Drizzle ORM et MySQL/MariaDB. Le mode démo local remplace Clerk par une identité de développement fixe et le stockage objet distant par des fichiers sur le PC. Il n’accepte que des connexions API en boucle locale et refuse le mode `NODE_ENV=production`.

**Ce mode n’est pas une authentification** : ne l’exposez pas sur le réseau et n’y chargez aucun document réel ou sensible. La lecture de PDF et l’OCR français/anglais s’exécutent dans le navigateur ; les modèles OCR sont téléchargés depuis un CDN. L’OCR produit des candidats à vérifier, pas une preuve d’authenticité. La classification lexicale, l’extraction de champs et les contrôles de format, clés et dates sont automatiques. L’analyse IA facultative utilise Ollama sur la même machine ; aucun document n’est envoyé à une IA distante.

Le mode démo local ne requiert aucun bucket. Pour un déploiement non local, le stockage objet utilise Google Cloud Storage avec les identifiants Application Default Credentials, ainsi que `PRIVATE_OBJECT_DIR` et `PUBLIC_OBJECT_SEARCH_PATHS` dans `.env`. Configurez un compte de service avec les droits bucket nécessaires et la signature des URL, sans enregistrer de clé de compte de service dans le dépôt.

## Fonctionnement de la revue

- Les PDF avec texte sélectionnable sont lus directement. Les pages scannées et images passent par OCR dans le navigateur. La limite actuelle est de 40 pages par PDF et de 12 millions de pixels par rendu.
- Une classification locale par règles lexicales propose le type du document et un scénario de risque correspondant. L’indice lexical affiché n’est pas une probabilité et ne permet pas de conclure à une fraude.
- Finovox relève des candidats tels que l’IBAN, le SIRET, certaines dates, montants, bénéficiaires et lignes MRZ. Les contrôles de format ou de clé détectent des incohérences de transcription possibles ; ils ne prouvent ni fraude ni authenticité.
- La vérification locale du fichier confirme que son contenu correspond au type PDF/JPEG/PNG déclaré. Elle ne valide pas une signature électronique, un certificat ni l’état actuel d’une entreprise dans un registre.
- L’IA locale Ollama peut proposer une conclusion, des faits, des signaux, une alternative, une vérification et une action. L’API refuse ses citations si elles ne figurent pas dans le texte OCR/transcrit et dérive elle-même la page. Après l’analyse IA, Finovox enregistre automatiquement la conclusion et ses éléments justificatifs ; l’analyste peut les corriger, sans validation manuelle obligatoire. Une sortie IA reste une analyse automatisée, pas une preuve de fraude ni une vérification cryptographique.
- En mode subvention, le modèle reçoit uniquement les cinq pièces de ce dossier. En mode indépendant, il reçoit une seule pièce par appel, sans contexte des autres documents.
- À l’ajout d’une pièce, un SIREN/SIRET extrait est recherché automatiquement par l’API publique française Recherche d’Entreprises. Seul l’identifiant est envoyé ; ni le document ni le texte OCR ne sont transmis à cette API. Un résultat absent ou une panne réseau reste visible comme tel. L’API ne publie pas toutes les entités (notamment certaines entités non diffusibles) ; un résultat exact ne prouve pas l’authenticité du document ni le titulaire d’un IBAN.
- Pour les PDF, Finovox appelle localement l’outil Poppler `pdfsig` à l’ajout, puis permet de relancer le contrôle après installation de l’outil. L’intégrité cryptographique et la confiance du certificat sont séparées : une signature sans chaîne de confiance confirmée n’est pas affichée comme valide. Aucune donnée du PDF n’est envoyée à un vérificateur externe. Les images ne portent pas de signature cryptographique PDF.
- Pour un dossier de subvention, le rapprochement porte uniquement sur les cinq pièces de ce dossier et la conclusion est globale.
- Pour un lot indépendant, les neuf documents restent séparés : chaque document reçoit sa propre conclusion, justification, alternative, vérification et action. L’API refuse une conclusion globale pour ce mode.
- Les exports Excel et CSV reprennent une ligne par dossier de subvention ou une ligne par document indépendant, avec les observations et les candidats relevés.
- Les alternatives, vérifications et actions produites automatiquement sont enregistrées dans le rapport et restent modifiables. Les documents indépendants sont analysés et enregistrés séparément, sans rapprochement croisé.

## Prérequis

- Windows 10/11, Node.js 20.6 ou ultérieur et npm (inclus avec Node.js)
- XAMPP avec MySQL/MariaDB installé et démarré sur le port `3306`
- Une connexion Internet pour installer les dépendances et charger les modèles OCR dans le navigateur

## Installation

Copiez le dossier du projet sur le nouvel ordinateur, par exemple dans `C:\Finovox`. N’incluez pas `node_modules`, `.env` ni les fichiers `local-storage` de l’ancien ordinateur. Ouvrez PowerShell à cet emplacement :

```powershell
cd C:\Finovox
npm ci
Copy-Item .env.example .env
```

`package-lock.json` verrouille les versions : utilisez `npm ci` dans une copie propre du projet (ne copiez pas `node_modules` depuis l’ancien ordinateur). Ouvrez le panneau de contrôle XAMPP et démarrez **MySQL**. Dans phpMyAdmin, créez une fois la base :

Cette procédure installe le code pour une nouvelle machine et démarre avec une base vide. Les dossiers, fichiers téléversés et paramètres privés de l’ancien ordinateur ne sont pas transférés avec le code. Pour les conserver, il faut migrer séparément la base MySQL **et** le dossier `artifacts/api-server/local-storage`, puis configurer le `.env` sur le nouvel ordinateur.

```sql
CREATE DATABASE document_risk_analyst
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Adaptez `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER` et `MYSQL_PASSWORD` dans `.env` aux réglages XAMPP. Par défaut, le fichier exemple vise `127.0.0.1:3306`, l’utilisateur `root` et un mot de passe vide.

Créez ou mettez à jour les tables Drizzle :

```powershell
npm run db:migrate
```

## IA locale gratuite (requise pour les conclusions automatiques)

L’OCR et les contrôles déterministes fonctionnent sans Ollama. **Ollama et le modèle sont nécessaires pour générer et enregistrer une conclusion IA automatiquement.** Installez Ollama pour Windows depuis [ollama.com/download](https://ollama.com/download), puis ouvrez un nouveau terminal PowerShell et téléchargez le modèle configuré :

```powershell
ollama pull qwen2.5:3b
ollama list
```

Laissez Ollama démarré sur `http://127.0.0.1:11434`. Le projet ne télécharge pas le logiciel ni le modèle à votre place. Les valeurs par défaut sont `OLLAMA_BASE_URL=http://127.0.0.1:11434` et `OLLAMA_MODEL=qwen2.5:3b`; elles peuvent être adaptées dans `.env`, en gardant impérativement une adresse locale. La page **Configuration** affiche si Ollama répond et si le modèle attendu est installé. Si Ollama n’est pas disponible, l’OCR et les contrôles déterministes restent utilisables ; le bouton d’analyse IA affiche l’erreur.

Dans la revue, utilisez **Analyser avec l’IA locale**. Après génération, Finovox enregistre la conclusion et les éléments du rapport automatiquement ; l’analyste peut les modifier, sans validation manuelle obligatoire. Vérifiez les extraits cités et les pages sur les originaux. Une conclusion IA est une analyse automatisée, pas une preuve de fraude ni une authentification de la pièce. Les changements de texte extrait ou de champs invalident l’analyse IA enregistrée.

## Vérification des signatures PDF

Le contrôle local s’appuie sur Poppler `pdfsig`. Installez une distribution Windows de Poppler issue d’une source de confiance, puis ajoutez le dossier contenant `pdfsig.exe` au `PATH` ou renseignez son chemin complet dans `PDFSIG_PATH` du fichier `.env` (par exemple `PDFSIG_PATH=C:\Tools\poppler\Library\bin\pdfsig.exe`). Configurez `PDFSIG_NSS_DIR` vers la base de certificats NSS approuvés pour que pdfsig puisse établir la confiance du signataire. Finovox désactive les requêtes OCSP distantes ; la révocation ne peut donc être établie que si une information de révocation locale exploitable est disponible. Sans magasin de confiance configuré ou si un certificat n’y est pas approuvé, Finovox conserve le résultat « confiance non établie ». Redémarrez l’API et vérifiez dans **Configuration** que le vérificateur est prêt. Les PDF ajoutés auparavant peuvent être revérifiés depuis **Contrôles** dans la fiche du document.

Finovox distingue : PDF sans signature intégrée, intégrité cryptographique invalide, intégrité valide mais certificat non fiable/expiré/révoqué, ou signature et confiance validées par le vérificateur configuré. La confiance dépend du magasin de certificats disponible au vérificateur sur cette machine ; si elle ne peut être confirmée, le résultat reste explicitement non fiable/inconnu. Une signature valide ne prouve pas à elle seule le pouvoir du signataire ni la légitimité de la pièce.

## Registre français

La consultation de l’API publique [Recherche d’Entreprises](https://recherche-entreprises.api.gouv.fr/docs/) est automatique lors de l’ajout d’un document avec SIREN/SIRET extrait ; une correction ultérieure des champs relance la consultation. La page **Contrôles** indique l’identifiant, le statut administratif rendu et l’heure de vérification. L’API est publique et demande une connexion Internet ; un résultat nul peut aussi signifier que les données ne sont pas diffusibles. Il s’agit d’une consultation de données publiques, pas d’une authentification de pièce. La consultation n’est effectuée pour aucun identifiant absent ou non exploitable.

Le rapprochement entre les neuf documents indépendants reste désactivé intentionnellement, conformément au cas d’usage. Il ne doit pas être activé pour rendre le statut « complet » : seule l’analyse séparée par document est conforme.

## Démarrage

Après avoir démarré MySQL (et Ollama pour les conclusions IA), ouvrez deux terminaux PowerShell. Dans le premier, appliquez les migrations à la racine du projet, puis démarrez l’API dans ce même terminal :

```powershell
cd C:\Finovox
npm run db:migrate
cd .\artifacts\api-server
npm run dev
```

Dans un second terminal — interface :

```powershell
cd C:\Finovox\artifacts\document-risk-analyst
npm run dev
```

Ouvrez [http://127.0.0.1:3000](http://127.0.0.1:3000). L’API est sur `http://127.0.0.1:5000`; son contrôle de santé vérifie aussi la connexion MySQL. Les fichiers de démonstration sont conservés dans `artifacts/api-server/local-storage`.

Vous pouvez vérifier l’API dans un autre terminal :

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/healthz
```

Une réponse `status: ok` confirme que l’API est démarrée et connectée à MySQL. Le mode fourni est une démonstration locale sans authentification : gardez les services sur `127.0.0.1`, ne l’exposez pas sur le réseau et n’y chargez pas de documents réels/sensibles sans avoir remplacé ce mode par une authentification et un stockage adaptés.

## Validation

```powershell
cd C:\Finovox\artifacts\api-server
npm run typecheck
npm run test
npm run build

cd C:\Finovox\artifacts\document-risk-analyst
npm run typecheck
npm run build
```

## Dépannage

- **XAMPP / MySQL indisponible** : vérifiez que le module MySQL est installé dans XAMPP et démarré, puis testez `127.0.0.1:3306`.
- **`Unknown database document_risk_analyst`** : créez la base dans phpMyAdmin puis relancez `npm run db:migrate`.
- **Erreur de connexion MySQL** : contrôlez les paramètres `MYSQL_*` du fichier `.env`.
- **Erreur de port ou de `BASE_PATH`** : vérifiez `API_PORT=5000`, `VITE_PORT=3000` et `BASE_PATH=/` dans `.env`.
- **Installation npm après l’ancienne installation pnpm** : sur le nouvel ordinateur, copiez uniquement le code et `package-lock.json`, puis utilisez `npm ci`. Ne réutilisez pas un dossier `node_modules` installé par pnpm.
- **Port 3000 ou 5000 déjà utilisé** : arrêtez le service correspondant ou changez `VITE_PORT` / `API_PORT`, et alignez la cible proxy Vite si vous changez le port API.

## Références techniques

- Interface : `artifacts/document-risk-analyst/src/App.tsx`
- API : `artifacts/api-server/src`
- Schéma MySQL : `lib/db/src/schema`
- Configuration Drizzle : `lib/db/drizzle.config.ts`
- Règles métier : `artifacts/api-server/src/lib/analysisRules.ts`
