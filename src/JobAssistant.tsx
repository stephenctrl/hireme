import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, LoaderCircle, Search, Send, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { ChatMessage, ResumeDocument, UploadedSource } from '../shared/types';
import { JOB_COUNTRIES, type JobAssistantResponse, type JobCriteria, type JobListing, type JobSearchResponse, type SkillEvidence } from '../shared/jobs';
import { errorMessage, extractPdf, health, isJobCriteria, JOB_DOMAINS, requestJobAssistant, searchJobs } from './api';
import { Field } from './DocumentEditor';
import DocumentPreview from './DocumentPreview';
import { hasContent } from './document';
import './jobs.css';

interface Props {
  resumeDocument: ResumeDocument;
  cvDocument: ResumeDocument;
  resumeSource: UploadedSource | null;
  cvSource: UploadedSource | null;
  resetGeneration: number;
}
interface Attachment { label: string; document: ResumeDocument | null; source: UploadedSource | null }
type Status = 'checking' | 'ready' | 'missing' | 'offline';
const initialCriteria = (): JobCriteria => ({
  keywords: '', country: 'gb', location: '', salary: { minimum: null, maximum: null, currency: 'GBP', period: 'year' },
  modality: 'any', remoteEligibility: 'unspecified', remoteRegion: '', skills: [],
});
const criterionLabels = { role: 'Role', location: 'Location', salary: 'Salary', modality: 'Work modality', remoteEligibility: 'Remote eligibility', skills: 'Skills' };
const checkLabels = { not_requested: 'Not requested', matched: 'Matched', not_matched: 'Not matched', unverified: 'Unverified' };
function criteriaRows(criteria: JobCriteria): [string, string][] {
  return [
    ['Role / keywords', criteria.keywords || 'Any'], ['Provider country', JOB_COUNTRIES.find(item => item.code === criteria.country)?.label ?? criteria.country],
    ['Location', criteria.location || 'Any'], ['Salary minimum', criteria.salary.minimum === null ? 'Not set' : String(criteria.salary.minimum)],
    ['Salary maximum', criteria.salary.maximum === null ? 'Not set' : String(criteria.salary.maximum)], ['Currency', criteria.salary.currency], ['Pay period', criteria.salary.period],
    ['Work modality', criteria.modality], ['Remote eligibility', criteria.remoteEligibility], ['Restricted region', criteria.remoteRegion || 'Not set'], ['Skills', criteria.skills.join(', ') || 'Not set'],
  ];
}
function Evidence({ item }: { item: SkillEvidence }) {
  return <li><strong>{item.requirement}</strong><p>{item.explanation}</p><blockquote><span>Listing excerpt</span>{item.requirementQuote}</blockquote>{item.documentQuote !== null && <blockquote><span>Attached document</span>{item.documentQuote}</blockquote>}</li>;
}
function Salary({ listing }: { listing: JobListing }) {
  const salary = listing.salary;
  if (salary.provenance === 'predicted') return <p className="job-salary">Estimated salary omitted — not employer-published pay and not a verified match.</p>;
  if (salary.provenance === 'unknown' || (salary.minimum === null && salary.maximum === null)) return <p className="job-salary">Salary unknown — not a verified salary match.</p>;
  return <p className="job-salary"><strong>Published salary:</strong> {salary.minimum === null ? 'Minimum unknown' : salary.minimum.toLocaleString()} – {salary.maximum === null ? 'Maximum unknown' : salary.maximum.toLocaleString()} · {salary.currency ?? 'Currency unknown'} / {salary.period ?? 'period unknown'}</p>;
}

