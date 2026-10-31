import type { ReactNode } from 'react';
import type { ResumeDocument } from '../shared/types';
import { FileText } from 'lucide-react';
import { hasContent, hasRecordContent, nonempty } from './document';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="paper-section"><h3>{title}</h3>{children}</section>;
}
function Bullets({ items }: { items: string[] }) {
  const printable = nonempty(items);
  return printable.length ? <ul>{printable.map((item, index) => <li key={index}>{item}</li>)}</ul> : null;
}
function Dates({ start, end }: { start: string; end: string }) {
  return start.trim() || end.trim() ? <span className="paper-dates">{[start, end].filter(value => value.trim()).join(' – ')}</span> : null;
}

export default function DocumentPreview({ document, proposal = false }: { document: ResumeDocument; proposal?: boolean }) {
  const { contact } = document;
  if (!hasContent(document)) {
    return <div className="paper empty-paper" aria-label="Empty document preview">
      <div className="empty-paper-icon"><FileText size={30} strokeWidth={1.2} /></div>
      <h3>Your next chapter starts here.</h3>
      <p>Add your details on the left.<br />Your document takes shape as you write.</p>
      <div className="empty-paper-lines" aria-hidden="true"><i /><i /><i /></div>
      <span className="paper-footnote">YOUR EXPERIENCE. CLEARLY TOLD.</span>
    </div>;
  }
  const experience = document.experience.filter(hasRecordContent);
  const education = document.education.filter(hasRecordContent);
  const projects = document.projects.filter(hasRecordContent);
  return <article className="paper" aria-label={proposal ? 'Proposed document preview' : 'Live document preview'}>
    <header className="paper-header">
      {contact.fullName.trim() && <h2>{contact.fullName}</h2>}
      {contact.headline.trim() && <p className="paper-headline">{contact.headline}</p>}
      <div className="paper-contact">
        {[contact.email, contact.phone, contact.location, contact.website, contact.linkedin].filter(value => value.trim()).map((value, index) => <span key={index}>{value}</span>)}
      </div>
    </header>
    {document.summary.trim() && <Section title="Profile"><p>{document.summary}</p></Section>}
    {experience.length > 0 && <Section title="Experience">{experience.map((item, index) => <div className="paper-record" key={`${item.id}-${index}`}>
      <div className="paper-record-heading"><strong>{item.role}</strong><Dates start={item.startDate} end={item.endDate} /></div>
      {(item.employer.trim() || item.location.trim()) && <p className="paper-secondary">{[item.employer, item.location].filter(value => value.trim()).join(' · ')}</p>}
      <Bullets items={item.highlights} />
    </div>)}</Section>}
    {education.length > 0 && <Section title="Education">{education.map((item, index) => <div className="paper-record" key={`${item.id}-${index}`}>
      <div className="paper-record-heading"><strong>{item.qualification}</strong><Dates start={item.startDate} end={item.endDate} /></div>
      {(item.institution.trim() || item.location.trim()) && <p className="paper-secondary">{[item.institution, item.location].filter(value => value.trim()).join(' · ')}</p>}
      <Bullets items={item.details} />
    </div>)}</Section>}
    {nonempty(document.skills).length > 0 && <Section title="Skills"><p>{nonempty(document.skills).join(' · ')}</p></Section>}
    {projects.length > 0 && <Section title="Projects">{projects.map((item, index) => <div className="paper-record" key={`${item.id}-${index}`}>
      {item.name.trim() && <strong>{item.name}</strong>}
      {item.link.trim() && <p className="paper-secondary">{item.link}</p>}
      {item.description.trim() && <p>{item.description}</p>}
      <Bullets items={item.highlights} />
    </div>)}</Section>}
    {nonempty(document.certifications).length > 0 && <Section title="Certifications"><Bullets items={document.certifications} /></Section>}
    {nonempty(document.languages).length > 0 && <Section title="Languages"><p>{nonempty(document.languages).join(' · ')}</p></Section>}
    {document.extraSections.filter(hasRecordContent).map((section, index) => <Section title={section.title.trim() || 'Additional information'} key={`${section.id}-${index}`}><Bullets items={section.items} /></Section>)}
  </article>;
}
