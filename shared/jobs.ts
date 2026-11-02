import type { ChatMessage, ResumeDocument } from './types.js';

export const JOB_COUNTRIES = [
  { code: 'gb', label: 'United Kingdom' }, { code: 'us', label: 'United States' },
  { code: 'at', label: 'Austria' }, { code: 'au', label: 'Australia' },
  { code: 'be', label: 'Belgium' }, { code: 'br', label: 'Brazil' },
  { code: 'ca', label: 'Canada' }, { code: 'ch', label: 'Switzerland' },
  { code: 'de', label: 'Germany' }, { code: 'es', label: 'Spain' },
  { code: 'fr', label: 'France' }, { code: 'in', label: 'India' },
  { code: 'it', label: 'Italy' }, { code: 'mx', label: 'Mexico' },
  { code: 'nl', label: 'Netherlands' }, { code: 'nz', label: 'New Zealand' },
  { code: 'pl', label: 'Poland' }, { code: 'sg', label: 'Singapore' },
  { code: 'za', label: 'South Africa' },
] as const;

export type PayPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';
export type WorkModality = 'any' | 'remote' | 'hybrid' | 'on-site';
export type CheckStatus = 'not_requested' | 'matched' | 'not_matched' | 'unverified';

export interface JobCriteria {
  keywords: string;
  country: string;
  location: string;
  salary: { minimum: number | null; maximum: number | null; currency: string; period: PayPeriod };
  modality: WorkModality;
  remoteEligibility: 'unspecified' | 'worldwide' | 'restricted';
  remoteRegion: string;
  skills: string[];
}

export interface CriterionCheck { status: CheckStatus; reason: string }

export interface JobListing {
  id: string;
  title: string;
  employer: string;
  location: string;
  modality: Exclude<WorkModality, 'any'> | 'unknown';
  remoteRestrictions: string | null;
  salary: {
    minimum: number | null;
    maximum: number | null;
    currency: string | null;
    period: PayPeriod | null;
    provenance: 'published' | 'predicted' | 'unknown';
  };
  source: 'Adzuna';
  sourceUrl: string;
  postedAt: string | null;
  retrievedAt: string;
  descriptionExcerpt: string;
  checks: Record<'role' | 'location' | 'salary' | 'modality' | 'remoteEligibility' | 'skills', CriterionCheck>;
}

export interface JobSearchRequest { criteria: JobCriteria; page: number }
export interface JobSearchResponse {
  searchId: string;
  criteria: JobCriteria;
  appliedQuery: Record<string, string>;
  limitations: string[];
  listings: JobListing[];
  page: number;
  total: number | null;
  retrievedAt: string;
}

export interface JobAssistantRequest {
  action: 'chat' | 'analyze';
  criteria: JobCriteria;
  searchId: string | null;
  listingIds: string[];
  document: ResumeDocument | null;
  sourceText: string;
  messages: ChatMessage[];
}
export interface SkillEvidence {
  requirement: string;
  requirementQuote: string;
  documentQuote: string | null;
  explanation: string;
}
export interface JobAssistantResponse {
  reply: string;
  proposedCriteria: JobCriteria | null;
  analyses: {
    listingId: string;
    matches: SkillEvidence[];
    gaps: SkillEvidence[];
    limitations: string[];
  }[];
}
