import type { AiRequest, AiResponse, ExtractPdfResponse, HealthResponse } from '../shared/types';
import { JOB_COUNTRIES, type JobAssistantRequest, type JobAssistantResponse, type JobCriteria, type JobSearchRequest, type JobSearchResponse } from '../shared/jobs';
import { z } from 'zod';
import { isDocument } from './document';

async function readError(response: Response): Promise<never> {
  let message = 'The request could not be completed. Please try again.';
  try {
    const data = await response.json();
    if (typeof data?.error?.message === 'string') message = data.error.message;
  } catch { /* Non-JSON proxy errors must not be shown as document content. */ }
  throw new Error(message);
}
export async function health(): Promise<HealthResponse> {
  const response = await fetch('/api/health', { cache: 'no-store' });
  if (!response.ok) return readError(response);
  const result = await response.json();
  if (result.status !== 'ok' || typeof result.aiConfigured !== 'boolean' || typeof result.jobsConfigured !== 'boolean') throw new Error('The local server returned an unexpected status.');
  return result;
}
export async function extractPdf(file: File, signal?: AbortSignal): Promise<ExtractPdfResponse> {
  const data = new FormData();
  data.append('file', file);
  const response = await fetch('/api/extract-pdf', { method: 'POST', body: data, signal });
  if (!response.ok) return readError(response);
  const result = await response.json();
  const parsed = z.object({ source: z.object({
    filename: z.string().max(10_000), text: z.string().min(1).max(100_000).refine(value => Boolean(value.trim())),
    pageCount: z.number().int().min(1),
  }) }).safeParse(result);
  if (!parsed.success) throw new Error('The server returned invalid extracted text. No document was attached.');
  return parsed.data;
}
export async function requestAi(request: AiRequest): Promise<AiResponse> {
  if (request.messages.length > 20) throw new Error('This conversation has reached 20 messages. Start a new conversation to continue; your document will stay intact.');
  if (JSON.stringify(request).length > 150_000) throw new Error('This AI context is too large. Shorten the source, document, job description, or conversation before trying again. No facts have been sent or removed.');
  const response = await fetch('/api/ai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  if (!response.ok) return readError(response);
  const result = await response.json();
  if (typeof result.reply !== 'string' || !result.reply.trim() || (result.document !== null && !isDocument(result.document))) {
    throw new Error('The provider returned an invalid proposal. Your draft has not changed. Please try again.');
  }
  if (request.action !== 'chat' && result.document === null) throw new Error('No document proposal was returned. Your draft has not changed.');
  return result;
}
export async function downloadPdf(kind: AiRequest['kind'], document: AiRequest['document']): Promise<void> {
  const response = await fetch('/api/export-pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, document }),
  });
  if (!response.ok) return readError(response);
  if (!response.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('The server did not return a PDF. Please try again.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = `hireme-${kind}.pdf`;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'Cannot reach the local server. Check that it is running, then try again. Your draft is still here.';
  return error instanceof Error ? error.message : 'Something went wrong. Please try again; your draft has not changed.';
}

const payPeriodSchema = z.enum(['hour', 'day', 'week', 'month', 'year']);
const amountSchema = z.number().finite().min(0).max(1_000_000_000).nullable();
const criteriaSchema = z.object({
  keywords: z.string().max(200), country: z.string().refine(value => JOB_COUNTRIES.some(country => country.code === value)),
  location: z.string().max(200),
  salary: z.object({ minimum: amountSchema, maximum: amountSchema, currency: z.string().regex(/^[A-Z]{3}$/), period: payPeriodSchema })
    .refine(value => value.minimum === null || value.maximum === null || value.minimum <= value.maximum),
  modality: z.enum(['any', 'remote', 'hybrid', 'on-site']), remoteEligibility: z.enum(['unspecified', 'worldwide', 'restricted']),
  remoteRegion: z.string().max(200), skills: z.array(z.string().max(80)).max(20),
});
export const JOB_DOMAINS: Record<string, string> = {
  gb: 'adzuna.co.uk', us: 'adzuna.com', at: 'adzuna.at', au: 'adzuna.com.au', be: 'adzuna.be', br: 'adzuna.com.br',
  ca: 'adzuna.ca', ch: 'adzuna.ch', de: 'adzuna.de', es: 'adzuna.es', fr: 'adzuna.fr', in: 'adzuna.in',
  it: 'adzuna.it', mx: 'adzuna.com.mx', nl: 'adzuna.nl', nz: 'adzuna.co.nz', pl: 'adzuna.pl', sg: 'adzuna.sg', za: 'adzuna.co.za',
};
export function safeJobUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4000) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.port
      && [...Object.values(JOB_DOMAINS), 'adzuna.co.in'].includes(host) && url.pathname.startsWith('/jobs/');
  } catch { return false; }
}
export function isJobCriteria(value: unknown): value is JobCriteria {
  return criteriaSchema.safeParse(value).success;
}
const dateSchema = z.string().max(100).refine(value => Number.isFinite(Date.parse(value)));
const checkSchema = z.object({
  status: z.enum(['not_requested', 'matched', 'not_matched', 'unverified']), reason: z.string().max(4000),
});
const listingSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().max(2000), employer: z.string().max(2000), location: z.string().max(2000),
  modality: z.enum(['remote', 'hybrid', 'on-site', 'unknown']), remoteRestrictions: z.string().max(4000).nullable(),
  salary: z.object({
    minimum: amountSchema, maximum: amountSchema, currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    period: payPeriodSchema.nullable(), provenance: z.enum(['published', 'predicted', 'unknown']),
  }),
  source: z.literal('Adzuna'), sourceUrl: z.string().refine(safeJobUrl), postedAt: dateSchema.nullable(), retrievedAt: dateSchema,
  descriptionExcerpt: z.string().max(20_000),
  checks: z.object({ role: checkSchema, location: checkSchema, salary: checkSchema, modality: checkSchema, remoteEligibility: checkSchema, skills: checkSchema }),
});
const searchSchema = z.object({
  searchId: z.string().min(1).max(200), criteria: criteriaSchema, appliedQuery: z.record(z.string(), z.string().max(4000)),
  limitations: z.array(z.string().max(20_000)).max(100), listings: z.array(listingSchema).max(20),
  page: z.number().int().min(1).max(1000), total: z.number().int().nonnegative().nullable(), retrievedAt: dateSchema,
}).refine(value => Object.keys(value.appliedQuery).length <= 30 && new Set(value.listings.map(item => item.id)).size === value.listings.length);
const evidenceSchema = z.object({
  requirement: z.string().max(4000), requirementQuote: z.string().min(1).max(20_000),
  documentQuote: z.string().max(20_000).nullable(), explanation: z.string().max(10_000),
});
const assistantSchema = z.object({
  reply: z.string().min(1).max(10_000).refine(value => Boolean(value.trim())), proposedCriteria: criteriaSchema.nullable(),
  analyses: z.array(z.object({
    listingId: z.string().min(1).max(200),
    matches: z.array(evidenceSchema.refine(value => Boolean(value.documentQuote?.trim()))).max(50),
    gaps: z.array(evidenceSchema).max(50), limitations: z.array(z.string().max(20_000)).max(100),
  })).max(5),
}).refine(value => new Set(value.analyses.map(item => item.listingId)).size === value.analyses.length);
export async function searchJobs(request: JobSearchRequest, signal?: AbortSignal): Promise<JobSearchResponse> {
  if (!isJobCriteria(request.criteria)) throw new Error('Check your search criteria. No search has been sent.');
  const response = await fetch('/api/jobs/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
  if (!response.ok) return readError(response);
  const result = searchSchema.safeParse(await response.json());
  if (!result.success || result.data.page !== request.page) throw new Error('The jobs service returned invalid results or an unsafe source link. Nothing from this response was displayed.');
  return result.data;
}
export async function requestJobAssistant(request: JobAssistantRequest, signal?: AbortSignal): Promise<JobAssistantResponse> {
  if (request.messages.length > 20) throw new Error('This conversation is full. Reset the conversation to continue; no history has been removed or sent.');
  if (JSON.stringify(request).length > 150_000) throw new Error('This AI context is too large. Remove the attachment or reset the conversation before trying again. No facts have been sent or truncated.');
  const response = await fetch('/api/jobs/assistant', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
  if (!response.ok) return readError(response);
  const result = assistantSchema.safeParse(await response.json());
  if (!result.success || result.data.analyses.some(item => !request.listingIds.includes(item.listingId))) {
    throw new Error('The assistant returned invalid job analysis. No proposal or analysis was applied.');
  }
  return result.data;
}
