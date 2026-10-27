import { useEffect, useMemo, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from 'react';
import ExcelJS from 'exceljs';
import { processDocuments } from './lib/documentAnalysis';
import { suggestedReview } from './lib/documentAnalysisRules';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, UserButton, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, BadgeCheck, BriefcaseBusiness, Check,
  CheckCircle2, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Columns3,
  FileCheck2, FileImage, FilePlus2, FileSearch, FileText, Gauge, Info, LockKeyhole,
  Menu, Plus, Scale, Search, Settings2, Shield, ShieldAlert,
  Upload, X, Trash2, Pencil, Save, Eye, CircleDot, ScanLine
} from 'lucide-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  getGetAnalysisDashboardQueryKey, getGetAnalysisQueryKey, getGetPrivateObjectQueryKey,
  getHealthCheckQueryKey, getListAnalysesQueryKey, useCreateAnalysis, useCreateDocument,
  useCreateObservation, useDeleteAnalysis, useDeleteDocument, useDeleteObservation,
  useGetAnalysis, useGetAnalysisDashboard, useGetPrivateObject, useHealthCheck,
  useListAnalyses, useRequestUploadUrl, useRunAutomaticReview, useUpdateAnalysis,
  useUpdateDocument, useUpdateObservation, useVerifyDocumentSignature,
  useVerifyFrenchRegistryEntry
} from '@workspace/api-client-react';
import type { Analysis, AnalysisConclusion, AnalysisDetail, Document, Observation } from '@workspace/api-client-react';
import './index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const localDemoMode = import.meta.env.VITE_LOCAL_DEMO_MODE === 'true';
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#28685f', colorForeground: '#23383c', colorMutedForeground: '#687574',
    colorDanger: '#a23f37', colorBackground: '#fbf8f1', colorInput: '#f2efe7',
    colorInputForeground: '#23383c', colorNeutral: '#d8d2c5', fontFamily: 'DM Sans, sans-serif', borderRadius: '0.7rem',
  },
};
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }

