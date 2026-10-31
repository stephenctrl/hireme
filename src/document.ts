import type { DocumentKind, ResumeDocument, UploadedSource } from '../shared/types';

export interface Draft {
  document: ResumeDocument;
  targetJob: string;
  source: UploadedSource | null;
}
export type Drafts = Record<DocumentKind, Draft>;
export const STORAGE_KEY = 'hireme.drafts.v1';
export const newId = () => crypto.randomUUID();
export const emptyDocument = (): ResumeDocument => ({
  contact: { fullName: '', headline: '', email: '', phone: '', location: '', website: '', linkedin: '' },
  summary: '', experience: [], education: [], skills: [], projects: [], certifications: [], languages: [], extraSections: [],
});
export const emptyDraft = (): Draft => ({ document: emptyDocument(), targetJob: '', source: null });
export const emptyDrafts = (): Drafts => ({ resume: emptyDraft(), cv: emptyDraft() });
const meaningful = (value: unknown): boolean => {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(meaningful);
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => key !== 'id' && meaningful(item));
  return false;
};
export const hasContent = (document: ResumeDocument) => meaningful(document);
export const hasRecordContent = (record: object) => meaningful(record);
export const lines = (value: string) => value.split('\n');
export const nonempty = (items: string[]) => items.filter(item => item.trim());

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 10_000): value is string => typeof value === 'string' && value.length <= limit;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => text(item));
const records = (value: unknown, validate: (record: Record<string, unknown>) => boolean): boolean =>
  Array.isArray(value) && value.length <= 100 && value.every(item => object(item) && text(item.id, 100) && validate(item));
const fields = (record: Record<string, unknown>, keys: string[]) => keys.every(key => text(record[key]));

// Persisted data and provider proposals are untrusted, even when they came from this browser.
export function isDocument(value: unknown): value is ResumeDocument {
  if (!object(value) || !object(value.contact)) return false;
  return fields(value.contact, ['fullName', 'headline', 'email', 'phone', 'location', 'website', 'linkedin'])
    && text(value.summary)
    && records(value.experience, item => fields(item, ['role', 'employer', 'location', 'startDate', 'endDate']) && strings(item.highlights))
    && records(value.education, item => fields(item, ['institution', 'qualification', 'location', 'startDate', 'endDate']) && strings(item.details))
    && records(value.projects, item => fields(item, ['name', 'link', 'description']) && strings(item.highlights))
    && records(value.extraSections, item => text(item.title) && strings(item.items))
    && strings(value.skills) && strings(value.certifications) && strings(value.languages)
    && JSON.stringify(value).length <= 100_000;
}
function isDraft(value: unknown): value is Draft {
  if (!object(value) || !isDocument(value.document) || !text(value.targetJob, 20_000)) return false;
  return value.source === null || (object(value.source) && text(value.source.filename, 10_000)
    && text(value.source.text, 100_000) && Number.isInteger(value.source.pageCount) && (value.source.pageCount as number) >= 0);
}
export function loadDrafts(): { drafts: Drafts; saving: boolean; notice: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { drafts: emptyDrafts(), saving: false, notice: '' };
    const value: unknown = JSON.parse(saved);
    if (!object(value) || value.version !== 1 || !object(value.drafts) || !isDraft(value.drafts.resume) || !isDraft(value.drafts.cv)) {
      throw new Error('invalid saved draft');
    }
    return { drafts: { resume: value.drafts.resume, cv: value.drafts.cv }, saving: true, notice: 'Your saved drafts were restored from this browser.' };
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable in this browser. */ }
    return { drafts: emptyDrafts(), saving: false, notice: 'Saved drafts could not be recovered. The invalid saved copy was ignored; you can start fresh here.' };
  }
}
