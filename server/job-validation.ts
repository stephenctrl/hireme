import { z } from 'zod';
import { JOB_COUNTRIES } from '../shared/jobs.js';
import type { JobAssistantRequest, JobSearchRequest } from '../shared/jobs.js';
import { HttpError } from './errors.js';
import { documentSchema, documentWithinLimit, hasContent } from './validation.js';

const money = z.number().finite().min(0).max(1_000_000_000).nullable();
export const criteriaSchema = z.object({
  keywords: z.string().max(200),
  country: z.string().refine(value => JOB_COUNTRIES.some(country => country.code === value)),
  location: z.string().max(200),
  salary: z.object({
    minimum: money, maximum: money, currency: z.string().regex(/^[A-Z]{3}$/),
    period: z.enum(['hour', 'day', 'week', 'month', 'year']),
  }).strict().refine(value => value.minimum === null || value.maximum === null || value.minimum <= value.maximum),
  modality: z.enum(['any', 'remote', 'hybrid', 'on-site']),
  remoteEligibility: z.enum(['unspecified', 'worldwide', 'restricted']),
  remoteRegion: z.string().max(200),
  skills: z.array(z.string().min(1).max(80).refine(value => Boolean(value.trim()))).max(20),
}).strict().refine(value => value.remoteEligibility !== 'restricted' || Boolean(value.remoteRegion.trim()));
const searchSchema = z.object({ criteria: criteriaSchema, page: z.number().int().min(1).max(1000) }).strict();
const assistantSchema = z.object({
  action: z.enum(['chat', 'analyze']), criteria: criteriaSchema,
  searchId: z.string().min(1).max(100).nullable(),
  listingIds: z.array(z.string().min(1).max(200)).max(5),
  document: documentSchema.nullable(), sourceText: z.string().max(100_000),
  messages: z.array(z.discriminatedUnion('role', [
    z.object({ role: z.literal('user'), content: z.string().max(4000) }).strict(),
    z.object({ role: z.literal('assistant'), content: z.string().max(10_000) }).strict(),
  ])).max(20),
}).strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  if (result.error.issues.some(issue => issue.code === 'too_big')) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Job criteria or assistant context exceeds its size limit. Shorten the fields or select at most five listings.');
  }
  throw new HttpError(400, 'INVALID_REQUEST', 'Send complete valid job criteria, a supported country, finite ordered salary bounds, and only documented request fields.');
}
export function validateJobSearch(input: unknown): JobSearchRequest { return parse(searchSchema, input); }
export function validateJobAssistant(input: unknown): JobAssistantRequest {
  const request = parse(assistantSchema, input);
  if ((request.document && !documentWithinLimit(request.document)) || JSON.stringify(request).length > 150_000) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Job assistant context exceeds 150,000 characters or the document exceeds 100,000 characters. Shorten the attachment or conversation.');
  }
  if (new Set(request.listingIds).size !== request.listingIds.length || (request.listingIds.length && !request.searchId)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Select unique listing IDs from a named search snapshot.');
  }
  if (request.action === 'chat' && (request.messages.at(-1)?.role !== 'user' || !request.messages.at(-1)?.content.trim())) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Job chat requires a nonblank final user message.');
  }
  if (request.action === 'analyze' && (!request.listingIds.length || (!hasContent(request.document) && !request.sourceText.trim()))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Analysis requires selected search results and an explicitly attached nonempty document or source.');
  }
  return request;
}
