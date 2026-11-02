import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, FileCheck2, FileText, LoaderCircle, LockKeyhole, MessageSquare, Plus, Send, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { AiRequest, ChatMessage, DocumentKind, ResumeDocument } from '../shared/types';
import { downloadPdf, errorMessage, extractPdf, health, requestAi } from './api';
import DocumentEditor, { Field } from './DocumentEditor';
import DocumentPreview from './DocumentPreview';
import JobAssistant from './JobAssistant';
import { emptyDrafts, hasContent, loadDrafts, STORAGE_KEY, type Draft, type Drafts } from './document';

interface Proposal { document: ResumeDocument; reply: string; origin: string }
interface Session {
  messages: ChatMessage[];
  proposal: Proposal | null;
  busy: boolean;
  uploading: boolean;
  exporting: boolean;
  error: string;
  notice: string;
  chatInput: string;
  pendingChat: string;
  mode: 'manual' | 'upload';
}
const emptySession = (): Session => ({ messages: [], proposal: null, busy: false, uploading: false, exporting: false, error: '', notice: '', chatInput: '', pendingChat: '', mode: 'manual' });
type Sessions = Record<DocumentKind, Session>;
type AiStatus = 'checking' | 'ready' | 'missing' | 'offline';

function ProposalDialog({ proposal, onClose, onApply, onDiscard }: { proposal: Proposal; onClose: () => void; onApply: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="proposal-dialog" onCancel={onClose} aria-labelledby="proposal-title">
    <div className="dialog-heading"><div><span className="eyebrow">NOT APPLIED YET</span><h2 id="proposal-title">A fresh perspective.</h2></div><button className="icon-button" onClick={onClose} aria-label="Close proposal preview"><X size={20} /></button></div>
    <p className="dialog-description">Review every detail before replacing your current document. Your uploaded source and the other tab will stay untouched.</p>
    <p className="proposal-reply">{proposal.reply}</p>
    <div className="proposal-paper"><DocumentPreview document={proposal.document} proposal /></div>
    <div className="dialog-actions"><button className="button subtle" onClick={onDiscard}>Discard proposal</button><button className="button primary" onClick={onApply}><Check size={17} />Apply to this document</button></div>
  </dialog>;
}

export default function App() {
  const [initial] = useState(loadDrafts);
  const [drafts, setDrafts] = useState<Drafts>(initial.drafts);
  const [saving, setSaving] = useState(initial.saving);
  const [storageNotice, setStorageNotice] = useState(initial.notice);
  const [active, setActive] = useState<DocumentKind | 'jobs'>('resume');
  const [sessions, setSessions] = useState<Sessions>(() => ({ resume: { ...emptySession(), mode: initial.drafts.resume.source ? 'upload' : 'manual' }, cv: emptySession() }));
  const [aiStatus, setAiStatus] = useState<AiStatus>('checking');
  const [reviewing, setReviewing] = useState<DocumentKind | null>(null);
  const [jobResetGeneration, setJobResetGeneration] = useState(0);
  const generations = useRef<Record<DocumentKind, number>>({ resume: 0, cv: 0 });
  const chatEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const kind: DocumentKind = active === 'cv' ? 'cv' : 'resume';
  const draft = drafts[kind];
  const session = sessions[kind];
  const documentLabel = kind === 'resume' ? 'resume' : 'curriculum vitae';
  const hasFacts = hasContent(draft.document) || Boolean(draft.source?.text.trim());

  function updateSession(target: DocumentKind, patch: Partial<Session>) {
    setSessions(current => ({ ...current, [target]: { ...current[target], ...patch } }));
  }
  function updateDraft(target: DocumentKind, patch: Partial<Draft>) {
    setDrafts(current => ({ ...current, [target]: { ...current[target], ...patch } }));
  }
  async function refreshHealth() {
    setAiStatus('checking');
    try { setAiStatus((await health()).aiConfigured ? 'ready' : 'missing'); }
    catch { setAiStatus('offline'); }
  }
  useEffect(() => { void refreshHealth(); }, []);
  useEffect(() => {
    if (!saving) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts })); }
    catch {
      setSaving(false);
      setStorageNotice('Browser storage is unavailable or full. Your current drafts remain in this session, but changes are not saved.');
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* Browser storage is unavailable. */ }
    }
  }, [drafts, saving]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [kind, session.messages.length, session.pendingChat]);

  function changeSaving(enabled: boolean) {
    if (!enabled) {
      try {
        localStorage.removeItem(STORAGE_KEY);
        setStorageNotice('Browser saving is off. The saved copy was removed; your current work stays in this session.');
      } catch { setStorageNotice('Browser storage could not be accessed. If a saved copy exists, remove this site’s data in your browser settings.'); }
    } else setStorageNotice('Browser saving is on. Document details, job descriptions, and uploaded source text are saved here, not your conversations.');
    setSaving(enabled);
  }
  function clearAll() {
    if (!window.confirm('Clear both drafts, uploaded sources, conversations, proposals, and the entire job workspace? The saved browser copy will also be deleted. This cannot be undone.')) return;
    generations.current.resume += 1;
    generations.current.cv += 1;
    setJobResetGeneration(current => current + 1);
    setDrafts(emptyDrafts());
    setSessions({ resume: emptySession(), cv: emptySession() });
    setReviewing(null);
    setSaving(false);
    try { localStorage.removeItem(STORAGE_KEY); setStorageNotice('All drafts, sources, conversations, and saved browser data have been cleared.'); }
    catch { setStorageNotice('Session drafts were cleared. Browser storage could not be accessed; remove this site’s saved data in browser settings.'); }
  }
  async function upload(file: File, target: DocumentKind) {
    if (sessions[target].uploading) return;
    if (file.size > 10 * 1024 * 1024) { updateSession(target, { error: 'This file is over 10 MiB. Choose a smaller text PDF.' }); return; }
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') { updateSession(target, { error: 'Choose a PDF file. Other document formats are not supported.' }); return; }
    const generation = generations.current[target];
    updateSession(target, { uploading: true, error: '', notice: '' });
    try {
      const result = await extractPdf(file);
      if (generations.current[target] !== generation) return;
      updateDraft(target, { source: result.source });
      updateSession(target, { notice: 'CV text extracted. Review the source below before using AI. Your editable document has not changed.' });
    } catch (error) {
      if (generations.current[target] === generation) updateSession(target, { error: errorMessage(error) });
    } finally {
      if (generations.current[target] === generation) updateSession(target, { uploading: false });
    }
  }
  async function exportDocument(target: DocumentKind) {
    if (sessions[target].exporting || !hasContent(drafts[target].document)) return;
    const generation = generations.current[target];
    updateSession(target, { exporting: true, error: '', notice: '' });
    try {
      await downloadPdf(target, drafts[target].document);
      if (generations.current[target] === generation) updateSession(target, { notice: 'Your PDF is ready. If the download did not start, check your browser’s download permissions.' });
    } catch (error) {
      if (generations.current[target] === generation) updateSession(target, { error: errorMessage(error) });
    } finally {
      if (generations.current[target] === generation) updateSession(target, { exporting: false });
    }
  }
  async function runAi(action: AiRequest['action'], target: DocumentKind) {
    const current = sessions[target];
    const currentDraft = drafts[target];
    if (current.busy) return;
    if (aiStatus !== 'ready') {
      updateSession(target, { error: aiStatus === 'missing' ? 'AI is not configured. Set OPENAI_API_KEY in the server .env file and restart the server, then refresh AI status. Manual editing, PDF upload, and export still work.' : 'AI status is unavailable. Start the local server and refresh AI status before trying again.' });
      return;
    }
    const message = current.chatInput.trim();
    if (action === 'chat' && !message) return;
    const messages: ChatMessage[] = action === 'chat' ? [...current.messages, { role: 'user', content: message }] : current.messages;
    const generation = generations.current[target];
    updateSession(target, { busy: true, error: '', notice: '', proposal: null, pendingChat: action === 'chat' ? message : '' });
    try {
      const response = await requestAi({ action, kind: target, document: currentDraft.document, sourceText: currentDraft.source?.text ?? '', targetJob: currentDraft.targetJob, messages });
      if (generations.current[target] !== generation) return;
      const patch: Partial<Session> = {
        proposal: response.document ? { document: response.document, reply: response.reply, origin: action === 'chat' ? 'Assistant suggestion' : action === 'personalize' ? 'Tailored resume' : 'Organized CV' } : null,
      };
      if (action === 'chat') { patch.messages = [...messages, { role: 'assistant', content: response.reply }]; patch.chatInput = ''; }
      else patch.notice = 'Your proposal is ready to review. Nothing in your current document has changed.';
      updateSession(target, patch);
    } catch (error) {
      if (generations.current[target] === generation) updateSession(target, { error: errorMessage(error) });
    } finally {
      if (generations.current[target] === generation) updateSession(target, { busy: false, pendingChat: '' });
    }
  }
  function applyProposal(target: DocumentKind) {
    const proposal = sessions[target].proposal;
    if (!proposal) return;
    updateDraft(target, { document: proposal.document });
    updateSession(target, { proposal: null, notice: 'Proposal applied to this document. Your original uploaded source is unchanged.' });
    setReviewing(null);
  }
  function submitChat(event: FormEvent) {
    event.preventDefault();
    void runAi('chat', kind);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <header className="site-header">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setActive('resume'); }} aria-label="Hireme home">hireme<span className="brand-dot">.</span></a>
      <nav className="header-tabs" aria-label="Document workspace">
        <button className={active === 'resume' ? 'active' : ''} aria-current={active === 'resume' ? 'page' : undefined} onClick={() => setActive('resume')}>Resume</button>
        <button className={active === 'cv' ? 'active' : ''} aria-current={active === 'cv' ? 'page' : undefined} onClick={() => setActive('cv')}>Curriculum vitae</button>
        <button className={active === 'jobs' ? 'active' : ''} aria-current={active === 'jobs' ? 'page' : undefined} onClick={() => setActive('jobs')}>Job assistant</button>
      </nav>
      <span className="header-note"><span className="status-dot" />A little clarity. A big next step.</span>
    </header>

    <main id="workspace" tabIndex={-1}>
      <div hidden={active !== 'jobs'}><JobAssistant resumeDocument={drafts.resume.document} cvDocument={drafts.cv.document} resumeSource={drafts.resume.source} cvSource={drafts.cv.source} resetGeneration={jobResetGeneration} /></div>
      {active !== 'jobs' && <>
        <section className="workspace-heading">
          <div><div className="eyebrow"><span className="tiny-line" />YOUR NEXT MOVE, WELL WRITTEN</div><h1>{kind === 'resume' ? 'Make your experience count.' : 'The whole story. Beautifully clear.'}</h1><p>{kind === 'resume' ? 'A focused resume. A confident first impression.' : 'Bring your experience together in a considered curriculum vitae.'}</p></div>
          <div className="heading-actions"><span className="private-badge"><ShieldCheck size={15} />Private by default</span><button className="button primary export-button" disabled={!hasContent(draft.document) || session.exporting} onClick={() => void exportDocument(kind)}>{session.exporting ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{session.exporting ? 'Preparing PDF…' : 'Export PDF'}</button></div>
        </section>
        <div className="workspace-notices" aria-live="polite">
          {session.error && <div className="notice error" role="alert"><span>{session.error}</span><button className="icon-button" onClick={() => updateSession(kind, { error: '' })} aria-label="Dismiss error"><X size={15} /></button></div>}
          {session.notice && <div className="notice success"><Check size={16} /><span>{session.notice}</span><button className="icon-button" onClick={() => updateSession(kind, { notice: '' })} aria-label="Dismiss notification"><X size={15} /></button></div>}
        </div>
        <div className="workspace-grid">
          <section className="editor-panel panel" aria-labelledby="editor-title">
            <div className="panel-heading"><div><span className="eyebrow">01 / THE DETAILS</span><h2 id="editor-title">Your story</h2></div><span className="small-note">Make it yours.</span></div>
            {kind === 'resume' && <div className="editor-mode" role="group" aria-label="Resume starting point"><button className={session.mode === 'manual' ? 'selected' : ''} onClick={() => updateSession(kind, { mode: 'manual' })}><FileText size={15} />Write manually</button><button className={session.mode === 'upload' ? 'selected' : ''} onClick={() => updateSession(kind, { mode: 'upload' })}><Upload size={15} />Start from a CV</button></div>}
            {kind === 'resume' && session.mode === 'upload' && <div className="upload-workflow">
              <div className="upload-zone"><span className="upload-icon"><Upload size={22} /></span><h3>{draft.source ? 'Want to use another CV?' : 'A head start, from your CV.'}</h3><p>Upload a text-based PDF. We’ll extract the facts, not change your original.</p><input ref={fileInput} hidden tabIndex={-1} type="file" accept=".pdf,application/pdf" aria-label="Upload CV PDF" disabled={session.uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, kind); event.target.value = ''; }} /><button className="button secondary" disabled={session.uploading} onClick={() => fileInput.current?.click()}>{session.uploading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{session.uploading ? 'Extracting text…' : draft.source ? 'Replace PDF' : 'Choose PDF'}</button><span className="field-hint">PDF only · Up to 10 MiB · No OCR</span></div>
              {draft.source && <div className="source-card"><div className="source-heading"><FileCheck2 size={18} /><div><strong>{draft.source.filename}</strong><span>{draft.source.pageCount} {draft.source.pageCount === 1 ? 'page' : 'pages'} · Original source retained</span></div><button className="icon-button danger-hover" aria-label="Remove uploaded source" title="Remove uploaded source" disabled={session.uploading} onClick={() => { updateDraft(kind, { source: null }); updateSession(kind, { notice: 'Uploaded source removed. Your editable document has not changed.' }); }}><Trash2 size={16} /></button></div><details className="source-details"><summary>Review extracted text<ChevronRight size={14} /></summary><pre>{draft.source.text}</pre></details></div>}
              <div className="workflow-divider"><span>EDIT YOUR OUTPUT BELOW</span></div>
            </div>}
            <DocumentEditor key={kind} document={draft.document} onChange={document => updateDraft(kind, { document })} />
            <div className="editor-bottom"><Check size={14} /><span>Every detail updates your preview instantly.</span></div>
          </section>

          <section className="preview-panel" aria-labelledby="preview-title">
            <div className="preview-toolbar"><div><span className="eyebrow">02 / THE BIG PICTURE</span><h2 id="preview-title">Document preview<span className="live-indicator"><span />LIVE</span></h2></div><span className="paper-size">A4 <span>/</span> MINIMAL</span></div>
            <div className="preview-canvas"><DocumentPreview document={draft.document} /></div>
            <p className="preview-caption"><FileText size={13} />Clean, selectable text. Every detail included.<span>PDF paginates automatically.</span></p>
          </section>

          <aside className="assistant-column" aria-labelledby="assistant-title">
            <section className="ai-action-card panel"><div className="ai-action-top"><span className="ai-symbol"><Sparkles size={19} /></span><span className="eyebrow">A LITTLE EXTRA CLARITY</span></div><h2>{kind === 'resume' ? 'Right story. Right role.' : 'Give your story structure.'}</h2><p>{kind === 'resume' ? 'Focus your experience on the opportunity ahead, without adding facts that aren’t yours.' : 'Let AI organize your facts into a clear, considered CV. Your experience stays yours.'}</p>
              <Field label={kind === 'resume' ? 'Target job description' : 'Target job description (optional)'} multiline rows={5} maxLength={20_000} value={draft.targetJob} onChange={targetJob => updateDraft(kind, { targetJob })} placeholder={kind === 'resume' ? 'Paste the role you have in mind…' : 'Add a role for more contextual feedback…'} />
              <button className="button ai-button" disabled={session.busy || !hasFacts || (kind === 'resume' && !draft.targetJob.trim())} onClick={() => void runAi(kind === 'resume' ? 'personalize' : 'organize', kind)}>{session.busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{session.busy ? 'Thinking it through…' : kind === 'resume' ? 'Tailor my resume' : 'Organize my CV'}{!session.busy && <ArrowUpRight size={16} />}</button>
              {!hasFacts ? <p className="action-hint">{kind === 'resume' ? 'Add details or upload a CV to get started.' : 'Add your details to get started.'}</p> : kind === 'resume' && !draft.targetJob.trim() ? <p className="action-hint">Add a job description to tailor your resume.</p> : <p className="action-hint">You’ll review a proposal before anything changes.</p>}
            </section>
            {session.proposal && <section className="proposal-card" aria-label="Unapplied AI proposal"><span className="eyebrow"><Sparkles size={13} />PROPOSAL READY</span><h3>{session.proposal.origin}</h3><p>Your draft is unchanged. Review the proposed document before applying.</p><button className="button primary" onClick={() => setReviewing(kind)}>Review & apply<ArrowRight size={16} /></button><button className="text-button" onClick={() => updateSession(kind, { proposal: null })}>Discard proposal</button></section>}
            <section className="chat-panel panel" aria-labelledby="assistant-title"><div className="chat-heading"><span className="chat-icon"><MessageSquare size={18} /></span><div><h2 id="assistant-title">A second pair of eyes</h2><span>Your {kind === 'resume' ? 'resume' : 'CV'} assistant</span></div>{session.messages.length > 0 && <button className="icon-button" title="Start a new conversation" aria-label="Start a new conversation" disabled={session.busy} onClick={() => updateSession(kind, { messages: [], pendingChat: '', chatInput: '', error: '' })}><Plus size={17} /></button>}</div>
              <div className="chat-messages" role="log" aria-label={`${documentLabel} assistant conversation`} aria-live="polite">
                {session.messages.length === 0 && !session.pendingChat && <div className="chat-empty"><span className="eyebrow">LET’S MAKE IT STRONGER</span><p>Clearer wording. Stronger focus. A fresh perspective on your {documentLabel}.</p><span className="chat-context">I’ll use this tab’s document{kind === 'resume' ? ', source CV,' : ''} and target role for context.</span><button className="prompt-button" onClick={() => updateSession(kind, { chatInput: 'What could I improve in my current document?' })}>What could I improve?<ArrowUpRight size={13} /></button><button className="prompt-button" onClick={() => updateSession(kind, { chatInput: 'How can I describe my experience more clearly without inventing facts?' })}>Help me tell my story<ArrowUpRight size={13} /></button></div>}
                {session.messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><span className="message-author">{message.role === 'user' ? 'YOU' : 'HIREME ASSISTANT'}</span><p>{message.content}</p></div>)}
                {session.pendingChat && <div className="chat-message user"><span className="message-author">YOU</span><p>{session.pendingChat}</p></div>}
                {session.busy && <div className="chat-thinking"><LoaderCircle size={14} className="spin" />Considering your story…</div>}<div ref={chatEnd} />
              </div>
              {session.messages.length >= 20 && <div className="conversation-limit">This conversation is full. Start a new conversation using + above; your document stays intact.</div>}
              <form className="chat-composer" onSubmit={submitChat}><label className="visually-hidden" htmlFor="chat-message">Message the {documentLabel} assistant</label><textarea id="chat-message" rows={2} maxLength={4000} placeholder="Ask for a fresh perspective…" value={session.chatInput} disabled={session.busy || session.messages.length >= 20} onChange={event => updateSession(kind, { chatInput: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!session.busy && session.messages.length < 20) void runAi('chat', kind); } }} /><button className="send-button" aria-label="Send message" type="submit" disabled={!session.chatInput.trim() || session.busy || session.messages.length >= 20}>{session.busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}</button></form>
              <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
            </section>
            <div className={`ai-status ${aiStatus}`}><span className="status-dot" /><span>{aiStatus === 'checking' ? 'Checking AI connection…' : aiStatus === 'ready' ? 'AI configured · provider not yet verified' : aiStatus === 'missing' ? 'AI not configured' : 'Local server unavailable'}</span><button onClick={() => void refreshHealth()} disabled={aiStatus === 'checking'}>Refresh</button></div>
            {aiStatus === 'missing' && <p className="configuration-note">Set <code>OPENAI_API_KEY</code> in the server’s <code>.env</code> file and restart, then refresh. Manual editing, extraction, and export work without AI.</p>}
            {aiStatus === 'offline' && <p className="configuration-note">Start the local API server, then refresh. Your edits remain available here; extraction, export, and AI need the server.</p>}
            <p className="privacy-disclosure"><LockKeyhole size={13} /><span>Clicking an AI action sends this document, source text, target job, and conversation to your configured provider. Its retention policy applies. AI can make mistakes; review every proposal.</span></p>
          </aside>
        </div>
      </>}
    </main>
    <footer className="site-footer"><div className="footer-main"><div className="save-setting"><label className="save-checkbox"><input type="checkbox" checked={saving} onChange={event => changeSaving(event.target.checked)} /><span className="checkbox-visual" aria-hidden="true">{saving && <Check size={12} />}</span><span>Save drafts in this browser</span></label><span className="storage-detail">Opt-in Resume/CV only, including uploaded source text. Conversations and all job state stay session-only.</span></div><button className="text-button clear-button" onClick={clearAll}><Trash2 size={13} />Clear all drafts</button></div><div className="footer-bottom"><p><LockKeyhole size={12} />Browser storage is not encrypted and may be accessible to others using this profile. Files are processed in memory; no server-side file retention.</p><span>MADE FOR YOUR NEXT CHAPTER<span className="footer-dot">✳</span></span></div>{storageNotice && <div className="storage-notice" role="status"><CircleHelp size={14} /><span>{storageNotice}</span><button className="icon-button" aria-label="Dismiss storage notice" onClick={() => setStorageNotice('')}><X size={14} /></button></div>}</footer>
    {reviewing && sessions[reviewing].proposal && <ProposalDialog proposal={sessions[reviewing].proposal!} onClose={() => setReviewing(null)} onApply={() => applyProposal(reviewing)} onDiscard={() => { updateSession(reviewing, { proposal: null }); setReviewing(null); }} />}
  </div>;
}
