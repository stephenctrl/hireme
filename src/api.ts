import type { AiRequest, AiResponse, ExtractPdfResponse, HealthResponse } from '../shared/types';
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
  if (result.status !== 'ok' || typeof result.aiConfigured !== 'boolean') throw new Error('The local server returned an unexpected status.');
  return result;
}
export async function extractPdf(file: File): Promise<ExtractPdfResponse> {
  const data = new FormData();
  data.append('file', file);
  const response = await fetch('/api/extract-pdf', { method: 'POST', body: data });
  if (!response.ok) return readError(response);
  return response.json();
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