type IconType = typeof FileText;
function Brand({ inverse = false }: { inverse?: boolean }) {
  return <span className={`brand ${inverse ? 'brand-inverse' : ''}`}><span className="brand-mark"><ScanLine size={19} strokeWidth={2.1} /></span><span>Finovox<span className="brand-dot">.</span></span></span>;
}
function Button({ children, kind = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'quiet' | 'outline' | 'danger' }) {
  return <button className={`button button-${kind} ${className}`} {...props}>{children}</button>;
}
function PageHeading({ eyebrow, title, detail, right }: { eyebrow: string; title: string; detail?: string; right?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1 className="serif">{title}</h1>{detail && <p className="heading-detail">{detail}</p>}</div>{right}</div>;
}
function StatusTag({ status }: { status: string | null }) {
  const labels: Record<string, string> = { draft: 'Brouillon', in_review: 'En revue', completed: 'Terminée' };
  return <span className={`status-tag status-${status || 'draft'}`} data-testid={`status-analysis-${status || 'draft'}`}><span className="status-dot" />{labels[status || 'draft'] || status}</span>;
}
function ModeTag({ mode }: { mode: string }) {
  return <span className="mode-tag">{mode === 'subsidy' ? 'Dossier subvention' : 'Lot indépendant'}</span>;
}
function LoadingBlock({ lines = 4 }: { lines?: number }) {
  return <div className="surface loading-panel" aria-label="Chargement en cours">{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton-line" style={{ width: `${82 - i * 9}%` }} />)}</div>;
}
function ErrorPanel({ retry }: { retry: () => void }) {
  return <div className="empty-state error-state"><AlertCircle size={24} /><h3>Les données ne sont pas disponibles</h3><p>Votre espace n’a pas pu être chargé. Réessayez dans un instant.</p><Button kind="outline" onClick={retry} data-testid="button-retry">Réessayer</Button></div>;
}
function EmptyState({ icon: Icon = FileSearch, title, detail, action }: { icon?: IconType; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={23} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
function RedirectTo({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(to, { replace: true }); }, [setLocation, to]);
  return null;
}
function ProductLanding() {
  if (localDemoMode) return <RedirectTo to="/dashboard" />;
  return <><Show when="signed-in"><RedirectTo to="/dashboard" /></Show><Show when="signed-out">
    <main className="landing-page">
      <nav className="landing-nav"><Link href="/" className="brand-link"><Brand /></Link><div className="landing-nav-links"><a href="#methode">Notre méthode</a><a href="#confidentialite">Confidentialité</a><Link href="/sign-in" className="text-link">Connexion <ArrowRight size={15} /></Link><Link href="/sign-up" className="button button-primary">Accéder à l’espace</Link></div></nav>
      <section className="landing-hero quiet-grid">
        <div className="hero-copy fade-up"><div className="kicker"><span className="kicker-line" /> POSTURE D’ANALYSE DOCUMENTAIRE</div><h1 className="serif">Le doute se<br />documente. Il ne<br /><em>se devine pas.</em></h1><p className="hero-description">Un espace d’analyse documentaire qui extrait les faits, relève les signaux et génère une conclusion automatique, modifiable par l’analyste.</p><div className="hero-actions"><Link href="/sign-up" className="button button-primary">Ouvrir un espace <ArrowRight size={16} /></Link><a href="#methode" className="text-link">Découvrir la méthode <ChevronDown size={16} /></a></div><div className="hero-note"><LockKeyhole size={15} /> Dossiers privés · Conclusion automatique, correction facultative</div></div>
        <div className="hero-visual fade-up" aria-label="Schéma de revue documentaire">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="hero-sheet"><div className="sheet-top"><span className="sheet-stamp">REVUE</span><span className="mono tiny">DOSSIER / 01</span></div><div className="sheet-title">Pièce justificative</div><div className="sheet-rule" /><div className="sheet-line long" /><div className="sheet-line" /><div className="sheet-highlight"><span className="highlight-mark" />Valeur relevée <b>— à vérifier</b></div><div className="sheet-line medium" /><div className="sheet-signature" /></div>
          <div className="evidence-note"><span className="note-mark"><Eye size={15} /></span><div><b>Signal documenté</b><small>Pas une conclusion</small></div><span className="note-index mono">02</span></div>
          <div className="hero-seal"><Shield size={19} /><span>ANALYSE<br />AUTOMATIQUE</span></div>
        </div>
        <div className="hero-index mono">01 / 03 <span>—</span> ANALYSE RESPONSABLE</div>
      </section>
      <section className="principles-section" id="methode"><div className="section-intro"><p className="eyebrow">LA MÉTHODE FINOVOX</p><h2 className="serif">Une trace pour chaque<br />niveau de certitude.</h2><p>La lisibilité d’un dossier commence par le vocabulaire qu’on emploie pour le décrire.</p></div><div className="principle-list">
        {[['01', 'Fait observé', 'Ce qui est directement visible ou transcrit dans une pièce.', 'fact'], ['02', 'Signal', 'Un élément qui appelle une vérification, sans rien démontrer à lui seul.', 'signal'], ['03', 'Hypothèse', 'Une piste de lecture, explicitement séparée des observations.', 'hypothesis'], ['04', 'Preuve', 'Un élément établi et contextualisé par l’analyste.', 'proof']].map(([n, t, d, c]) => <div className={`principle-row principle-${c}`} key={n}><span className="principle-number mono">{n}</span><span className="principle-symbol"><CircleDot size={14} /></span><div><h3>{t}</h3><p>{d}</p></div><ChevronRight size={18} className="principle-arrow" /></div>)}
      </div></section>
      <section className="landing-manifesto"><div className="manifesto-mark">“</div><div><p className="eyebrow">UNE RÈGLE NON NÉGOCIABLE</p><h2 className="serif">Aucun score ne<br />rend un verdict.</h2><p>L’analyse automatique organise les faits et signaux disponibles. Elle ne certifie pas l’authenticité. Une consultation de registre public peut vérifier un identifiant d’entreprise, sans authentifier la pièce.</p></div><div className="manifesto-aside"><div className="aside-rule" /><strong>La conclusion est générée<br />et reste modifiable.</strong><span>Finovox · analyse automatique</span></div></section>
      <section className="landing-privacy" id="confidentialite"><div className="privacy-art"><div className="privacy-lock"><LockKeyhole size={33} /></div><span className="privacy-corner privacy-corner-a" /><span className="privacy-corner privacy-corner-b" /><span className="privacy-label mono">ACCÈS CONTRÔLÉ / DONNÉES PRIVÉES</span></div><div><p className="eyebrow">CONFIDENTIALITÉ D’ABORD</p><h2 className="serif">Vos pièces restent<br />dans leur dossier.</h2><p>Les lots indépendants ne sont jamais rapprochés entre eux. Le rapprochement n’est disponible que dans un dossier de subvention et reste circonscrit à ses cinq pièces.</p><Link href="/sign-up" className="text-link">Créer un espace de travail <ArrowRight size={15} /></Link></div></section>
      <section className="landing-last"><p className="eyebrow">UN ESPACE DE REVUE, PAS UNE BOÎTE NOIRE</p><h2 className="serif">Du document à une<br /><em>recommandation traçable.</em></h2><p>Chaque contrôle indique ce qui a été fait — et ce qui ne l’a pas été.</p><Link href="/sign-up" className="button button-primary">Commencer une revue <ArrowRight size={16} /></Link></section>
      <footer className="landing-footer"><Brand /><span>Finovox · espace confidentiel d’analyse</span><Link href="/sign-in" className="text-link">Connexion <ArrowRight size={15} /></Link></footer>
    </main>
  </Show></>;
}

function AuthPage({ type }: { type: 'in' | 'up' }) {
  return <div className="auth-wrap"><div className="auth-top"><Link href="/" className="brand-link"><Brand /></Link><Link href="/" className="text-link"><ArrowLeft size={15} /> Accueil</Link></div><div className="auth-content"><div className="auth-message"><span className="auth-overline mono">FINOVOX / ESPACE D’ANALYSE</span><h1 className="serif">{type === 'in' ? 'Reprendre la revue.' : 'Un espace pour instruire.'}</h1><p>Un cadre de travail confidentiel. Les faits restent distincts des hypothèses ; la décision demeure la vôtre.</p><div className="auth-promise"><ShieldCheck size={17} /> Aucun verdict automatisé</div></div><div className="auth-form">{type === 'in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/dashboard`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/dashboard`} />}</div></div><div className="auth-foot"><LockKeyhole size={14} /> Connexion sécurisée · données accessibles après authentification</div></div>;
}
function ShieldCheck({ size = 18 }: { size?: number }) { return <BadgeCheck size={size} />; }

const navItems = [
  { href: '/dashboard', label: 'Vue d’ensemble', icon: Gauge },
  { href: '/history', label: 'Historique', icon: Clock3 },
];
function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = (href: string) => location === href || (href === '/dashboard' && location === '/');
  const appFrame = <div className="app-frame">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}><div className="sidebar-brand"><Link href="/dashboard" className="brand-link"><Brand inverse /></Link><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu" data-testid="button-close-menu"><X size={18} /></button></div>
      <div className="workspace-label mono">ESPACE CONFIDENTIEL</div><nav className="side-nav" aria-label="Navigation principale">
        {navItems.map(n => <Link key={n.href} href={n.href} className={`nav-item ${active(n.href) ? 'nav-active' : ''}`} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${n.href.slice(1)}`}><n.icon size={17} />{n.label}{active(n.href) && <span className="nav-current" />}</Link>)}
        <div className="nav-divider" /><span className="nav-section mono">INSTRUCTION</span>
        <Link href="/analyses/new" className={`nav-item ${location === '/analyses/new' ? 'nav-active' : ''}`} onClick={() => setMobileOpen(false)} data-testid="link-nav-new"><Plus size={17} />Nouvelle analyse</Link>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-guidance"><Shield size={17} /><span><b>Décision humaine</b><small>Pas de verdict par score</small></span></div><Link href="/settings" className={`nav-item settings-link ${location === '/settings' ? 'nav-active' : ''}`} data-testid="link-nav-settings"><Settings2 size={17} />Configuration</Link><div className="sidebar-version mono">FINOVOX · REVUE 1.0</div></div>
    </aside><div className="mobile-shade" onClick={() => setMobileOpen(false)} />
    <div className="app-main"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu" data-testid="button-open-menu"><Menu size={20} /></button><div className="breadcrumb"><span>Finovox</span><ChevronRight size={14} /><span className="breadcrumb-current">{location === '/dashboard' || location === '/' ? 'Vue d’ensemble' : location.split('/').filter(Boolean).slice(-1)[0]}</span></div><div className="topbar-right"><span className="privacy-pill"><span />{localDemoMode ? 'Démo locale · fichiers sur ce PC · test uniquement' : 'Session privée'}</span>{!localDemoMode && <UserButton appearance={{ elements: { avatarBox: 'user-avatar' } }} />}</div></header><main className="content-area">{children}</main></div>
  </div>;
  return localDemoMode ? appFrame : <><Show when="signed-out"><RedirectTo to="/sign-in" /></Show><Show when="signed-in">{appFrame}</Show></>;
}
function Dashboard() {
  const { data: summary, isLoading, isError, refetch } = useGetAnalysisDashboard();
  const counts = summary ? [
    { label: 'Dossiers suivis', value: summary.totalAnalyses, icon: BriefcaseBusiness, color: 'teal' },
    { label: 'Pièces examinées', value: summary.totalDocuments, icon: FileText, color: 'blue' },
    { label: 'En attente de revue', value: summary.awaitingReview, icon: Clock3, color: 'amber' },
  ] : [];
  return <div className="page-wrap fade-up"><PageHeading eyebrow="ESPACE DE TRAVAIL" title="Vue d’ensemble" detail="Une lecture factuelle, à votre rythme." right={<Link href="/analyses/new" className="button button-primary" data-testid="link-create-analysis"><Plus size={17} /> Nouvelle analyse</Link>} />
    <div className="dashboard-intro"><div className="intro-rule" /><div><strong>La prudence est une méthode.</strong><p>Finovox organise vos pièces et vos vérifications. Aucun indicateur ne constitue une conclusion.</p></div><Link href="/settings" className="intro-link" aria-label="Voir la configuration"><ArrowRight size={17} /></Link></div>
    {isLoading ? <div className="stats-grid">{[1,2,3].map(x => <LoadingBlock key={x} lines={2} />)}</div> : isError ? <ErrorPanel retry={() => void refetch()} /> : summary ? <>
      <div className="stats-grid">{counts.map(({ label, value, icon: Icon, color }) => <div className={`stat-card stat-${color}`} key={label} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><span className="stat-icon"><Icon size={18} /></span><span className="stat-label">{label}</span><strong className="stat-value mono">{value}</strong><span className="stat-foot">Données enregistrées</span></div>)}</div>
      <div className="dashboard-section-heading"><div><p className="eyebrow">ACTIVITÉ RÉCENTE</p><h2 className="serif">Dossiers récemment ouverts</h2></div><Link href="/history" className="text-link">Tout l’historique <ArrowRight size={15} /></Link></div>
      {summary.recent.length ? <AnalysisTable rows={summary.recent} /> : <EmptyState icon={FilePlus2} title="Aucun dossier pour l’instant" detail="Les dossiers que vous créerez apparaîtront ici. Vos données ne sont pas préremplies." action={<Link href="/analyses/new" className="button button-primary"><Plus size={16} /> Créer le premier dossier</Link>} />}
      <div className="dashboard-lower"><div className="work-note"><span><Scale size={20} /></span><div><b>Fait, signal, hypothèse, preuve.</b><p>Chaque observation conserve sa catégorie et sa source pour rendre votre raisonnement lisible.</p></div></div><div className="data-boundary"><LockKeyhole size={18} /><div><b>Frontières de rapprochement</b><p>Comparaisons limitées aux 5 pièces d’un même dossier subvention.</p></div></div></div>
    </> : null}
  </div>;
}
function AnalysisTable({ rows }: { rows: Analysis[] }) {
  return <div className="surface table-wrap"><table className="analysis-table"><thead><tr><th>DOSSIER</th><th>MODE</th><th>PIÈCES</th><th>ÉTAT</th><th>CONCLUSION</th><th /></tr></thead><tbody>{rows.map(a => <tr key={a.id} data-testid={`row-analysis-${a.id}`}><td><Link href={`/analyses/${a.id}`} className="analysis-title">{a.title}</Link><span className="analysis-date mono">{new Date(a.updatedAt).toLocaleDateString('fr-FR')}</span></td><td><ModeTag mode={a.mode} /></td><td className="mono">{a.documentCount}</td><td><StatusTag status={a.status} /></td><td className="conclusion-cell">{a.conclusion || <span className="muted-text">Non renseignée</span>}</td><td><Link href={`/analyses/${a.id}`} className="row-arrow" aria-label={`Ouvrir ${a.title}`}><ArrowRight size={16} /></Link></td></tr>)}</tbody></table></div>;
}

function NewAnalysis() {
  const qc = useQueryClient(); const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'subsidy' | 'independent_batch'>('subsidy');
  const [title, setTitle] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState(''); const [progress, setProgress] = useState('');
  const create = useCreateAnalysis(); const requestUpload = useRequestUploadUrl(); const createDocument = useCreateDocument();
  const exact = mode === 'subsidy' ? 5 : 9;
  function selectFiles(list: FileList | null) {
    if (!list) return; const selected = Array.from(list);
    const valid = selected.filter(f => ['application/pdf','image/jpeg','image/png'].includes(f.type) && f.size <= 20 * 1024 * 1024);
    if (valid.length !== selected.length) setError('Formats acceptés : PDF, JPG, JPEG et PNG. Chaque fichier doit peser 20 Mo maximum.');
    else setError('');
    if (valid.length > exact) { setError(`Ce mode attend exactement ${exact} pièces. Votre sélection dépasse cette limite.`); setFiles(valid.slice(0, exact)); }
    else setFiles(valid);
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!title.trim()) { setError('Donnez un nom au dossier.'); return; }
    if (files.length !== exact) { setError(`Sélectionnez exactement ${exact} pièces avant de créer ce dossier.`); return; }
    try {
      setProgress('Analyse locale des documents avant transfert…');
      const processedDocuments = await processDocuments(files, setProgress);
      const analysis = await create.mutateAsync({ data: { title: title.trim(), mode } });
      for (const [index, file] of files.entries()) {
        const processed = processedDocuments[index];
        if (!processed) throw new Error(`L’analyse automatique de ${file.name} n’a pas produit de résultat.`);
        setProgress(`Transfert de la pièce ${index + 1} sur ${exact}…`);
        const signed = await requestUpload.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png' } });
        const upload = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!upload.ok) throw new Error(`Le transfert de ${file.name} a échoué.`);
        await createDocument.mutateAsync({ analysisId: analysis.id, data: { fileName: file.name, mimeType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png', size: file.size, objectPath: signed.objectPath, category: processed.category, pageCount: processed.pageCount, extractedText: processed.extractedText, extractedFields: processed.extractedFields, controlStatus: processed.controlStatus } });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: getListAnalysesQueryKey() }), qc.invalidateQueries({ queryKey: getGetAnalysisDashboardQueryKey() })]);
      setProgress('');
      setLocation(`/analyses/${analysis.id}`);
    } catch (err) { setProgress(''); setError(err instanceof Error ? err.message : 'Impossible de créer le dossier. Vérifiez votre connexion et réessayez.'); }
  }
  const busy = create.isPending || requestUpload.isPending || createDocument.isPending || Boolean(progress);
  return <div className="page-wrap narrow-page fade-up"><PageHeading eyebrow="NOUVEAU DOSSIER" title="Créer une analyse" detail="Finovox extrait le texte localement et relève les champs contrôlables avant votre revue." right={<Link href="/dashboard" className="button button-quiet"><ArrowLeft size={16} /> Retour</Link>} />
    <form onSubmit={submit} className="create-layout">
      <section className="surface create-card"><div className="form-section-title"><span className="step-index mono">01</span><div><h2>Périmètre de revue</h2><p>Le périmètre détermine les rapprochements autorisés.</p></div></div>
        <div className="mode-options">
          <button type="button" className={`mode-option ${mode === 'subsidy' ? 'mode-selected' : ''}`} onClick={() => {setMode('subsidy');setFiles([]);}} data-testid="button-mode-subsidy"><span className="mode-icon"><Columns3 size={20} /></span><span className="mode-copy"><b>Dossier de subvention</b><small>5 pièces liées, une conclusion pour le dossier. Rapprochement interne autorisé.</small></span><span className="mode-radio">{mode === 'subsidy' && <span />}</span></button>
          <button type="button" className={`mode-option ${mode === 'independent_batch' ? 'mode-selected' : ''}`} onClick={() => {setMode('independent_batch');setFiles([]);}} data-testid="button-mode-independent"><span className="mode-icon"><FileSearch size={20} /></span><span className="mode-copy"><b>Lot indépendant</b><small>9 documents sans lien. Chaque pièce garde son identité et son analyse propre.</small></span><span className="mode-radio">{mode === 'independent_batch' && <span />}</span></button>
        </div>
        <label className="field-label" htmlFor="analysis-title">Nom du dossier</label><input id="analysis-title" className="text-input" maxLength={160} placeholder="Ex. Demande de financement — référence" value={title} onChange={e => setTitle(e.target.value)} data-testid="input-analysis-title" />
      </section>
      <section className="surface create-card"><div className="form-section-title"><span className="step-index mono">02</span><div><h2>Pièces à examiner</h2><p>Ajoutez {exact} documents pour ce lot. Aucun rapprochement ne sera fait hors périmètre.</p></div></div>
        <label className="upload-drop"><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={e => selectFiles(e.target.files)} data-testid="input-upload-documents" /><Upload size={22} /><strong>Choisir les fichiers</strong><span>PDF, JPG, JPEG ou PNG · 20 Mo maximum par fichier</span><span className="upload-exact mono">{files.length} / {exact} pièces sélectionnées</span></label>
        {files.length > 0 && <div className="selected-files">{files.map((f,i) => <div className="selected-file" key={`${f.name}-${i}`}><FileText size={16} /><span>{f.name}</span><small>{(f.size/1024/1024).toFixed(1)} Mo</small><button type="button" onClick={() => setFiles(files.filter((_, n) => n !== i))} aria-label={`Retirer ${f.name}`} data-testid={`button-remove-file-${i}`}><X size={15} /></button></div>)}</div>}
        <div className="upload-privacy"><ScanLine size={14} /><span>Le texte PDF est extrait localement ; les pages scannées et images passent par OCR français/anglais dans votre navigateur. Les documents ne sont pas envoyés au service OCR.</span></div>
        <div className="upload-privacy"><LockKeyhole size={14} /><span>{localDemoMode ? 'Mode démo : fichiers enregistrés sur ce PC. Utilisez exclusivement des documents de test, jamais de données sensibles.' : 'Les fichiers sont envoyés vers leur stockage privé.'}</span></div>
      </section>
      {error && <div className="form-error" role="alert"><AlertCircle size={17} />{error}</div>}
      {progress && busy && <div className="upload-progress"><span className="progress-pulse" />{progress}</div>}
      <div className="create-actions"><span className="muted-text">Vous pourrez corriger le texte et les champs après création.</span><Button type="submit" disabled={busy} data-testid="button-submit-analysis">{busy ? <><span className="button-spinner" /> Création…</> : <>Créer le dossier <ArrowRight size={16} /></>}</Button></div>
    </form>
  </div>;
}

function AnalysisPage({ section = 'review' }: { section?: 'review' | 'compare' | 'report' }) {
  const params = useParams<{ id: string }>(); const id = params.id || '';
  const { data, isLoading, isError, refetch } = useGetAnalysis(id, { query: { queryKey: getGetAnalysisQueryKey(id), enabled: !!id } });
  if (isLoading) return <div className="page-wrap"><LoadingBlock lines={6} /></div>;
  if (isError || !data) return <div className="page-wrap"><ErrorPanel retry={() => void refetch()} /></div>;
  if (section === 'compare') return <ComparePage analysis={data} />;
  if (section === 'report') return <ReportPage analysis={data} />;
  return <ReviewPage analysis={data} />;
}
function DetailNav({ analysis, current }: { analysis: Analysis; current: string }) {
  return <div className="detail-subnav"><Link href={`/analyses/${analysis.id}`} className={current === 'review' ? 'detail-tab active' : 'detail-tab'}><FileSearch size={15} /> Revue</Link>{analysis.mode === 'subsidy' && <Link href={`/analyses/${analysis.id}/compare`} className={current === 'compare' ? 'detail-tab active' : 'detail-tab'}><Columns3 size={15} /> Rapprochement</Link>}<Link href={`/analyses/${analysis.id}/report`} className={current === 'report' ? 'detail-tab active' : 'detail-tab'}><ClipboardCheck size={15} /> Conclusion</Link></div>;
}
function ReviewPage({ analysis }: { analysis: AnalysisDetail }) {
  const [selectedId, setSelectedId] = useState(analysis.documents[0]?.id || '');
  const doc = analysis.documents.find(d => d.id === selectedId);
  const [text, setText] = useState(doc?.extractedText || '');
  const [fieldsText, setFieldsText] = useState(JSON.stringify(doc?.extractedFields || {}, null, 2));
  const [editFields, setEditFields] = useState(false); const [saveMessage, setSaveMessage] = useState('');
  const [showObs, setShowObs] = useState(false);
  const qc = useQueryClient(); const updateDoc = useUpdateDocument(); const createObs = useCreateObservation(); const updateObs = useUpdateObservation(); const deleteObs = useDeleteObservation();
  useEffect(() => { setText(doc?.extractedText || ''); setFieldsText(JSON.stringify(doc?.extractedFields || {}, null, 2)); setEditFields(false); setSaveMessage(''); }, [doc?.id, doc?.extractedText, doc?.extractedFields]);
  async function saveDocument() {
    if (!doc) return; let fields: Record<string, unknown> = {};
    try { fields = JSON.parse(fieldsText || '{}'); } catch { setSaveMessage('Le format des champs doit être un JSON valide.'); return; }
    try { await updateDoc.mutateAsync({ documentId: doc.id, data: { extractedText: text, extractedFields: fields } }); await qc.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysis.id) }); setSaveMessage('Modifications enregistrées.'); }
    catch { setSaveMessage('Enregistrement impossible. Réessayez.'); }
  }
  const documentObservations = analysis.observations.filter(o => !o.documentId || o.documentId === selectedId);
  return <div className="page-wrap fade-up"><PageHeading eyebrow="REVUE DOCUMENTAIRE" title={analysis.title} detail={`${analysis.documentCount} pièce${analysis.documentCount !== 1 ? 's' : ''} · mise à jour le ${new Date(analysis.updatedAt).toLocaleDateString('fr-FR')}`} right={<div className="heading-badges"><ModeTag mode={analysis.mode} /><StatusTag status={analysis.status} /></div>} /><DetailNav analysis={analysis} current="review" />
    {analysis.mode === 'independent_batch' && <div className="boundary-banner"><Info size={17} /><span><b>Documents indépendants.</b> Ils sont analysés séparément. Aucun rapprochement entre les pièces de ce lot n’est disponible.</span></div>}
    <div className="review-layout"><aside className="document-rail"><div className="rail-heading"><span>PIÈCES DU DOSSIER</span><span className="mono">{analysis.documents.length.toString().padStart(2,'0')}</span></div>{analysis.documents.length ? analysis.documents.map((d,i) => <button key={d.id} className={`document-list-item ${d.id === selectedId ? 'document-active' : ''}`} onClick={() => setSelectedId(d.id)} data-testid={`button-document-${d.id}`}><span className="doc-index mono">{String(i+1).padStart(2,'0')}</span><span className="doc-mini-icon">{d.mimeType.startsWith('image/') ? <FileImage size={17} /> : <FileText size={17} />}</span><span className="doc-name">{d.fileName}<small>{d.category || 'Pièce'} · {d.pageCount || '—'} page(s)</small></span><ChevronRight size={14} className="doc-chevron" /></button>) : <div className="rail-empty">Aucune pièce attachée.</div>}<div className="rail-note"><LockKeyhole size={14} /><span>Identité du document conservée</span></div></aside>
      <div className="review-main">{doc ? <DocumentWorkspace analysis={analysis} doc={doc} text={text} setText={setText} fieldsText={fieldsText} setFieldsText={setFieldsText} editFields={editFields} setEditFields={setEditFields} onSave={saveDocument} saving={updateDoc.isPending} saveMessage={saveMessage} /> : <EmptyState icon={FileText} title="Aucune pièce à afficher" detail="Ajoutez des documents pour commencer la revue." />}
        <section className="surface observations-panel"><div className="panel-heading"><div><p className="eyebrow">JOURNAL DE REVUE</p><h2>Observations</h2></div><Button kind="outline" onClick={() => setShowObs(!showObs)} data-testid="button-add-observation"><Plus size={15} /> Ajouter une note</Button></div>
          <p className="observations-intro">Classez chaque élément selon son niveau de certitude. Les signaux et hypothèses ne sont pas des preuves.</p>
          {showObs && <ObservationForm analysisId={analysis.id} documentId={doc?.id || null} onDone={() => setShowObs(false)} />}
          {documentObservations.length ? <div className="observation-list">{documentObservations.map(o => <ObservationCard key={o.id} observation={o} update={updateObs} remove={deleteObs} analysisId={analysis.id} />)}</div> : !showObs && <div className="observations-empty"><CircleHelp size={18} /><span>Aucun indicateur calculé ni aucune observation saisie pour cette pièce. L’absence de signal détecté ne prouve pas l’authenticité.</span></div>}
        </section>
      </div>
    </div>
  </div>;
}
function DocumentWorkspace({ analysis, doc, text, setText, fieldsText, setFieldsText, editFields, setEditFields, onSave, saving, saveMessage }: { analysis: AnalysisDetail; doc: Document; text: string; setText: (v:string)=>void; fieldsText: string; setFieldsText: (v:string)=>void; editFields: boolean; setEditFields: (v:boolean)=>void; onSave:()=>void; saving: boolean; saveMessage:string }) {
  const [tab, setTab] = useState<'document' | 'text' | 'fields' | 'checks'>('document');
  return <section className="surface document-workspace"><div className="doc-work-top"><div className="doc-work-title"><span className="file-badge">{doc.mimeType.startsWith('image/') ? <FileImage size={19} /> : <FileText size={19} />}</span><div><h2>{doc.fileName}</h2><span>{doc.category} · {(doc.size/1024/1024).toFixed(1)} Mo · {doc.pageCount || '—'} page(s)</span></div></div><button className="quiet-icon" title="Enregistrer les changements" onClick={onSave} disabled={saving} data-testid="button-save-document"><Save size={16} /></button></div>
    <div className="document-tabs">{[['document','Aperçu'],['text','Texte retranscrit'],['fields','Champs relevés'],['checks','Contrôles']].map(([v,l]) => <button key={v} className={tab===v?'doc-tab active':'doc-tab'} onClick={() => setTab(v as typeof tab)} data-testid={`tab-document-${v}`}>{l}</button>)}</div>
    {tab === 'document' && <PrivatePreview doc={doc} />}
    {tab === 'text' && <div className="text-edit-panel"><div className="editor-meta"><span>TRANSCRIPTION LOCALE / MODIFIABLE</span><span>{text.length.toLocaleString('fr-FR')} caractères</span></div><textarea value={text} onChange={e => setText(e.target.value)} placeholder="Aucun texte n’a été extrait. Vous pouvez saisir ou corriger la transcription." data-testid="textarea-extracted-text" /><div className="editor-help"><Info size={14} /> Texte PDF extrait ou OCR exécuté dans le navigateur. Corrigez toute erreur de reconnaissance sur la pièce originale avant de vous appuyer sur un champ.</div><Button kind="outline" onClick={onSave} disabled={saving} data-testid="button-save-extracted-text">{saving ? 'Enregistrement…' : 'Enregistrer la transcription'}</Button></div>}
    {tab === 'fields' && <div className="field-edit-panel"><div className="editor-meta"><span>VALEURS RELEVÉES / MODIFIABLES</span><button onClick={() => setEditFields(!editFields)} data-testid="button-toggle-fields-edit"><Pencil size={13} /> {editFields ? 'Lecture' : 'Modifier'}</button></div>{editFields ? <textarea className="json-editor" value={fieldsText} onChange={e => setFieldsText(e.target.value)} data-testid="textarea-extracted-fields" /> : <FieldList fields={doc.extractedFields} />}<div className="editor-help"><Info size={14} /> Les champs sont proposés par extraction texte/OCR et règles de reconnaissance. Ils ne sont pas authentifiés : vérifiez chaque valeur sur la pièce source.</div>{editFields && <Button kind="outline" onClick={onSave} disabled={saving} data-testid="button-save-fields">Enregistrer les champs</Button>}</div>}
    {tab === 'checks' && <ControlChecklist doc={doc} />}
    {saveMessage && <div className={`save-message ${saveMessage.includes('impossible') || saveMessage.includes('valide') ? 'save-error' : ''}`} role="status"><Check size={14} />{saveMessage}</div>}
  </section>;
}
function PrivatePreview({ doc }: { doc: Document }) {
  const requestPath = doc.objectPath.replace(/^\/objects\//, '');
  const { data: blob, isLoading, isError, error, refetch } = useGetPrivateObject(requestPath, { query: { queryKey: getGetPrivateObjectQueryKey(requestPath), enabled: !!requestPath } });
  const [url, setUrl] = useState('');
  useEffect(() => { if (!blob) return; const u = URL.createObjectURL(blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [blob]);
  if (isLoading) return <div className="preview-loading"><div className="skeleton-preview" /><span>Chargement de l’aperçu privé…</span></div>;
  if (isError || !url) return <div className="preview-unavailable"><FileText size={31} /><b>Aperçu indisponible</b><span>{error instanceof Error ? error.message : 'Le fichier n’a pas pu être chargé. Vérifiez que le fichier existe dans le stockage privé.'}</span><Button kind="outline" onClick={() => void refetch()}>Réessayer</Button></div>;
  return <div className="private-preview">{doc.mimeType.startsWith('image/') ? <img src={url} alt={`Aperçu privé de ${doc.fileName}`} /> : <iframe src={url} title={`Aperçu privé de ${doc.fileName}`} />}</div>;
}
function FieldList({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields || {});
  return entries.length ? <div className="extracted-list">{entries.map(([k,v]) => <div className="extracted-row" key={k}><span>{k}</span><b>{typeof v === 'string' ? v : JSON.stringify(v)}</b></div>)}</div> : <div className="no-fields"><Info size={18} /><span>Aucune valeur relevée n’a été saisie pour cette pièce.</span></div>;
}
function ControlChecklist({ doc }: { doc: Document }) {
  const qc = useQueryClient();
  const verifySignature = useVerifyDocumentSignature();
  const verifyRegistry = useVerifyFrenchRegistryEntry();
  const [signatureError, setSignatureError] = useState('');
  const [registryError, setRegistryError] = useState('');
  const status = doc.controlStatus || {};
  const signature = asRecord(status.pdfSignature);
  const registry = asRecord(status.frenchRegistry);
  const stateLabel = (value: unknown) => {
    if (value === 'performed') return 'Effectué';
    if (value === 'valid') return 'Signature valide';
    if (value === 'invalid') return 'Signature invalide';
    if (value === 'untrusted') return 'Confiance non établie';
    if (value === 'unsigned') return 'Non signée';
    if (value === 'unavailable') return 'Indisponible';
    if (value === 'not_applicable') return 'Sans objet';
    if (value === 'found_active') return 'Identifiant actif trouvé';
    if (value === 'found_closed') return 'Identifiant fermé';
    if (value === 'found_status_unknown') return 'Statut inconnu';
    if (value === 'not_found') return 'Aucun résultat exact';
    if (value === 'unavailable') return 'Consultation indisponible';
    return value === 'impossible' ? 'Impossible' : 'Non effectué';
  };
  const checks = [
    { name: 'OCR / extraction du texte', value: status['OCR / extraction du texte'] ?? 'not_performed' },
    { name: 'Détection de type', value: status['Détection de type'] ?? 'not_performed' },
    { name: 'Vérification du format de fichier', value: status['Vérification du format de fichier'] ?? 'not_performed' },
    {
      name: 'Signature cryptographique du PDF',
      value: signature?.status ?? status['Signature cryptographique du PDF'] ?? 'not_performed',
      detail: signature
        ? `${String(signature.message)}${typeof signature.signer === 'string' ? ` Signataire : ${signature.signer}.` : ''}${typeof signature.signedAt === 'string' ? ` Date de signature indiquée : ${signature.signedAt}.` : ''}`
        : undefined,
    },
    {
      name: 'Registre officiel français',
      value: registry?.status ?? 'not_performed',
      detail: registry
        ? `${String(registry.message)}${typeof registry.identifier === 'string' ? ` Identifiant : ${registry.identifier}.` : ''}${typeof registry.name === 'string' ? ` Entité : ${registry.name}.` : ''}${typeof registry.checkedAt === 'string' ? ` Consulté le ${new Date(registry.checkedAt).toLocaleString('fr-FR')}.` : ''}`
        : undefined,
    },
  ];
  async function retrySignature() {
    setSignatureError('');
    try {
      await verifySignature.mutateAsync({ documentId: doc.id });
      await qc.invalidateQueries({ queryKey: getGetAnalysisQueryKey(doc.analysisId) });
    } catch (err) {
      setSignatureError(err instanceof Error ? err.message : 'La vérification de la signature a échoué.');
    }
  }
  async function retryRegistry() {
    setRegistryError('');
    try {
      await verifyRegistry.mutateAsync({ documentId: doc.id });
      await qc.invalidateQueries({ queryKey: getGetAnalysisQueryKey(doc.analysisId) });
    } catch (err) {
      setRegistryError(err instanceof Error ? err.message : 'La consultation du registre a échoué.');
    }
  }
  const fields = doc.extractedFields ?? {};
  const hasRegistryIdentifier = typeof fields.siret === 'string' || typeof fields.siren === 'string';
  return <div className="checks-panel"><p>Le registre français est consulté automatiquement lorsqu’un SIREN/SIRET est extrait. Les PDF sont vérifiés localement si pdfsig est installé ; les documents ne sont jamais transmis au vérificateur.</p>{checks.map(({ name, value, detail }) => <div className="check-row" key={name}><span className="check-icon">{value === 'performed' || value === 'valid' || value === 'found_active' ? <CheckCircle2 size={17} /> : value === 'invalid' || value === 'unavailable' ? <AlertCircle size={17} /> : <CircleDot size={17} />}</span><span>{name}{typeof detail === 'string' && <small className="check-detail">{detail}</small>}</span><b>{stateLabel(value)}</b></div>)}{doc.mimeType === 'application/pdf' && signature?.status !== 'valid' && <Button type="button" kind="outline" disabled={verifySignature.isPending} onClick={() => void retrySignature()}>{verifySignature.isPending ? 'Vérification locale…' : 'Relancer la vérification PDF'}</Button>}{signatureError && <p className="form-error" role="alert">{signatureError}</p>}{hasRegistryIdentifier && <Button type="button" kind="outline" disabled={verifyRegistry.isPending} onClick={() => void retryRegistry()}>{verifyRegistry.isPending ? 'Consultation du registre…' : 'Actualiser le registre français'}</Button>}{registryError && <p className="form-error" role="alert">{registryError}</p>}<div className="editor-help"><Info size={14} /> Une signature intégrée n’établit pas à elle seule l’identité ni le pouvoir du signataire. Le statut de registre décrit les données publiques trouvées au moment de la consultation.</div></div>;
}
function ObservationForm({ analysisId, documentId, onDone }: { analysisId: string; documentId: string | null; onDone: () => void }) {
  const qc = useQueryClient(); const create = useCreateObservation(); const [classification, setClassification] = useState<'FACT'|'SIGNAL'|'HYPOTHESIS'|'PROOF'>('FACT');
  const [description, setDescription] = useState(''); const [value, setValue] = useState(''); const [method, setMethod] = useState('Examen visuel par l’analyste'); const [severity, setSeverity] = useState<'low'|'medium'|'high'>('medium'); const [error,setError]=useState('');
  async function save(e: FormEvent) { e.preventDefault(); if (!description.trim()) {setError('Décrivez l’observation avant de l’enregistrer.');return;} try { await create.mutateAsync({analysisId,data:{documentId,classification,severity,description:description.trim(),method:method.trim() || 'Saisie analyste',observedValue:value || null,confidence:null,resolved:false}}); await qc.invalidateQueries({queryKey:getGetAnalysisQueryKey(analysisId)}); onDone(); } catch {setError('L’observation n’a pas pu être enregistrée.');} }
  return <form className="observation-form" onSubmit={save}><div className="form-pair"><label>Classe<select value={classification} onChange={e=>setClassification(e.target.value as typeof classification)} data-testid="select-observation-class"><option value="FACT">Fait observé</option><option value="SIGNAL">Signal</option><option value="HYPOTHESIS">Hypothèse</option><option value="PROOF">Preuve</option></select></label><label>Importance<select value={severity} onChange={e=>setSeverity(e.target.value as typeof severity)} data-testid="select-observation-severity"><option value="low">Faible</option><option value="medium">Modérée</option><option value="high">Élevée</option></select></label></div><label>Observation<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Décrivez précisément l’élément constaté." data-testid="textarea-observation-description" /></label><label>Valeur observée, si applicable<input value={value} onChange={e=>setValue(e.target.value)} data-testid="input-observed-value" /></label><label>Méthode / source<input value={method} onChange={e=>setMethod(e.target.value)} data-testid="input-observation-method" /></label>{error && <span className="inline-error">{error}</span>}<div className="observation-form-actions"><Button type="button" kind="quiet" onClick={onDone}>Annuler</Button><Button type="submit" disabled={create.isPending} data-testid="button-submit-observation">{create.isPending ? 'Enregistrement…' : 'Enregistrer l’observation'}</Button></div></form>;
}
function ObservationCard({ observation, update, remove, analysisId }: { observation: Observation; update: ReturnType<typeof useUpdateObservation>; remove: ReturnType<typeof useDeleteObservation>; analysisId:string }) {
  const qc=useQueryClient(); const classes: Record<string,string>={FACT:'tag-fact',SIGNAL:'tag-signal',HYPOTHESIS:'tag-hypothesis',PROOF:'tag-proof'};
  const labels: Record<string,string>={FACT:'Fait observé',SIGNAL:'Signal',HYPOTHESIS:'Hypothèse',PROOF:'Preuve'};
  return <article className={`observation-card ${observation.resolved?'observation-resolved':''}`} data-testid={`card-observation-${observation.id}`}><div className="obs-card-top"><span className={`classification-tag ${classes[observation.classification]}`}>{labels[observation.classification]}</span><span className={`severity-mark severity-${observation.severity}`}>{observation.severity === 'high'?'Élevée':observation.severity==='low'?'Faible':'Modérée'}</span><span className="obs-source">{observation.source === 'analyst' ? 'Analyste' : 'Déterministe'}</span></div><p>{observation.description}</p>{observation.observedValue && <div className="obs-value"><span>VALEUR OBSERVÉE</span><b>{observation.observedValue}</b></div>}<div className="obs-card-bottom"><span>{observation.method}{observation.page ? ` · p. ${observation.page}` : ''}</span><div><button title={observation.resolved?'Rouvrir':'Marquer comme traité'} onClick={async()=>{await update.mutateAsync({observationId:observation.id,data:{resolved:!observation.resolved}});await qc.invalidateQueries({queryKey:getGetAnalysisQueryKey(analysisId)});}} data-testid={`button-resolve-observation-${observation.id}`}>{observation.resolved?'Rouvrir':'Traité'}</button><button title="Supprimer l’observation" onClick={async()=>{if(window.confirm('Supprimer cette observation ?')) {await remove.mutateAsync({observationId:observation.id});await qc.invalidateQueries({queryKey:getGetAnalysisQueryKey(analysisId)});}}} data-testid={`button-delete-observation-${observation.id}`}><Trash2 size={14} /></button></div></div></article>;
}

function ComparePage({ analysis }: { analysis: AnalysisDetail }) {
  const [fields,setFields]=useState<string[]>(['nom','date','montant','référence']); const [custom,setCustom]=useState('');
  const fieldLabel=(d:Document,k:string)=>{ const entries=Object.entries(d.extractedFields||{}); const found=entries.find(([name])=>name.toLowerCase().includes(k.toLowerCase())); return found?.[1] == null ? 'Non relevé' : String(found[1]); };
  if (analysis.mode !== 'subsidy') return <div className="page-wrap"><PageHeading eyebrow="PÉRIMÈTRE NON AUTORISÉ" title="Rapprochement indisponible" /><div className="boundary-banner large-boundary"><LockKeyhole size={19} /><span><b>Ce lot est composé de documents indépendants.</b><br />Le rapprochement inter-document est désactivé. Chaque pièce doit être examinée isolément ; aucune correspondance n’est calculée ni affichée.</span></div><Link href={`/analyses/${analysis.id}`} className="button button-outline"><ArrowLeft size={16} /> Revenir à la revue</Link></div>;
  const docs=analysis.documents.slice(0,5);
  function addField(e:FormEvent){e.preventDefault(); if(custom.trim()&&!fields.includes(custom.trim()))setFields([...fields,custom.trim()]);setCustom('');}
  return <div className="page-wrap fade-up"><PageHeading eyebrow="RAPPROCHEMENT CIRCONSCRIT" title={analysis.title} detail="Lecture croisée réservée aux pièces de ce dossier de subvention." right={<ModeTag mode={analysis.mode} />} /><DetailNav analysis={analysis} current="compare" /><div className="boundary-banner"><ShieldCheck size={17} /><span>Comparaison limitée à ce dossier et à ses <b>cinq pièces maximum</b>. Les valeurs absentes ne sont pas inférées.</span></div>
    <section className="surface compare-card"><div className="compare-head"><div><p className="eyebrow">GRILLE DE COHÉRENCE</p><h2>Valeurs par pièce</h2><span>Les données ci-dessous sont les champs modifiables saisis par l’analyste.</span></div><span className="mono compare-count">{docs.length} / 5 pièces</span></div>
      {docs.length ? <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>CHAMP</th>{docs.map((d,i)=><th key={d.id}><span className="mono">PIÈCE {String(i+1).padStart(2,'0')}</span><b>{d.fileName}</b></th>)}</tr></thead><tbody>{fields.map(f=><tr key={f}><th>{f}<small>Valeur relevée</small></th>{docs.map(d=><td key={`${f}-${d.id}`}>{fieldLabel(d,f)}</td>)}</tr>)}</tbody></table></div> : <EmptyState title="Pièces non disponibles" detail="Ce dossier ne contient encore aucune pièce." />}
      {docs.length > 0 && <form onSubmit={addField} className="add-field-form"><label htmlFor="compare-field">Ajouter un champ à vérifier</label><div><input id="compare-field" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="Ex. adresse déclarée" data-testid="input-compare-field" /><Button type="submit" kind="outline" data-testid="button-add-compare-field"><Plus size={14} /> Ajouter</Button></div></form>}
      <div className="compare-caveat"><Info size={15} /> Une différence peut avoir une explication légitime. Cette grille n’établit aucun verdict.</div>
    </section>
  </div>;
}
const conclusionOptions: {value: AnalysisConclusion | null; title:string; detail:string}[]=[
  {value:'Conforme',title:'Conforme',detail:'Les éléments examinés sont cohérents au regard des vérifications effectuées.'},
  {value:'Douteux',title:'Douteux',detail:'Un ou plusieurs signaux restent à clarifier.'},
  {value:'Fraude probable',title:'Fraude probable',detail:'Des éléments étayés justifient cette appréciation de l’analyste.'},
  {value:'Informations complémentaires nécessaires',title:'Informations complémentaires nécessaires',detail:'La revue ne permet pas encore de conclure.'},
];
function pageForValue(document: Document, value?: string | null) {
  if (document.mimeType.startsWith('image/')) return 1;
  if (!value || !document.extractedText) return null;
  const text = document.extractedText;
  const index = text.indexOf(value);
  if (index < 0) return null;
  const pageMarkers = [...text.matchAll(/\[Page (\d+)[^\]]*\]/g)];
  const page = pageMarkers.filter((marker) => (marker.index ?? -1) <= index).at(-1);
  return page ? Number(page[1]) : null;
}

function documentFindings(analysis: AnalysisDetail, document?: Document) {
  const documents = document ? [document] : analysis.documents;
  const automatedControls = documents.flatMap((item) => {
    const checks = item.controlStatus as Record<string, unknown>;
    const auto = checks.autoAnalysis && typeof checks.autoAnalysis === 'object'
      ? checks.autoAnalysis as Record<string, unknown>
      : {};
    const fileSignature = checks.fileSignature && typeof checks.fileSignature === 'object'
      ? checks.fileSignature as Record<string, unknown>
      : {};
    const pdfSignature = asRecord(checks.pdfSignature);
    const frenchRegistry = asRecord(checks.frenchRegistry);
    const ocr = checks.ocr && typeof checks.ocr === 'object'
      ? checks.ocr as Record<string, unknown>
      : {};
    const observations: string[] = [
      `Détection automatique du type : ${item.category}${typeof auto.typeConfidence === 'number' && auto.typeConfidence > 0 ? ` (indice lexical ${auto.typeConfidence} %, non probabiliste)` : ' (type non reconnu par les règles locales)'} [${item.fileName}]`,
      `Extraction : ${item.pageCount} page(s), ${item.extractedText?.length ?? 0} caractères relevés [${item.fileName}]`,
    ];
    if (fileSignature.status === 'performed') {
      observations.push(`Contrôle du format : signature de fichier compatible avec ${item.mimeType} [${item.fileName}]`);
    }
    if (pdfSignature && typeof pdfSignature.message === 'string') {
      observations.push(`Vérification locale de signature PDF (${String(pdfSignature.status)}): ${pdfSignature.message}${typeof pdfSignature.signer === 'string' ? ` Signataire : ${pdfSignature.signer}.` : ''}${typeof pdfSignature.signedAt === 'string' ? ` Date indiquée : ${pdfSignature.signedAt}.` : ''}${typeof pdfSignature.signaturesFound === 'number' ? ` Signatures trouvées : ${pdfSignature.signaturesFound}.` : ''} [${item.fileName}]`);
    }
    if (frenchRegistry && typeof frenchRegistry.message === 'string') {
      observations.push(`Registre officiel français (${String(frenchRegistry.status)}): ${frenchRegistry.message}${typeof frenchRegistry.name === 'string' ? ` Entité : ${frenchRegistry.name}.` : ''}${typeof frenchRegistry.identifier === 'string' ? ` Identifiant : ${frenchRegistry.identifier}.` : ''}${typeof frenchRegistry.checkedAt === 'string' ? ` Consulté le ${frenchRegistry.checkedAt}.` : ''} Source : ${typeof frenchRegistry.source === 'string' ? frenchRegistry.source : 'annuaire-entreprises.data.gouv.fr'}. [${item.fileName}]`);
    }
    if (typeof ocr.method === 'string') {
      observations.push(`Méthode d’extraction : ${ocr.method}${typeof ocr.confidence === 'number' ? `, confiance OCR ${ocr.confidence} %` : ''} [${item.fileName}]`);
    }
    return observations;
  });
  const observations = analysis.observations
    .filter((observation) => document
      ? observation.documentId === document.id
      : true)
    .map((observation) => {
      const source = documents.find((item) => item.id === observation.documentId);
      const page = observation.page ?? (source ? pageForValue(source, observation.observedValue) : null);
      const location = [
        source?.fileName,
        page ? `page ${page}` : null,
      ].filter(Boolean).join(', ');
      return `${observation.classification} — ${observation.description}${observation.observedValue ? ` (valeur : ${observation.observedValue})` : ''}${location ? ` [${location}]` : ''}`;
    });
  const candidates = documents.flatMap((item) =>
    Object.entries(item.extractedFields || {}).map(([field, value]) => {
      const displayedValue = Array.isArray(value) ? value.join(' / ') : String(value ?? '');
      if (!displayedValue) return null;
      const page = pageForValue(item, displayedValue);
      return `Candidat OCR ${field} : ${displayedValue} [${item.fileName}${page ? `, page ${page}` : ''}, transcription à vérifier]`;
    }),
  ).filter((candidate): candidate is string => candidate !== null);
  const automaticReview = readAutomaticReviewResult(analysis, document?.id);
  const aiFindings = automaticReview?.findings
    .filter((finding) => !document || finding.documentName === document.fileName)
    .map((finding) =>
      `Suggestion IA locale ${finding.classification}${finding.page ? ` · page ${finding.page}` : ''}${finding.field ? ` · ${finding.field}` : ''} — « ${finding.excerpt} » : ${finding.explanation} [${finding.documentName}]`,
    ) ?? [];
  const findings = [...automatedControls, ...observations, ...aiFindings, ...candidates].slice(0, 30);
  return findings.length
    ? findings.join('\n')
    : 'Aucun fait ni candidat de champ exploitable enregistré. Examiner visuellement la pièce et consigner les contrôles effectués.';
}

function riskScenario(analysis: AnalysisDetail, document?: Document): string {
  const automaticReview = readAutomaticReviewResult(analysis, document?.id);
  if (automaticReview) return automaticReview.riskScenario;
  if (document) {
    const status = document.controlStatus as Record<string, unknown>;
    const auto = status.autoAnalysis && typeof status.autoAnalysis === 'object'
      ? status.autoAnalysis as Record<string, unknown>
      : {};
    return typeof auto.riskScenario === 'string'
      ? auto.riskScenario
      : `Scénario à examiner pour cette pièce ${document.category || 'document'} : altération, substitution ou incohérence possible. Ce scénario n’est pas une détection ni une conclusion.`;
  }
  const scenarios = [...new Set(analysis.documents.map((item) => riskScenario(analysis, item)))];
  return analysis.mode === 'subsidy'
    ? `Scénarios à examiner dans ce dossier lié : ${scenarios.join(' ')} Les écarts entre pièces sont des signaux à contextualiser, pas des conclusions.`
    : 'Examiner chaque document séparément ; aucun rapprochement entre pièces indépendantes n’est effectué.';
}

function suggestedReviewForDocument(document: Document) {
  const profileStatus = document.controlStatus as Record<string, unknown>;
  const auto = profileStatus.autoAnalysis && typeof profileStatus.autoAnalysis === 'object'
    ? profileStatus.autoAnalysis as Record<string, unknown>
    : {};
  return suggestedReview({
    category: typeof auto.documentType === 'string' ? auto.documentType : document.category,
    confidence: typeof auto.typeConfidence === 'number' ? auto.typeConfidence : 0,
    riskScenario: typeof auto.riskScenario === 'string' ? auto.riskScenario : '',
  });
}

type AutomaticReviewResultView = {
  riskScenario: string;
  conclusionSuggestion: AnalysisConclusion;
  rationale: string;
  alternativeExplanation: string;
  additionalVerification: string;
  operationalAction: string;
  findings: Array<{
    documentName: string;
    classification: string;
    page: number | null;
    field: string | null;
    value: string | null;
    excerpt: string;
    explanation: string;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readAutomaticReviewResult(
  analysis: AnalysisDetail,
  documentId?: string,
): AutomaticReviewResultView | null {
  const saved = asRecord(analysis.automaticReview);
  if (!saved) return null;
  let rawResult: unknown;
  if (analysis.mode === 'subsidy') {
    rawResult = saved.overall;
  } else {
    const documents = Array.isArray(saved.documents) ? saved.documents : [];
    const matched = documents
      .map(asRecord)
      .find((entry) => entry?.documentId === documentId);
    rawResult = matched?.result;
  }
  const result = asRecord(rawResult);
  if (
    !result ||
    typeof result.riskScenario !== 'string' ||
    typeof result.conclusionSuggestion !== 'string' ||
    typeof result.rationale !== 'string' ||
    typeof result.alternativeExplanation !== 'string' ||
    typeof result.additionalVerification !== 'string' ||
    typeof result.operationalAction !== 'string' ||
    !Array.isArray(result.findings)
  ) return null;
  const validConclusions = [
    'Conforme',
    'Douteux',
    'Fraude probable',
    'Informations complémentaires nécessaires',
  ];
  if (!validConclusions.includes(result.conclusionSuggestion)) return null;
  const findings = result.findings
    .map(asRecord)
    .filter((finding): finding is Record<string, unknown> =>
      Boolean(finding && typeof finding.documentName === 'string' &&
        typeof finding.classification === 'string' &&
        typeof finding.excerpt === 'string' &&
        typeof finding.explanation === 'string'),
    )
    .map((finding) => ({
      documentName: String(finding.documentName),
      classification: String(finding.classification),
      page: typeof finding.page === 'number' ? finding.page : null,
      field: typeof finding.field === 'string' ? finding.field : null,
      value: typeof finding.value === 'string' ? finding.value : null,
      excerpt: String(finding.excerpt),
      explanation: String(finding.explanation),
    }));
  if (!findings.length) return null;
  return {
    riskScenario: result.riskScenario,
    conclusionSuggestion: result.conclusionSuggestion as AnalysisConclusion,
    rationale: result.rationale,
    alternativeExplanation: result.alternativeExplanation,
    additionalVerification: result.additionalVerification,
    operationalAction: result.operationalAction,
    findings,
  };
}

function AutomaticReviewButton({ analysis }: { analysis: AnalysisDetail }) {
  const qc = useQueryClient();
  const runReview = useRunAutomaticReview();
  const [message, setMessage] = useState('');
  async function run() {
    setMessage('');
    try {
      await runReview.mutateAsync({ analysisId: analysis.id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysis.id) }),
        qc.invalidateQueries({ queryKey: getListAnalysesQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetAnalysisDashboardQueryKey() }),
      ]);
      setMessage('Analyse IA locale terminée. La conclusion et les éléments du rapport ont été enregistrés automatiquement ; vous pouvez les corriger.');
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : 'Analyse impossible. Démarrez Ollama et vérifiez que le modèle est installé.');
    }
  }
  return <div className="automatic-review-control"><Button kind="outline" onClick={() => void run()} disabled={runReview.isPending} data-testid="button-run-automatic-review"><ScanLine size={15} />{runReview.isPending ? 'Analyse IA en cours…' : analysis.automaticReview ? 'Relancer l’analyse IA locale' : 'Analyser avec l’IA locale'}</Button>{message && <span className={`automatic-review-message ${message.includes('terminée') ? '' : 'form-error'}`} role={message.includes('terminée') ? 'status' : 'alert'}>{message}</span>}</div>;
}

function AutomaticReviewCard({
  result,
  onApply,
}: {
  result: AutomaticReviewResultView;
  onApply?: () => void;
}) {
  return <section className="surface automatic-review-card">
    <div className="automatic-review-card-heading"><div><p className="eyebrow">CONCLUSION IA LOCALE · MODIFIABLE</p><h3>Conclusion proposée : {result.conclusionSuggestion}</h3></div><span className="classification-tag tag-hypothesis">Analyse automatisée</span></div>
    <p className="automatic-review-scenario">{result.riskScenario}</p>
    <h4>Faits, signaux et citations localisées</h4>
    <div className="automatic-review-findings">{result.findings.map((finding, index) => <article key={`${finding.documentName}-${index}`}><b>{finding.classification} · {finding.documentName}{finding.page ? ` · page ${finding.page}` : ''}{finding.field ? ` · ${finding.field}` : ''}</b><blockquote>« {finding.excerpt} »</blockquote><p>{finding.explanation}{finding.value ? ` · Valeur : ${finding.value}` : ''}</p></article>)}</div>
    <div className="automatic-suggestions"><p><b>Justification :</b> {result.rationale}</p><p><b>Alternative :</b> {result.alternativeExplanation}</p><p><b>Vérification :</b> {result.additionalVerification}</p><p><b>Action :</b> {result.operationalAction}</p></div>
    {onApply && <Button kind="outline" onClick={onApply}>Reprendre les textes générés</Button>}
  </section>;
}

function exportRows(analysis: AnalysisDetail) {
  const headers = [
    'Document / dossier',
    'Conclusion',
    'Risque possible + éléments / contrôles',
    'Doute / alternative + vérification',
    'Action recommandée',
  ];
  const overallReview = readAutomaticReviewResult(analysis);
  const subsidySuggestions = [...new Set(analysis.documents.map((document) => {
    const profileStatus = document.controlStatus as Record<string, unknown>;
    const auto = profileStatus.autoAnalysis && typeof profileStatus.autoAnalysis === 'object'
      ? profileStatus.autoAnalysis as Record<string, unknown>
      : {};
    return suggestedReview({
      category: typeof auto.documentType === 'string' ? auto.documentType : document.category,
      confidence: typeof auto.typeConfidence === 'number' ? auto.typeConfidence : 0,
      riskScenario: typeof auto.riskScenario === 'string' ? auto.riskScenario : '',
    });
  }))];
  const alternativeAndVerification = analysis.mode === 'subsidy'
    ? [
      analysis.conclusionRationale,
      overallReview
        ? `Conclusion proposée par l’IA locale : ${overallReview.conclusionSuggestion}\nJustification : ${overallReview.rationale}`
        : null,
      analysis.alternativeExplanation || overallReview?.alternativeExplanation || `Suggestion automatique à valider : ${subsidySuggestions.map((suggestion) => suggestion.alternative).join(' ')}`,
      analysis.additionalVerification || overallReview?.additionalVerification || `Suggestion automatique à valider : ${subsidySuggestions.map((suggestion) => suggestion.verification).join(' ')}`,
    ].filter(Boolean).join('\n')
    : '';
  const rows = analysis.mode === 'subsidy'
    ? [[
      analysis.title,
      analysis.conclusion ?? '',
      `${riskScenario(analysis)}\n${documentFindings(analysis)}`,
      alternativeAndVerification,
      analysis.operationalAction || overallReview?.operationalAction || 'Demander un original lisible si nécessaire, documenter les contrôles réalisés et communiquer une décision motivée selon la procédure applicable.',
    ]]
    : analysis.documents.map((document) => {
      const aiReview = readAutomaticReviewResult(analysis, document.id);
      return [
      document.fileName,
      document.reviewConclusion ?? '',
      `${riskScenario(analysis, document)}\n${documentFindings(analysis, document)}${aiReview ? `\nConclusion proposée par l’IA locale (non validée) : ${aiReview.conclusionSuggestion}` : ''}`,
      [
        document.reviewRationale,
        aiReview ? `Justification proposée par l’IA locale : ${aiReview.rationale}` : null,
        document.reviewAlternativeExplanation || aiReview?.alternativeExplanation || 'Suggestion automatique à valider : une différence peut provenir d’une erreur OCR, d’une correction ou d’une version révisée.',
        document.reviewVerification || aiReview?.additionalVerification || 'Suggestion automatique à valider : vérifier les valeurs sur l’original et confirmer auprès de l’émetteur par un canal indépendant.',
      ].filter(Boolean).join('\n'),
      document.reviewAction || aiReview?.operationalAction || 'Demander un original lisible si nécessaire et documenter les contrôles réalisés.',
    ];
  });
  return { headers, rows };
}

function IndependentDocumentReview({ analysis, document }: { analysis: AnalysisDetail; document: Document }) {
  const qc = useQueryClient();
  const update = useUpdateDocument();
  const [conclusion, setConclusion] = useState<AnalysisConclusion>(document.reviewConclusion);
  const [rationale, setRationale] = useState(document.reviewRationale ?? '');
  const [alternative, setAlternative] = useState(document.reviewAlternativeExplanation ?? '');
  const [verification, setVerification] = useState(document.reviewVerification ?? '');
  const [action, setAction] = useState(document.reviewAction ?? '');
  const [message, setMessage] = useState('');
  const automatedRisk = riskScenario(analysis, document);
  const automaticSuggestions = suggestedReviewForDocument(document);
  const automaticReview = readAutomaticReviewResult(analysis, document.id);

  function applyAutomaticSuggestions() {
    if (!automaticReview) return;
    setConclusion(automaticReview.conclusionSuggestion);
    setRationale(automaticReview.rationale);
    setAlternative(automaticReview.alternativeExplanation);
    setVerification(automaticReview.additionalVerification);
    setAction(automaticReview.operationalAction);
    setMessage('Textes repris. Vous pouvez modifier cette revue indépendamment.');
  }

  useEffect(() => {
    setConclusion(document.reviewConclusion);
    setRationale(document.reviewRationale ?? '');
    setAlternative(document.reviewAlternativeExplanation ?? '');
    setVerification(document.reviewVerification ?? '');
    setAction(document.reviewAction ?? '');
  }, [document.id, document.reviewConclusion, document.reviewRationale, document.reviewAlternativeExplanation, document.reviewVerification, document.reviewAction]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    if (conclusion && !rationale.trim()) {
      setMessage('Ajoutez une justification pour enregistrer cette conclusion.');
      return;
    }
    try {
      await update.mutateAsync({
        documentId: document.id,
        data: {
          reviewConclusion: conclusion,
          reviewRationale: rationale,
          reviewAlternativeExplanation: alternative,
          reviewVerification: verification,
          reviewAction: action,
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysis.id) }),
        qc.invalidateQueries({ queryKey: getListAnalysesQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetAnalysisDashboardQueryKey() }),
      ]);
      setMessage('Revue de cette pièce enregistrée.');
    } catch {
      setMessage('Enregistrement impossible. Vérifiez la connexion et réessayez.');
    }
  }

  return <form className="surface independent-doc-review" onSubmit={save}>
    <div className="independent-doc-heading">
      <div><p className="eyebrow">{document.category || 'DOCUMENT'}</p><h2>{document.fileName}</h2></div>
      <span className="status-tag">{document.reviewConclusion || 'À examiner'}</span>
    </div>
    <div className="independent-evidence"><h3>Scénario de risque à examiner — pas un verdict</h3><p>{automatedRisk}</p><h3>Faits et contrôles automatiquement relevés</h3><pre>{documentFindings(analysis, document)}</pre><h3>Suggestions automatiques</h3><p><b>Alternative :</b> {automaticSuggestions.alternative}</p><p><b>Vérification :</b> {automaticSuggestions.verification}</p><p><b>Action :</b> {automaticSuggestions.action}</p></div>
    {automaticReview && <AutomaticReviewCard result={automaticReview} onApply={applyAutomaticSuggestions} />}
    <section className="conclusion-section"><div className="section-heading-inline"><span className="section-index">01</span><div><h3>Conclusion automatique</h3><p>Conclusion IA enregistrée pour cette pièce uniquement ; correction facultative.</p></div></div>
      <div className="conclusion-options">{conclusionOptions.map((option) => <button key={option.value} type="button" className={`conclusion-option ${conclusion === option.value ? 'conclusion-selected' : ''}`} onClick={() => setConclusion(conclusion === option.value ? null : option.value)}><span className="conclusion-radio">{conclusion === option.value && <span />}</span><span><b>{option.title}</b><small>{option.detail}</small></span></button>)}</div>
    </section>
    <label>Justification{conclusion && ' (requise pour enregistrer une correction)'}<textarea required={!!conclusion} maxLength={5000} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="La justification générée apparaîtra après l’analyse IA locale." /></label>
    <label>Explication alternative<textarea maxLength={5000} value={alternative} onChange={(event) => setAlternative(event.target.value)} placeholder="Une explication légitime possible à vérifier." /></label>
    <label>Vérification complémentaire<textarea maxLength={5000} value={verification} onChange={(event) => setVerification(event.target.value)} placeholder="À vérifier, déjà vérifié ou impossible ; précisez l’état réel." /></label>
    <label>Action recommandée<textarea maxLength={2000} value={action} onChange={(event) => setAction(event.target.value)} placeholder="Prochaine étape pour cette pièce." /></label>
    {message && <div className={`form-message ${message.includes('impossible') || message.includes('requise') ? 'form-error' : ''}`} role="status">{message}</div>}
    <div className="report-submit"><Button type="submit" disabled={update.isPending}>{update.isPending ? 'Enregistrement…' : 'Enregistrer cette revue'}</Button></div>
  </form>;
}

function IndependentBatchReport({ analysis }: { analysis: AnalysisDetail }) {
  const { headers } = exportRows(analysis);
  return <div className="page-wrap fade-up"><PageHeading eyebrow="REVUE INDIVIDUELLE" title={analysis.title} detail="Chaque document possède sa propre conclusion, sa justification, son alternative, sa vérification et son action." right={<div className="report-header-actions"><AutomaticReviewButton analysis={analysis} /><ExportActions analysis={analysis} /></div>} /><DetailNav analysis={analysis} current="report" />
    <div className="boundary-banner"><LockKeyhole size={17} /><span>Lot indépendant : les résultats et conclusions restent isolés document par document. Aucun rapprochement entre pièces n’est réalisé.</span></div>
    <div className="independent-review-list">{analysis.documents.map((document) => <IndependentDocumentReview key={document.id} analysis={analysis} document={document} />)}</div>
    <p className="export-scope-note">{headers.length} colonnes d’export · {analysis.documents.length} document(s) · une ligne distincte par pièce.</p>
  </div>;
}

function ExportActions({ analysis }: { analysis: AnalysisDetail }) {
  const [error, setError] = useState('');
  async function exportExcel() {
    try {
      const { headers, rows } = exportRows(analysis);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Finovox';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('Synthèse');
      sheet.addRow(headers);
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F3A5F' } };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      rows.forEach((row) => sheet.addRow(row));
      sheet.columns = headers.map((header, index) => ({
        key: header,
        width: index === 0 ? 30 : index === 2 || index === 3 ? 64 : 36,
        style: { alignment: { wrapText: true, vertical: 'top' } },
      }));
      for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
        sheet.getRow(rowIndex).eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'D9E2EC' } },
            left: { style: 'thin', color: { argb: 'D9E2EC' } },
            bottom: { style: 'thin', color: { argb: 'D9E2EC' } },
            right: { style: 'thin', color: { argb: 'D9E2EC' } },
          };
        });
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `finovox-${analysis.id}-export.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setError('');
    } catch {
      setError('L’export Excel a échoué. Réessayez.');
    }
  }
  function exportCsv() {
    try {
      const { headers, rows } = exportRows(analysis);
      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
        .join('\r\n');
      const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `finovox-${analysis.id}-export.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setError('');
    } catch {
      setError('L’export CSV a échoué. Réessayez.');
    }
  }
  return <div className="export-actions"><Button kind="outline" onClick={() => void exportExcel()} data-testid="button-export-excel"><ArrowDownToLine size={16} /> Exporter Excel</Button><Button kind="outline" onClick={exportCsv} data-testid="button-export-csv"><ArrowDownToLine size={16} /> Exporter CSV</Button>{error && <span className="inline-error" role="alert">{error}</span>}</div>;
}

function ReportPage({ analysis }: { analysis: AnalysisDetail }) {
  if (analysis.mode === 'independent_batch') return <IndependentBatchReport analysis={analysis} />;
  return <SubsidyReportPage analysis={analysis} />;
}

function SubsidyReportPage({ analysis }: { analysis: AnalysisDetail }) {
  const qc=useQueryClient(); const update=useUpdateAnalysis(); const [conclusion,setConclusion]=useState<AnalysisConclusion>(analysis.conclusion); const [rationale,setRationale]=useState(analysis.conclusionRationale||''); const [alternative,setAlternative]=useState(analysis.alternativeExplanation||''); const [verification,setVerification]=useState(analysis.additionalVerification||''); const [action,setAction]=useState(analysis.operationalAction||''); const [message,setMessage]=useState('');
  useEffect(()=>{setConclusion(analysis.conclusion);setRationale(analysis.conclusionRationale||'');setAlternative(analysis.alternativeExplanation||'');setVerification(analysis.additionalVerification||'');setAction(analysis.operationalAction||'');},[analysis.id,analysis.conclusion,analysis.conclusionRationale,analysis.alternativeExplanation,analysis.additionalVerification,analysis.operationalAction]);
  async function save(e:FormEvent) { e.preventDefault(); setMessage(''); if(conclusion&&!rationale.trim()){setMessage('Ajoutez une justification pour enregistrer cette conclusion.');return;} try { await update.mutateAsync({analysisId:analysis.id,data:{conclusion,conclusionRationale:rationale,alternativeExplanation:alternative,additionalVerification:verification,operationalAction:action,status:conclusion?'completed':'in_review'}}); await Promise.all([qc.invalidateQueries({queryKey:getGetAnalysisQueryKey(analysis.id)}),qc.invalidateQueries({queryKey:getListAnalysesQueryKey()}),qc.invalidateQueries({queryKey:getGetAnalysisDashboardQueryKey()})]);setMessage('Modifications enregistrées.'); } catch {setMessage('Enregistrement impossible. Réessayez.');} }
  const suggestedAlternatives = [...new Set(analysis.documents.map((document) => suggestedReviewForDocument(document).alternative))];
  const suggestedVerifications = [...new Set(analysis.documents.map((document) => suggestedReviewForDocument(document).verification))];
  const automaticReview = readAutomaticReviewResult(analysis);
  function applyAutomaticSuggestions() {
    if (!automaticReview) return;
    setConclusion(automaticReview.conclusionSuggestion);
    setRationale(automaticReview.rationale);
    setAlternative(automaticReview.alternativeExplanation);
    setVerification(automaticReview.additionalVerification);
    setAction(automaticReview.operationalAction);
    setMessage('Suggestions reprises. Vous pouvez les modifier puis enregistrer vos changements.');
  }
  return <div className="page-wrap fade-up"><PageHeading eyebrow="CONCLUSION AUTOMATIQUE DU DOSSIER" title={analysis.title} detail="L’IA propose une conclusion après analyse du dossier ; l’analyste peut la corriger, sans validation manuelle obligatoire." right={<div className="report-header-actions"><AutomaticReviewButton analysis={analysis} /><ExportActions analysis={analysis} /></div>} /><DetailNav analysis={analysis} current="report" />
    <section className="surface automatic-analysis-summary"><p className="eyebrow">ANALYSE AUTOMATIQUE LOCALE · DOSSIER DE 5 PIÈCES</p><h2>Scénarios, faits et contrôles relevés</h2><p>La détection a extrait le texte, proposé le type de chaque pièce et exécuté les contrôles locaux affichés ci-dessous. Les scénarios décrivent des risques possibles ; ils ne signifient pas qu’une anomalie ou une fraude a été détectée.</p><pre>{documentFindings(analysis)}</pre><div className="automatic-suggestions"><p><b>Explications alternatives possibles :</b> {automaticReview?.alternativeExplanation || suggestedAlternatives.join(' ')}</p><p><b>Vérifications suggérées :</b> {automaticReview?.additionalVerification || suggestedVerifications.join(' ')}</p></div></section>
    {automaticReview && <AutomaticReviewCard result={automaticReview} onApply={applyAutomaticSuggestions} />}
    <div className="report-layout"><form className="report-form" onSubmit={save}>
      <section className="surface conclusion-section"><div className="section-heading-inline"><span className="section-index">01</span><div><h2>Conclusion proposée</h2><p>Générée par l’IA locale et modifiable si nécessaire.</p></div></div><div className="conclusion-options">{conclusionOptions.map(o => {
        const optionValue = o.value ?? 'none';
        const dataName = optionValue === 'Fraude probable' ? 'fraude' : optionValue === 'Informations complémentaires nécessaires' ? 'information' : optionValue.toLowerCase();
        return <button key={optionValue} type="button" className={`conclusion-option ${conclusion===o.value?'conclusion-selected':''}`} onClick={()=>setConclusion(conclusion===o.value?null:o.value)} data-testid={`button-conclusion-${dataName}`}><span className="conclusion-radio">{conclusion===o.value&&<span />}</span><span><b>{o.title}</b><small>{o.detail}</small></span></button>;
      })}</div></section>
      <section className="surface rationale-section"><div className="section-heading-inline"><span className="section-index">02</span><div><h2>Justification</h2><p>Les éléments cités par l’IA sont conservés et vérifiables dans le dossier.</p></div></div><textarea required={!!conclusion} maxLength={5000} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="La justification générée apparaîtra après l’analyse IA locale." data-testid="textarea-conclusion-rationale" /><div className="textarea-counter mono">{rationale.length} / 5000</div></section>
      <section className="surface supplemental-section"><div className="section-heading-inline"><span className="section-index">03</span><div><h2>Éléments à distinguer</h2><p>Consignez les explications concurrentes et les vérifications à mener.</p></div></div><label>Explication alternative<textarea maxLength={5000} value={alternative} onChange={e=>setAlternative(e.target.value)} placeholder="Une explication plausible qui mérite d’être examinée." data-testid="textarea-alternative-explanation" /></label><label>Vérification complémentaire<textarea maxLength={5000} value={verification} onChange={e=>setVerification(e.target.value)} placeholder="À vérifier, déjà vérifié, ou impossible — précisez l’état réel." data-testid="textarea-additional-verification" /></label><label>Recommandation opérationnelle<textarea maxLength={2000} value={action} onChange={e=>setAction(e.target.value)} placeholder="Prochaine étape suggérée pour le traitement du dossier." data-testid="textarea-operational-action" /></label></section>
      {message && <div className={`form-message ${message.includes('impossible')||message.includes('requise')?'form-error':''}`} role="status">{message.includes('requise')||message.includes('impossible')?<AlertCircle size={16}/>:<CheckCircle2 size={16}/>} {message}</div>}
      <div className="report-submit"><Button type="submit" disabled={update.isPending} data-testid="button-save-conclusion">{update.isPending?'Enregistrement…':<>Enregistrer la conclusion <ArrowRight size={16}/></>}</Button></div>
    </form><aside className="report-aside">    <div className="human-validation"><span><Shield size={20}/></span><h3>Analyse automatique</h3><p>Après analyse, Finovox enregistre une conclusion IA et ses éléments justificatifs. L’analyste peut modifier le résultat ; sa validation n’est pas requise pour obtenir le rapport.</p></div><div className="export-note"><FileCheck2 size={19}/><div><b>Export tableur</b><p>Une ligne avec une conclusion globale pour ce dossier de subvention.</p><small>Export Excel et CSV en français.</small></div></div><div className="report-scope"><span className="mono">PÉRIMÈTRE</span><b>1 ligne · dossier complet</b><small>Cinq pièces liées et une conclusion globale.</small></div></aside></div>
  </div>;
}

function HistoryPage() {
  const {data, isLoading,isError,refetch}=useListAnalyses(); const remove=useDeleteAnalysis(); const qc=useQueryClient(); const [search,setSearch]=useState('');
  const rows=useMemo(()=>data?.filter(a=>a.title.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))||[],[data,search]);
  async function deleteRow(a:Analysis){if(!window.confirm(`Supprimer le dossier « ${a.title} » et ses pièces privées ? Cette action est définitive.`))return;try{await remove.mutateAsync({analysisId:a.id});await Promise.all([qc.invalidateQueries({queryKey:getListAnalysesQueryKey()}),qc.invalidateQueries({queryKey:getGetAnalysisDashboardQueryKey()})]);}catch{window.alert('La suppression a échoué. Réessayez.');}}
  return <div className="page-wrap fade-up"><PageHeading eyebrow="DOSSIERS ENREGISTRÉS" title="Historique" detail="Retrouvez les analyses sauvegardées dans votre espace privé." right={<Link href="/analyses/new" className="button button-primary"><Plus size={16}/> Nouvelle analyse</Link>} />
    <div className="history-toolbar"><label className="search-field"><Search size={16}/><input type="search" placeholder="Rechercher un dossier…" value={search} onChange={e=>setSearch(e.target.value)} data-testid="input-search-history" /></label><span className="mono history-count">{data?.length ?? '—'} DOSSIER{data?.length===1?'':'S'}</span></div>
    {isLoading?<LoadingBlock lines={5}/>:isError?<ErrorPanel retry={()=>void refetch()}/>:rows.length?<div className="surface table-wrap"><table className="analysis-table"><thead><tr><th>DOSSIER</th><th>MODE</th><th>PIÈCES</th><th>ÉTAT</th><th>CONCLUSION</th><th>MODIFIÉ</th><th /></tr></thead><tbody>{rows.map(a=><tr key={a.id} data-testid={`row-history-${a.id}`}><td><Link href={`/analyses/${a.id}`} className="analysis-title">{a.title}</Link><span className="analysis-date mono">Créé le {new Date(a.createdAt).toLocaleDateString('fr-FR')}</span></td><td><ModeTag mode={a.mode}/></td><td className="mono">{a.documentCount}</td><td><StatusTag status={a.status}/></td><td>{a.conclusion||<span className="muted-text">—</span>}</td><td className="history-date">{new Date(a.updatedAt).toLocaleDateString('fr-FR')}</td><td><div className="row-actions"><Link href={`/analyses/${a.id}`} className="row-arrow" aria-label="Ouvrir"><ArrowRight size={15}/></Link><button className="quiet-icon delete-icon" onClick={()=>void deleteRow(a)} disabled={remove.isPending} aria-label={`Supprimer ${a.title}`} data-testid={`button-delete-analysis-${a.id}`}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>:<EmptyState icon={Search} title={search?'Aucun résultat':'Aucun dossier enregistré'} detail={search?'Essayez un autre terme de recherche.':'Les analyses apparaîtront ici après leur création. Aucune donnée fictive n’est affichée.'} action={!search&&<Link href="/analyses/new" className="button button-primary"><Plus size={16}/> Créer une analyse</Link>} />}
  </div>;
}
function SettingsPage() {
  const {data:health,isLoading,isError,refetch}=useHealthCheck({query:{queryKey:getHealthCheckQueryKey(),refetchInterval:60000}});
  const ollamaQuery = useQuery({
    queryKey: ['ollama-status'],
    queryFn: async () => {
      const response = await fetch('/api/ollama-status');
      if (!response.ok) throw new Error(`Statut Ollama indisponible (HTTP ${response.status}).`);
      const payload: unknown = await response.json();
      const status = asRecord(payload);
      if (
        !status ||
        typeof status.model !== 'string' ||
        typeof status.running !== 'boolean' ||
        typeof status.modelInstalled !== 'boolean' ||
        typeof status.message !== 'string'
      ) throw new Error('La réponse de statut Ollama est invalide.');
      return {
        model: status.model,
        running: status.running,
        modelInstalled: status.modelInstalled,
        message: status.message,
      };
    },
    refetchInterval: 30000,
  });
  const ollamaState = ollamaQuery.data?.modelInstalled
    ? 'Prête'
    : ollamaQuery.data?.running
      ? 'Modèle à installer'
      : ollamaQuery.isError
        ? 'Statut indisponible'
        : 'Ollama arrêté';
  const ollamaDetail = ollamaQuery.data
    ? `${ollamaQuery.data.message} Modèle configuré : ${ollamaQuery.data.model}.`
    : ollamaQuery.error instanceof Error
      ? ollamaQuery.error.message
      : 'Vérification de la disponibilité du modèle local…';
  const verificationQuery = useQuery({
    queryKey: ['verification-status'],
    queryFn: async () => {
      const response = await fetch('/api/verification-status');
      if (!response.ok) throw new Error(`Statut des vérificateurs indisponible (HTTP ${response.status}).`);
      const payload: unknown = await response.json();
      const status = asRecord(payload);
      const signature = asRecord(status?.signatureVerifier);
      const registry = asRecord(status?.frenchRegistry);
      if (
        !signature ||
        typeof signature.available !== 'boolean' ||
        typeof signature.message !== 'string' ||
        !registry ||
        typeof registry.enabled !== 'boolean' ||
        typeof registry.message !== 'string'
      ) throw new Error('La réponse de statut des vérificateurs est invalide.');
      return {
        signatureAvailable: signature.available,
        signatureMessage: signature.message,
        registryEnabled: registry.enabled,
        registryMessage: registry.message,
      };
    },
    refetchInterval: 60000,
  });
  const signatureStatus = verificationQuery.data?.signatureAvailable
    ? 'Vérificateur prêt'
    : verificationQuery.isError
      ? 'Statut indisponible'
      : 'pdfsig à installer';
  const signatureDetail = verificationQuery.data?.signatureMessage
    ?? (verificationQuery.error instanceof Error
      ? verificationQuery.error.message
      : 'Vérification de la disponibilité de pdfsig…');
  const registryStatus = verificationQuery.data?.registryEnabled
    ? 'Automatique · Internet requis'
    : 'Indisponible';
  const registryDetail = verificationQuery.data?.registryMessage
    ?? 'Les SIREN/SIRET extraits sont recherchés dans l’API publique française ; les documents et le texte OCR ne sont pas transmis.';
  const rows=[
    ['Détection automatique locale','Active','OCR ou extraction PDF, classification lexicale du type de document, extraction de champs et contrôles de format, clés et dates. Résultats visibles et à confirmer sur l’original.'],
    ['IA générative locale (Ollama)',ollamaState,ollamaDetail],
    ['Signature électronique',signatureStatus,`${signatureDetail} Les signatures PDF sont vérifiées sur ce PC ; une chaîne de confiance non confirmée n’est jamais déclarée valide.`],
    ['Registres officiels français',registryStatus,registryDetail],
    ['Rapprochement indépendant','Conforme au cas d’usage','Les neuf documents indépendants restent séparés, chacun avec sa propre analyse. Le rapprochement est réservé aux cinq pièces d’un dossier de subvention.'],
  ];
  return <div className="page-wrap fade-up"><PageHeading eyebrow="ESPACE DE TRAVAIL" title="Configuration" detail="Disponibilité des outils et limites opérationnelles." />
    <div className="settings-grid"><section className="surface settings-section"><div className="settings-section-head"><div><p className="eyebrow">ÉTAT DES SERVICES</p><h2>Outils de revue</h2></div><span className={`service-status ${isLoading?'service-pending':health?.status==='ok'?'service-ok':'service-off'}`}><span />{isLoading?'Vérification':isError?'Indisponible':health?.status==='ok'?'API disponible':'État inconnu'}</span></div>{isError&&<div className="health-error"><span>Le statut des services n’a pas pu être vérifié.</span><button onClick={()=>void refetch()} data-testid="button-retry-health">Réessayer</button></div>}
      <div className="availability-list">{rows.map(([name,status,detail])=><div className="availability-row" key={name}><span className="availability-icon">{status.includes('installer')||status==='Ollama arrêté'||status==='Statut indisponible'||status==='Indisponible'?<CircleHelp size={17}/>:<ShieldAlert size={17}/>}</span><div><b>{name}</b><p>{detail}</p></div><span className="availability-state">{status}</span></div>)}</div>
    </section><aside className="settings-aside"><section className="surface privacy-settings"><span className="privacy-shield"><LockKeyhole size={19}/></span><p className="eyebrow">{localDemoMode ? 'MODE DE DÉMONSTRATION' : 'DONNÉES PRIVÉES'}</p><h3>{localDemoMode ? 'Démo sur cet appareil' : 'Accès à votre espace'}</h3><p>{localDemoMode ? 'Aucune authentification n’est active. Les fichiers restent sur ce PC. Utilisez uniquement des documents de test.' : 'Les analyses et fichiers requièrent une session authentifiée. Le contenu des documents n’est pas public.'}</p><div className="setting-foot"><span>Authentification</span><b>{localDemoMode ? 'Désactivée · démo locale uniquement' : 'Clerk · session sécurisée'}</b></div></section><section className="surface configuration-note"><Info size={18}/><div><b>Limites connues</b><p>L’OCR extrait des candidats ; il ne certifie pas l’authenticité. L’API française ne renvoie que ses données publiques et peut exclure des entreprises non diffusibles ; l’existence d’un SIREN/SIRET ne prouve pas l’authenticité d’une pièce ni le titulaire d’un compte. La revue de neuf documents indépendants reste isolée par document, conformément au cas d’usage.</p></div></section></aside></div>
  </div>;
}
function NotFound() { return <div className="not-found"><Brand/><span className="mono">ERREUR 404</span><h1 className="serif">Cette page n’existe pas.</h1><p>Le dossier demandé est introuvable ou n’est pas accessible.</p><Link href="/dashboard" className="button button-primary"><ArrowLeft size={15}/> Revenir à l’espace</Link></div>; }

function Router() {
  return <Switch>
    <Route path="/sign-in/*?">{localDemoMode ? <RedirectTo to="/dashboard" /> : <AuthPage type="in" />}</Route>
    <Route path="/sign-up/*?">{localDemoMode ? <RedirectTo to="/dashboard" /> : <AuthPage type="up" />}</Route>
    <Route path="/" component={ProductLanding} />
    <Route path="/dashboard"><AppShell><Dashboard/></AppShell></Route>
    <Route path="/analyses/new"><AppShell><NewAnalysis/></AppShell></Route>
    <Route path="/analyses/:id/compare"><AppShell><AnalysisPage section="compare"/></AppShell></Route>
    <Route path="/analyses/:id/report"><AppShell><AnalysisPage section="report"/></AppShell></Route>
    <Route path="/analyses/:id"><AppShell><AnalysisPage/></AppShell></Route>
    <Route path="/history"><AppShell><HistoryPage/></AppShell></Route>
    <Route path="/settings"><AppShell><SettingsPage/></AppShell></Route>
    <Route component={NotFound}/>
  </Switch>;
}
function ClerkCacheClear() {
  const { addListener } = useClerk(); const qc = useQueryClient(); const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => { const id = user?.id ?? null; if (previous.current !== undefined && previous.current !== id) qc.clear(); previous.current = id; }), [addListener, qc]);
  return null;
}
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}><ClerkCacheClear/><Router/></ClerkProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}>{localDemoMode ? <Router/> : <ClerkRoutes/>}</WouterRouter></QueryClientProvider>;
}
export default App;
