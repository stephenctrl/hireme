import { useId, type ChangeEvent, type ReactNode } from 'react';
import { ChevronDown, Plus, Trash2, UserRound, AlignLeft, BriefcaseBusiness, GraduationCap, Tags, FolderOpen, Award, Languages, LayoutList } from 'lucide-react';
import type { ResumeDocument } from '../shared/types';
import { lines, newId } from './document';

type DocumentEditorProps = { document: ResumeDocument; onChange: (document: ResumeDocument) => void };
export function Field({ label, value, onChange, multiline = false, placeholder, hint, maxLength = 10_000, rows = 4 }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string; hint?: string; maxLength?: number; rows?: number;
}) {
  const id = useId();
  const shared = { id, value, placeholder, maxLength, 'aria-describedby': hint ? `${id}-hint` : undefined, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  return <div className="field"><label htmlFor={id}>{label}</label>{multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} type="text" />}{hint && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}</div>;
}
function EditorSection({ title, icon, children, count, open = false }: { title: string; icon: ReactNode; children: ReactNode; count?: number; open?: boolean }) {
  return <details className="editor-section" open={open || undefined}>
    <summary><span className="section-icon">{icon}</span><span>{title}</span>{count !== undefined && count > 0 && <span className="section-count">{count}</span>}<ChevronDown className="section-chevron" size={16} /></summary>
    <div className="section-content">{children}</div>
  </details>;
}
function RecordCard({ title, onRemove, children }: { title: string; onRemove: () => void; children: ReactNode }) {
  return <div className="record-card"><div className="record-toolbar"><span>{title}</span><button className="icon-button danger-hover" type="button" onClick={onRemove} aria-label={`Remove ${title}`} title={`Remove ${title}`}><Trash2 size={15} /></button></div>{children}</div>;
}
function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button className="add-button" type="button" onClick={onClick} disabled={disabled}><Plus size={15} />{label}</button>;
}
export default function DocumentEditor({ document, onChange }: DocumentEditorProps) {
  const update = <K extends keyof ResumeDocument>(key: K, value: ResumeDocument[K]) => onChange({ ...document, [key]: value });
  return <div className="document-editor">
    <EditorSection title="Personal details" icon={<UserRound size={17} />} open>
      <Field label="Full name" value={document.contact.fullName} onChange={value => update('contact', { ...document.contact, fullName: value })} placeholder="Your name" />
      <Field label="Professional headline" value={document.contact.headline} onChange={value => update('contact', { ...document.contact, headline: value })} placeholder="What you do, in a few words" />
      <div className="field-pair"><Field label="Email" value={document.contact.email} onChange={value => update('contact', { ...document.contact, email: value })} /><Field label="Phone" value={document.contact.phone} onChange={value => update('contact', { ...document.contact, phone: value })} /></div>
      <Field label="Location" value={document.contact.location} onChange={value => update('contact', { ...document.contact, location: value })} placeholder="City, country" />
      <Field label="Website / portfolio" value={document.contact.website} onChange={value => update('contact', { ...document.contact, website: value })} />
      <Field label="LinkedIn" value={document.contact.linkedin} onChange={value => update('contact', { ...document.contact, linkedin: value })} />
    </EditorSection>
    <EditorSection title="Professional summary" icon={<AlignLeft size={17} />}>
      <Field label="Summary" multiline rows={5} value={document.summary} onChange={value => update('summary', value)} placeholder="A clear introduction to your experience and what you bring." />
    </EditorSection>
    <EditorSection title="Experience" icon={<BriefcaseBusiness size={17} />} count={document.experience.length}>
      {document.experience.map((item, index) => <RecordCard key={`${item.id}-${index}`} title={`Experience ${index + 1}`} onRemove={() => update('experience', document.experience.filter((_, i) => i !== index))}>
        <Field label="Job title" value={item.role} onChange={value => update('experience', document.experience.map((entry, i) => i === index ? { ...entry, role: value } : entry))} />
        <Field label="Employer" value={item.employer} onChange={value => update('experience', document.experience.map((entry, i) => i === index ? { ...entry, employer: value } : entry))} />
        <Field label="Location" value={item.location} onChange={value => update('experience', document.experience.map((entry, i) => i === index ? { ...entry, location: value } : entry))} />
        <div className="field-pair"><Field label="Start date" value={item.startDate} onChange={value => update('experience', document.experience.map((entry, i) => i === index ? { ...entry, startDate: value } : entry))} placeholder="Month / year" /><Field label="End date" value={item.endDate} onChange={value => update('experience', document.experience.map((entry, i) => i === index ? { ...entry, endDate: value } : entry))} placeholder="Present or month / year" /></div>
        <Field label="Achievements & responsibilities" multiline value={item.highlights.join('\n')} onChange={value => update('experience', document.experience.map((entry, i) => i === index ? { ...entry, highlights: lines(value) } : entry))} hint="One bullet per line. Keep every detail truthful." />
      </RecordCard>)}
      <AddButton label="Add experience" disabled={document.experience.length >= 100} onClick={() => update('experience', [...document.experience, { id: newId(), role: '', employer: '', location: '', startDate: '', endDate: '', highlights: [] }])} />
    </EditorSection>
    <EditorSection title="Education" icon={<GraduationCap size={18} />} count={document.education.length}>
      {document.education.map((item, index) => <RecordCard key={`${item.id}-${index}`} title={`Education ${index + 1}`} onRemove={() => update('education', document.education.filter((_, i) => i !== index))}>
        <Field label="Institution" value={item.institution} onChange={value => update('education', document.education.map((entry, i) => i === index ? { ...entry, institution: value } : entry))} />
        <Field label="Qualification / degree" value={item.qualification} onChange={value => update('education', document.education.map((entry, i) => i === index ? { ...entry, qualification: value } : entry))} />
        <Field label="Location" value={item.location} onChange={value => update('education', document.education.map((entry, i) => i === index ? { ...entry, location: value } : entry))} />
        <div className="field-pair"><Field label="Start date" value={item.startDate} onChange={value => update('education', document.education.map((entry, i) => i === index ? { ...entry, startDate: value } : entry))} /><Field label="End date" value={item.endDate} onChange={value => update('education', document.education.map((entry, i) => i === index ? { ...entry, endDate: value } : entry))} /></div>
        <Field label="Additional details" multiline value={item.details.join('\n')} onChange={value => update('education', document.education.map((entry, i) => i === index ? { ...entry, details: lines(value) } : entry))} hint="One detail per line." />
      </RecordCard>)}
      <AddButton label="Add education" disabled={document.education.length >= 100} onClick={() => update('education', [...document.education, { id: newId(), institution: '', qualification: '', location: '', startDate: '', endDate: '', details: [] }])} />
    </EditorSection>
    <EditorSection title="Skills" icon={<Tags size={17} />} count={document.skills.filter(value => value.trim()).length}>
      <Field label="Skills" multiline value={document.skills.join('\n')} onChange={value => update('skills', lines(value))} placeholder="Add your relevant skills" hint="One skill per line." />
    </EditorSection>
    <EditorSection title="Projects" icon={<FolderOpen size={17} />} count={document.projects.length}>
      {document.projects.map((item, index) => <RecordCard key={`${item.id}-${index}`} title={`Project ${index + 1}`} onRemove={() => update('projects', document.projects.filter((_, i) => i !== index))}>
        <Field label="Project name" value={item.name} onChange={value => update('projects', document.projects.map((entry, i) => i === index ? { ...entry, name: value } : entry))} />
        <Field label="Project link" value={item.link} onChange={value => update('projects', document.projects.map((entry, i) => i === index ? { ...entry, link: value } : entry))} />
        <Field label="Description" multiline rows={3} value={item.description} onChange={value => update('projects', document.projects.map((entry, i) => i === index ? { ...entry, description: value } : entry))} />
        <Field label="Highlights" multiline value={item.highlights.join('\n')} onChange={value => update('projects', document.projects.map((entry, i) => i === index ? { ...entry, highlights: lines(value) } : entry))} hint="One bullet per line." />
      </RecordCard>)}
      <AddButton label="Add project" disabled={document.projects.length >= 100} onClick={() => update('projects', [...document.projects, { id: newId(), name: '', link: '', description: '', highlights: [] }])} />
    </EditorSection>
    <EditorSection title="Certifications" icon={<Award size={17} />} count={document.certifications.filter(value => value.trim()).length}>
      <Field label="Certifications" multiline value={document.certifications.join('\n')} onChange={value => update('certifications', lines(value))} hint="One certification per line. Include issuer and date if relevant." />
    </EditorSection>
    <EditorSection title="Languages" icon={<Languages size={17} />} count={document.languages.filter(value => value.trim()).length}>
      <Field label="Languages & proficiency" multiline value={document.languages.join('\n')} onChange={value => update('languages', lines(value))} hint="One language per line." />
    </EditorSection>
    <EditorSection title="Additional sections" icon={<LayoutList size={17} />} count={document.extraSections.length}>
      {document.extraSections.map((item, index) => <RecordCard key={`${item.id}-${index}`} title={`Section ${index + 1}`} onRemove={() => update('extraSections', document.extraSections.filter((_, i) => i !== index))}>
        <Field label="Section title" value={item.title} onChange={value => update('extraSections', document.extraSections.map((entry, i) => i === index ? { ...entry, title: value } : entry))} placeholder="Publications, volunteering, awards…" />
        <Field label="Details" multiline value={item.items.join('\n')} onChange={value => update('extraSections', document.extraSections.map((entry, i) => i === index ? { ...entry, items: lines(value) } : entry))} hint="One item per line." />
      </RecordCard>)}
      <AddButton label="Add section" disabled={document.extraSections.length >= 100} onClick={() => update('extraSections', [...document.extraSections, { id: newId(), title: '', items: [] }])} />
    </EditorSection>
  </div>;
}