export default function JobAssistant({ resumeDocument, cvDocument, resumeSource, cvSource, resetGeneration }: Props) {
  const [criteria, setCriteria] = useState(initialCriteria);
  const [skillsInput, setSkillsInput] = useState('');
  const [result, setResult] = useState<JobSearchResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [includeResumeSource, setIncludeResumeSource] = useState(false);
  const [includeCvSource, setIncludeCvSource] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [pendingChat, setPendingChat] = useState('');
  const [proposal, setProposal] = useState<JobCriteria | null>(null);
  const [analyses, setAnalyses] = useState<JobAssistantResponse['analyses']>([]);
  const [analysisReply, setAnalysisReply] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [aiStatus, setAiStatus] = useState<Status>('checking');
  const [jobsStatus, setJobsStatus] = useState<Status>('checking');
  const operations = useRef({ search: 0, ai: 0, upload: 0 });
  const controllers = useRef<{ search?: AbortController; ai?: AbortController; upload?: AbortController }>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const healthGeneration = useRef(0);
  const stale = result !== null && JSON.stringify(result.criteria) !== JSON.stringify(criteria);
  const valid = isJobCriteria(criteria) && Boolean(criteria.keywords.trim() || criteria.skills.length) && (criteria.remoteEligibility !== 'restricted' || Boolean(criteria.remoteRegion.trim()));
  const hasAttachment = attachment !== null && (attachment.document !== null && hasContent(attachment.document) || Boolean(attachment.source?.text.trim()));
  const conversationFull = messages.length >= 20;
  const aiReady = aiStatus === 'ready' && valid && !aiBusy && !searchBusy && !uploadBusy;
  const previewQuery = { results_per_page: '20', what: [criteria.keywords, ...criteria.skills].map(item => item.trim()).filter(Boolean).join(' '), ...(criteria.location.trim() ? { where: criteria.location.trim() } : {}) };

  function cancel(operation: 'search' | 'ai' | 'upload') {
    operations.current[operation] += 1;
    controllers.current[operation]?.abort();
    if (operation === 'search') setSearchBusy(false);
    else if (operation === 'ai') { setAiBusy(false); setPendingChat(''); }
    else setUploadBusy(false);
  }
  function clearAnalysis() { setAnalyses([]); setAnalysisReply(''); setProposal(null); }
  function changeCriteria(next: JobCriteria) {
    cancel('search'); cancel('ai'); clearAnalysis(); setSelected([]); setCriteria(next); setError(''); setNotice('Criteria changed. Search explicitly to refresh results; previous results are not current criteria matches.');
  }
  function resetConversation() {
    cancel('ai'); setMessages([]); setChatInput(''); clearAnalysis(); setError(''); setNotice('Job conversation, proposals, and analyses cleared. Criteria, results, and attachment are unchanged.');
  }
  function changeAttachment(next: Attachment | null) {
    cancel('upload'); cancel('ai'); setAttachment(next); setMessages([]); setChatInput(''); clearAnalysis(); setError('');
    setNotice(next ? 'Snapshot attached for review. No AI request has been made. Previous document-bearing conversation and analyses were cleared.' : 'Job attachment removed. Document-bearing conversation and analyses cleared; Resume and CV are untouched.');
  }
  function resetWorkspace() {
    cancel('search'); cancel('ai'); cancel('upload'); setCriteria(initialCriteria()); setSkillsInput(''); setResult(null); setSelected([]); setDismissed([]);
    setAttachment(null); setIncludeResumeSource(false); setIncludeCvSource(false); setMessages([]); setChatInput(''); clearAnalysis(); setError(''); setNotice('Job workspace cleared. Resume and CV are unchanged.');
  }
  async function refreshStatus() {
    const generation = ++healthGeneration.current;
    setAiStatus('checking'); setJobsStatus('checking');
    try {
      const status = await health();
      if (healthGeneration.current !== generation) return;
      setAiStatus(status.aiConfigured ? 'ready' : 'missing'); setJobsStatus(status.jobsConfigured ? 'ready' : 'missing');
    } catch { if (healthGeneration.current === generation) { setAiStatus('offline'); setJobsStatus('offline'); } }
  }
  useEffect(() => { void refreshStatus(); return () => { healthGeneration.current += 1; controllers.current.search?.abort(); controllers.current.ai?.abort(); controllers.current.upload?.abort(); }; }, []);
  const previousReset = useRef(resetGeneration);
  useEffect(() => {
    if (previousReset.current === resetGeneration) return;
    previousReset.current = resetGeneration; resetWorkspace();
  }, [resetGeneration]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages.length, pendingChat]);

  async function runSearch(page = 1) {
    if (!valid || searchBusy || jobsStatus !== 'ready') return;
    cancel('search'); cancel('ai'); clearAnalysis(); setSelected([]); setError(''); setNotice('');
    const generation = operations.current.search;
    const controller = new AbortController(); controllers.current.search = controller; setSearchBusy(true);
    const snapshot = structuredClone(criteria);
    try {
      const response = await searchJobs({ criteria: snapshot, page }, controller.signal);
      if (operations.current.search !== generation) return;
      setResult(response); setDismissed([]); setNotice(response.listings.length ? 'Real provider candidates retrieved. Review all checks and limitations; availability is not guaranteed.' : 'No candidates returned on this page. Adjust your criteria or return to an earlier page.');
    } catch (caught) { if (operations.current.search === generation) setError(errorMessage(caught)); }
    finally { if (operations.current.search === generation) setSearchBusy(false); }
  }
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) { setError('This file is over 10 MiB. Choose a smaller text PDF.'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') { setError('Choose a PDF file. Other formats are not supported.'); return; }
    cancel('upload');
    const generation = operations.current.upload;
    const controller = new AbortController(); controllers.current.upload = controller; setUploadBusy(true); setError('');
    try {
      const response = await extractPdf(file, controller.signal);
      if (operations.current.upload !== generation) return;
      changeAttachment({ label: `PDF: ${response.source.filename}`, document: null, source: response.source });
    } catch (caught) { if (operations.current.upload === generation) setError(errorMessage(caught)); }
    finally { if (operations.current.upload === generation) setUploadBusy(false); }
  }
  async function runAssistant(action: 'chat' | 'analyze') {
    if (!aiReady || action === 'chat' && (!chatInput.trim() || conversationFull) || action === 'analyze' && (!hasAttachment || !result || stale || !selected.length)) return;
    cancel('ai'); setError(''); setNotice(''); clearAnalysis();
    const generation = operations.current.ai;
    const controller = new AbortController(); controllers.current.ai = controller; setAiBusy(true);
    const nextMessages: ChatMessage[] = action === 'chat' ? [...messages, { role: 'user', content: chatInput.trim() }] : messages;
    if (action === 'chat') setPendingChat(chatInput.trim());
    const contextCurrent = result !== null && !stale && selected.length > 0;
    try {
      const response = await requestJobAssistant({
        action, criteria: structuredClone(criteria), searchId: contextCurrent ? result.searchId : null, listingIds: contextCurrent ? [...selected] : [],
        document: attachment?.document ?? null, sourceText: attachment?.source?.text ?? '', messages: nextMessages,
      }, controller.signal);
      if (operations.current.ai !== generation) return;
      setProposal(response.proposedCriteria); setAnalyses(response.analyses);
      if (action === 'chat') { setMessages([...nextMessages, { role: 'assistant', content: response.reply }]); setChatInput(''); }
      else { setAnalysisReply(response.reply); setNotice('Analysis ready. Evidence and quoted excerpts need your review; no criteria were applied.'); }
    } catch (caught) { if (operations.current.ai === generation) setError(errorMessage(caught)); }
    finally { if (operations.current.ai === generation) { setAiBusy(false); setPendingChat(''); } }
  }
  function toggleListing(id: string) {
    cancel('ai'); clearAnalysis(); setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  function dismissListing(id: string) {
    cancel('ai'); clearAnalysis(); setSelected(current => current.filter(item => item !== id)); setDismissed(current => [...current, id]);
    setNotice('Listing hidden based on your observation, not a provider-confirmed expiry. A new search restores dismissed listings if returned.');
  }
  const submitChat = (event: FormEvent) => { event.preventDefault(); void runAssistant('chat'); };
  const proposedRows = proposal ? criteriaRows(proposal) : [];
  const currentRows = criteriaRows(criteria);

  return <section className="job-workspace" aria-labelledby="jobs-title" data-testid="job-workspace">
    <div className="workspace-heading"><div><div className="eyebrow"><span className="tiny-line" />YOUR NEXT CHAPTER</div><h1 id="jobs-title">Find a considered next step.</h1><p>Real Adzuna candidates. Clear limits. Your documents stay yours.</p></div><button className="button subtle" onClick={() => { if (window.confirm('Reset job criteria, results, attachment, conversation, and analyses? Your Resume and CV stay unchanged.')) resetWorkspace(); }}><Trash2 size={15} />Reset job workspace</button></div>
    <div className="job-status panel" aria-label="Provider configuration"><span><span className={`status-dot ${jobsStatus}`} />Jobs: {jobsStatus === 'ready' ? 'configured · access not verified' : jobsStatus === 'missing' ? 'not configured' : jobsStatus === 'offline' ? 'server unavailable' : 'checking…'}</span><span><span className={`status-dot ${aiStatus}`} />AI: {aiStatus === 'ready' ? 'configured · access not verified' : aiStatus === 'missing' ? 'not configured' : aiStatus === 'offline' ? 'server unavailable' : 'checking…'}</span><button className="text-button" disabled={jobsStatus === 'checking' || aiStatus === 'checking'} onClick={() => void refreshStatus()}>Refresh job and AI status</button></div>
    {jobsStatus === 'missing' && <p className="job-config">Search needs server-only <code>ADZUNA_APP_ID</code> and <code>ADZUNA_APP_KEY</code>. Set them in <code>.env</code>, restart the server, then refresh status. No fabricated listings are shown.</p>}
    {aiStatus === 'missing' && <p className="job-config">Analysis and chat need <code>OPENAI_API_KEY</code> on the server. Real search works independently when Adzuna is configured.</p>}
    {jobsStatus === 'offline' && <p className="job-config">Start the local API server, then refresh status. Your current work remains in this session.</p>}
    <div className="job-announcements" aria-live="polite">{error && <div className="notice error" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss job error"><X size={15} /></button></div>}{notice && <div className="notice success"><Check size={16} /><span>{notice}</span></div>}</div>
    <div className="job-layout">
      <div className="job-controls">
        <section className="panel job-section" aria-labelledby="job-criteria-title"><div className="job-section-heading"><span className="eyebrow">01 / YOUR SEARCH</span><h2 id="job-criteria-title">What matters to you?</h2></div>
          <form onSubmit={event => { event.preventDefault(); void runSearch(); }}>
            <Field label="Role or keywords" maxLength={200} value={criteria.keywords} onChange={keywords => changeCriteria({ ...criteria, keywords })} placeholder="e.g. Software engineer" />
            <div className="field"><label htmlFor="job-country">Provider country</label><select id="job-country" value={criteria.country} onChange={event => changeCriteria({ ...criteria, country: event.target.value })}>{JOB_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.label}</option>)}</select><span className="field-hint">Country chooses the provider market, not work-authorisation eligibility.</span></div>
            <Field label="Location" maxLength={200} value={criteria.location} onChange={location => changeCriteria({ ...criteria, location })} placeholder="City, region, or leave open" />
            <div className="job-field-pair">{(['minimum', 'maximum'] as const).map(bound => <div className="field" key={bound}><label htmlFor={`job-salary-${bound}`}>Salary {bound}</label><input id={`job-salary-${bound}`} type="number" inputMode="decimal" min="0" max="1000000000" step="any" value={criteria.salary[bound] ?? ''} onChange={event => changeCriteria({ ...criteria, salary: { ...criteria.salary, [bound]: event.target.value === '' ? null : event.target.valueAsNumber } })} /></div>)}</div>
            <div className="job-field-pair"><Field label="Currency (ISO code)" maxLength={3} value={criteria.salary.currency} onChange={currency => changeCriteria({ ...criteria, salary: { ...criteria.salary, currency: currency.toUpperCase() } })} /><div className="field"><label htmlFor="job-pay-period">Pay period</label><select id="job-pay-period" value={criteria.salary.period} onChange={event => changeCriteria({ ...criteria, salary: { ...criteria.salary, period: event.target.value as JobCriteria['salary']['period'] } })}>{['hour', 'day', 'week', 'month', 'year'].map(period => <option key={period} value={period}>{period}</option>)}</select></div></div>
            <div className="field"><label htmlFor="job-modality">Work modality</label><select id="job-modality" value={criteria.modality} onChange={event => changeCriteria({ ...criteria, modality: event.target.value as JobCriteria['modality'] })}><option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on-site">On-site</option></select></div>
            <div className="field"><label htmlFor="job-remote-eligibility">Remote geographic eligibility</label><select id="job-remote-eligibility" value={criteria.remoteEligibility} onChange={event => changeCriteria({ ...criteria, remoteEligibility: event.target.value as JobCriteria['remoteEligibility'] })}><option value="unspecified">Not specified / needs clarification</option><option value="worldwide">Worldwide required</option><option value="restricted">Restricted to a region</option></select><span className="field-hint">A remote label does not establish residence, visa, or work-authorisation eligibility.</span></div>
            {criteria.remoteEligibility === 'restricted' && <Field label="Required remote region" maxLength={200} value={criteria.remoteRegion} onChange={remoteRegion => changeCriteria({ ...criteria, remoteRegion })} />}
            <Field label="Desired skills (one per line)" multiline rows={3} maxLength={2000} value={skillsInput} onChange={value => { setSkillsInput(value); changeCriteria({ ...criteria, skills: value.split('\n').map(item => item.trim()).filter(Boolean) }); }} hint="Up to 20 skills, 80 characters each. Sent as keyword search terms, not verified skill filters." />
            {!valid && <p className="job-validation">Add a role or skill. Use a three-letter currency, valid salary bounds (minimum ≤ maximum, up to 1 billion), up to 20 skills of 80 characters, and a region if restricted. Nothing is silently shortened.</p>}
            <details className="job-query" open><summary>Outgoing Adzuna search preview</summary><p>Country path: <code>{criteria.country}</code> · page: 1</p><dl>{Object.entries(previewQuery).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '(empty)'}</dd></div>)}</dl><p>Only these supported query terms go to Adzuna. Salary is not sent: provider pay period cannot establish a compatible filter. Modality and remote geography are not supported structured filters. Skills are keyword retrieval only. No document or chat is sent.</p></details>
            <button className="button primary job-full-button" type="submit" disabled={!valid || searchBusy || jobsStatus !== 'ready'}>{searchBusy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}{searchBusy ? 'Searching Adzuna…' : 'Search Adzuna'}</button>
          </form>
        </section>
        <section className="panel job-section" aria-labelledby="job-document-title"><div className="job-section-heading"><span className="eyebrow">02 / OPTIONAL CONTEXT</span><h2 id="job-document-title">Attach your story</h2></div><p>Explicitly copy an editable document snapshot or extract a text PDF. Later edits to Resume/CV do not change this attachment. Your other drafts never change here.</p>
          <div className="job-snapshot-control"><button className="button secondary" disabled={!hasContent(resumeDocument) && !(includeResumeSource && resumeSource)} onClick={() => changeAttachment({ label: 'Resume snapshot', document: structuredClone(resumeDocument), source: includeResumeSource && resumeSource ? structuredClone(resumeSource) : null })}>Use Resume</button>{resumeSource && <label className="job-checkbox"><input type="checkbox" checked={includeResumeSource} onChange={event => setIncludeResumeSource(event.target.checked)} />Also include Resume’s retained original source text when copying</label>}</div>
          <div className="job-snapshot-control"><button className="button secondary" disabled={!hasContent(cvDocument) && !(includeCvSource && cvSource)} onClick={() => changeAttachment({ label: 'Curriculum vitae snapshot', document: structuredClone(cvDocument), source: includeCvSource && cvSource ? structuredClone(cvSource) : null })}>Use Curriculum vitae</button>{cvSource && <label className="job-checkbox"><input type="checkbox" checked={includeCvSource} onChange={event => setIncludeCvSource(event.target.checked)} />Also include CV’s retained original source text when copying</label>}</div>
          <input ref={fileInput} id="job-pdf" type="file" accept=".pdf,application/pdf" hidden aria-label="Upload job resume or CV PDF" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
          <button className="button secondary" disabled={uploadBusy} onClick={() => fileInput.current?.click()}>{uploadBusy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}{uploadBusy ? 'Extracting PDF…' : 'Upload resume / CV PDF'}</button><p className="field-hint">Text PDFs only · up to 10 MiB. Extraction sends the file to your local server, not AI. Review before any AI action.</p>
          {attachment ? <div className="job-attachment"><div className="job-attachment-heading"><strong>{attachment.label}</strong><button className="icon-button danger-hover" onClick={() => changeAttachment(null)} aria-label="Remove job document"><Trash2 size={16} /></button></div><p>{attachment.document ? 'Editable document fields are included as a fixed snapshot.' : 'Extracted PDF text only; no editable document fields.'} {attachment.source ? `Original source text included: ${attachment.source.filename} (${attachment.source.pageCount} pages).` : 'No retained original source text included.'}</p>{attachment.document && <details><summary>Review attached document fields</summary><div className="job-document-preview"><DocumentPreview document={attachment.document} /></div></details>}{attachment.source && <details><summary>Review attached source text</summary><pre>{attachment.source.text}</pre></details>}</div> : <p className="job-empty-context">No document attached. Search and criteria chat are available without one; grounded skill analysis requires an attachment.</p>}
        </section>
      </div>
      <div className="job-main">
        <section className="panel job-section" aria-labelledby="job-results-title" aria-busy={searchBusy}><div className="job-result-heading"><div><span className="eyebrow">03 / REAL OPPORTUNITIES</span><h2 id="job-results-title">Candidates, not guarantees.</h2></div>{result && <span>Page {result.page}</span>}</div>
          <p>Provider keyword retrieval is not proof every criterion matches. Unknown or estimated salary, unknown work modality, and unverified remote eligibility are never verified matches. Excerpts may omit requirements.</p>
          {!result && <div className="job-empty"><Search size={24} /><h3>Your search starts with you.</h3><p>Set your criteria and explicitly search. No AI runs when you search or attach a document.</p></div>}
          {result && <><details className="job-query"><summary>Last submitted criteria and actual provider query</summary><dl>{criteriaRows(result.criteria).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><h3>Actual outgoing supported terms</h3><dl>{Object.entries(result.appliedQuery).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
            {stale && <div className="notice error" role="status">Criteria changed. These are previous search results. Search again before selecting or analysing; chat will not send this stale search snapshot.</div>}
            <div className="job-limitations"><strong>Search limitations</strong><ul>{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul><p>Retrieved {new Date(result.retrievedAt).toLocaleString()}. {result.total === null ? 'Provider total unknown.' : `Provider reports ${result.total.toLocaleString()} results — not a deduplicated or verified-match count.`} Pagination is not exhaustive coverage.</p><p>Current availability is unverified. Search retrieval and an opening redirect do not establish that the employer is still hiring. If the source reports an expired listing, dismiss it below; this records your observation, not provider-confirmed expiry.</p></div>
            {result.listings.length === 0 && <div className="job-empty"><h3>No candidates on this page.</h3><p>Try different keywords or location, or return to an earlier page. Unsupported filters have not been claimed as satisfied.</p></div>}
            {dismissed.length > 0 && <p className="job-config">{dismissed.length} listing(s) dismissed for this search. New searches restore returned listings.</p>}
            <div className="job-listings">{result.listings.filter(listing => !dismissed.includes(listing.id)).map(listing => {
              const checks = Object.entries(listing.checks) as [keyof typeof criterionLabels, JobListing['checks']['role']][];
              const verified = checks.every(([, check]) => check.status === 'matched' || check.status === 'not_requested');
              return <article className="job-listing" key={listing.id} data-testid="job-listing"><div className="job-listing-top"><span className={`job-candidate-badge ${verified ? 'verified' : ''}`}>{verified ? 'Requested checks matched — review evidence' : 'Unverified candidate'}</span><label className="job-checkbox"><input type="checkbox" checked={selected.includes(listing.id)} disabled={stale || searchBusy || !selected.includes(listing.id) && selected.length >= 5} onChange={() => toggleListing(listing.id)} />Select for analysis</label></div><h3>{listing.title || 'Title unavailable'}</h3><p className="job-employer">{listing.employer || 'Employer unknown'} · {listing.location || 'Location unknown'}</p><p>Work modality: {listing.modality} · Remote restrictions: {listing.remoteRestrictions ?? 'Unknown'}</p><Salary listing={listing} /><p className="job-dates">Posted: {listing.postedAt ? new Date(listing.postedAt).toLocaleString() : 'Unknown'} · Retrieved: {new Date(listing.retrievedAt).toLocaleString()}</p><p className="job-excerpt">{listing.descriptionExcerpt || 'No description excerpt supplied.'}</p><dl className="job-checks">{checks.map(([key, check]) => <div key={key} className={check.status}><dt>{criterionLabels[key]} <span>{checkLabels[check.status]}</span></dt><dd>{check.reason}</dd></div>)}</dl><div className="job-listing-links"><a className="button secondary" href={listing.sourceUrl} target="_blank" rel="noopener noreferrer">View provider listing<ArrowUpRight size={15} /></a><a className="job-adzuna" href={`https://www.${JOB_DOMAINS[result.criteria.country]}/`} target="_blank" rel="noopener noreferrer" aria-label="Jobs by Adzuna">Adzuna</a></div><p className="job-link-note">Provider-supplied link, not verified as an active vacancy. {listing.sourceUrl.startsWith('http:') ? 'Provider supplied an HTTP link; your browser may upgrade it. ' : ''}<span>{listing.sourceUrl}</span></p><button className="text-button" onClick={() => dismissListing(listing.id)}>Dismiss unavailable listing</button></article>;
            })}</div>
            <nav className="job-pagination" aria-label="Job results pages"><button className="button secondary" disabled={stale || searchBusy || jobsStatus !== 'ready' || result.page <= 1} onClick={() => void runSearch(result.page - 1)}>Previous page</button><span>Page {result.page}</span><button className="button secondary" disabled={stale || searchBusy || jobsStatus !== 'ready' || result.page >= 1000 || result.total !== null && result.page * 20 >= result.total} onClick={() => void runSearch(result.page + 1)}>Next page</button></nav>
          </>}
        </section>
        <section className="panel job-section" aria-labelledby="job-analysis-title"><div className="job-section-heading"><span className="eyebrow">04 / GROUNDED PERSPECTIVE</span><h2 id="job-analysis-title">Review the evidence.</h2></div><p>Select up to five listings on the current page and attach a document. AI can explain evidenced matches and requirements not evidenced in your document — that does not mean you lack those skills.</p><p className="job-ai-disclosure"><ShieldCheck size={16} /><span>Only clicking Analyse or Send shares your attached document fields, opted-in source text, criteria, conversation, and selected listing context with the configured AI provider. Its retention policy applies. Nothing sends documents to Adzuna or employers, applies for a job, or contacts anyone. Cancelling or clearing cannot retract data already sent.</span></p><button className="button ai-button" disabled={!aiReady || !hasAttachment || !result || stale || !selected.length} onClick={() => void runAssistant('analyze')}>{aiBusy && !pendingChat ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}Analyse selected listings ({selected.length}/5)</button>{!hasAttachment && <p className="field-hint">Attach an explicit document snapshot or PDF to enable grounded analysis.</p>}{analysisReply && <p className="job-analysis-reply">{analysisReply}</p>}
          {analyses.map(analysis => <article className="job-analysis" key={analysis.listingId}><h3>{result?.listings.find(item => item.id === analysis.listingId)?.title ?? 'Selected listing'}</h3><h4>Supported document matches</h4>{analysis.matches.length ? <ul className="job-evidence">{analysis.matches.map((item, index) => <Evidence key={index} item={item} />)}</ul> : <p>No supported matches were returned.</p>}<h4>Requirements not evidenced in the attached document</h4>{analysis.gaps.length ? <ul className="job-evidence">{analysis.gaps.map((item, index) => <Evidence key={index} item={item} />)}</ul> : <p>No evidence gaps were returned. This is not proof all requirements are met.</p>}<h4>Limitations</h4><ul>{analysis.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul><p>Quotes show provenance, not proof of the AI’s interpretation. Excerpts may be incomplete and current availability remains unverified.</p></article>)}
        </section>
        <section className="panel job-section job-chat" aria-labelledby="job-chat-title"><div className="job-result-heading"><div><span className="eyebrow">05 / REFINE TOGETHER</span><h2 id="job-chat-title">Your job-search conversation</h2></div><button className="text-button" onClick={resetConversation}>Reset job conversation</button></div><p>Discuss your criteria or selected listing evidence. Suggestions never change your criteria or run a search automatically. This conversation is separate from Resume/CV chat.</p><div className="chat-messages" role="log" aria-label="Job assistant conversation" aria-live="polite">{!messages.length && !pendingChat && <p className="job-empty-context">Ask to refine a role, pay expectations, skills, or remote geography. No document is needed for criteria advice.</p>}{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><span className="message-author">{message.role === 'user' ? 'YOU' : 'JOB ASSISTANT'}</span><p>{message.content}</p></div>)}{pendingChat && <div className="chat-message user"><span className="message-author">YOU</span><p>{pendingChat}</p></div>}{aiBusy && <div className="chat-thinking"><LoaderCircle size={14} className="spin" />Reviewing your explicit context…</div>}<div ref={chatEnd} /></div>
          {proposal && <section className="job-proposal" aria-label="Proposed criteria changes"><span className="eyebrow">NOT APPLIED</span><h3>Review proposed criteria changes</h3><dl>{proposedRows.map(([label, value], index) => currentRows[index][1] !== value ? <div key={label}><dt>{label}</dt><dd><del>{currentRows[index][1]}</del><span> → </span><ins>{value}</ins></dd></div> : null)}</dl>{proposedRows.every(([, value], index) => currentRows[index][1] === value) && <p>No criteria differ from your current choices.</p>}<div className="job-actions"><button className="button primary" onClick={() => { const next = proposal; setSkillsInput(next.skills.join('\n')); changeCriteria(next); setNotice('Proposed criteria applied. Nothing was searched automatically. Click Search Adzuna for new results.'); }}>Apply criteria proposal</button><button className="button secondary" onClick={() => setProposal(null)}>Discard criteria proposal</button></div><p>Applying preserves unchanged fields; a new explicit search is required.</p></section>}
          {conversationFull && <p className="conversation-limit">This conversation is full (20 messages). Reset the job conversation to continue. No history is silently removed.</p>}
          <form className="chat-composer" onSubmit={submitChat}><label className="visually-hidden" htmlFor="job-chat-message">Message the job assistant</label><textarea id="job-chat-message" rows={3} maxLength={4000} value={chatInput} disabled={aiBusy || conversationFull} placeholder="Help me refine my search…" onChange={event => setChatInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void runAssistant('chat'); } }} /><button className="send-button" type="submit" aria-label="Send job message" disabled={!aiReady || !chatInput.trim() || conversationFull}><Send size={17} /></button></form><p className="composer-hint">Enter to send · Shift + Enter for a new line · 4,000 character limit</p>
        </section>
      </div>
    </div><p className="job-session-note">Job criteria, attachments, results, and conversations are session-only and survive tab switches, not a reload. Browser draft saving applies only to Resume/CV. Clear all drafts also clears this workspace.</p>
  </section>;
}
