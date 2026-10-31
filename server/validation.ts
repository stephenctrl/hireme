import { z } from 'zod';
import type { AiRequest, ExportPdfRequest, ResumeDocument } from '../shared/types.js';
import { HttpError } from './errors.js';

const text = z.string().max(10_000);
const id = z.string().max(100);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(100);

export const documentSchema = z.object({
  contact: z.object({
    fullName: text, headline: text, email: text, phone: text,
    location: text, website: text, linkedin: text,
  }).strict(),
  summary: text,
  experience: list(z.object({
    id, role: text, employer: text, location: text, startDate: text,
    endDate: text, highlights: list(text),
  }).strict()),
  education: list(z.object({
    id, institution: text, qualification: text, location: text,
    startDate: text, endDate: text, details: list(text),
  }).strict()),
  skills: list(text),
  projects: list(z.object({
    id, name: text, link: text, description: text, highlights: list(text),
  }).strict()),
  certifications: list(text),
  languages: list(text),
  extraSections: list(z.object({ id, title: text, items: list(text) }).strict()),
}).strict();

const kindSchema = z.enum(['resume', 'cv']);
const exportSchema = z.object({ kind: kindSchema, document: documentSchema }).strict();
const aiSchema = z.object({
  action: z.enum(['personalize', 'organize', 'chat']),
  kind: kindSchema,
  document: documentSchema,
  sourceText: z.string().max(100_000),
  targetJob: z.string().max(20_000),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4_000),
  }).strict()).max(20),
}).strict();

export const aiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(10_000),
  document: documentSchema.nullable(),
}).strict();

export function hasContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) => key !== 'id' && hasContent(entry));
  }
  return false;
}

export function documentWithinLimit(document: ResumeDocument): boolean {
  return JSON.stringify(document).length <= 100_000;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  if (result.error.issues.some(issue => issue.code === 'too_big')) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE',
      'The document or context exceeds a size limit. Shorten long fields, bullet lists, source text, job description, or conversation.');
  }
  throw new HttpError(400, 'INVALID_REQUEST', 'The request has missing fields or invalid field types. Send a complete document and the required action fields.');
}

function checkDocumentLimit(document: ResumeDocument): void {
  if (!documentWithinLimit(document)) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The serialized document exceeds 100,000 characters. Shorten the document before continuing.');
  }
}

export function validateExport(input: unknown): ExportPdfRequest {
  const request = parse(exportSchema, input);
  checkDocumentLimit(request.document);
  if (!hasContent(request.document)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Add some document content before exporting a PDF.');
  }
  return request;
}

export function validateAi(input: unknown): AiRequest {
  const request = parse(aiSchema, input);
  checkDocumentLimit(request.document);
  if (JSON.stringify(request).length > 150_000) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'AI context exceeds 150,000 characters. Shorten the document, source, job description, or conversation.');
  }
  if (request.action === 'chat') {
    if (!request.messages.length || request.messages.at(-1)?.role !== 'user' || !request.messages.at(-1)?.content.trim()) {
      throw new HttpError(400, 'INVALID_REQUEST', 'Chat requires a nonempty final user message.');
    }
  } else {
    if (!hasContent(request.document) && !request.sourceText.trim()) {
      throw new HttpError(400, 'INVALID_REQUEST', 'Enter document facts or upload a text CV before requesting a proposal.');
    }
    if (request.action === 'personalize' && !request.targetJob.trim()) {
      throw new HttpError(400, 'INVALID_REQUEST', 'Add a target job description before personalizing a resume.');
    }
  }
  return request;
}
