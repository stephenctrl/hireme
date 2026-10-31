import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { PDFDocument, rgb } from 'pdf-lib';
import type { ApiError, ExtractPdfResponse, ResumeDocument } from '../shared/types.js';
import { createApp } from './app.js';
import { extractPdf } from './extract.js';
import { renderPdf } from './pdf.js';

function makeDocument(): ResumeDocument {
  return {
    contact: {
      fullName: 'Zoë Dvořák', headline: 'Software engineer', email: 'zoe@example.test',
      phone: '+420 555 010 020', location: 'Praha', website: 'https://example.test/zoe',
      linkedin: 'https://linkedin.example.test/zoe',
    },
    summary: `Builds reliable products with international teams.\n${'UnbrokenTokenXYZ'.repeat(180)}`,
    experience: Array.from({ length: 24 }, (_, index) => ({
      id: `never-print-record-id-${index}`,
      role: `Engineer ${index + 1}`, employer: `Employer ${index + 1}`, location: 'Brno',
      startDate: '2020', endDate: 'Present',
      highlights: [
        `Maintained documented interfaces for team ${index + 1} while preserving existing customer behavior.`,
        `Reviewed data workflows and delivered accessible tools for colleagues in group ${index + 1}.`,
      ],
    })),
    education: [{
      id: 'never-print-education-id', institution: 'Charles University', qualification: 'Computer science',
      location: 'Prague', startDate: '2016', endDate: '2020', details: ['Studied software systems and algorithms.'],
    }],
    skills: ['TypeScript', 'Service design'],
    projects: [{
      id: 'never-print-project-id', name: 'Community tools', link: 'https://example.test/project',
      description: 'Scheduling tools for volunteers.', highlights: ['Built accessible scheduling forms.'],
    }],
    certifications: ['Professional certificate 2025'],
    languages: ['Čeština', 'English', 'Ελληνικά', 'Русский'],
    extraSections: [{
      id: 'never-print-section-id', title: 'Selected contributions',
      items: ['Published technical documentation.', 'FINAL_EXPORT_MARKER_742'],
    }],
  };
}

const fileFor = (buffer: Buffer, originalname = 'document.pdf') => ({
  buffer, originalname, mimetype: 'application/pdf', fieldname: 'file', encoding: '7bit',
  size: buffer.length,
} as Express.Multer.File);

function printedStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(printedStrings);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => key === 'id' ? [] : printedStrings(entry));
  }
  return [];
}

test('Unicode multipage export extracts every field from a pooled subarray without clipping', async () => {
  const document = makeDocument();
  const bytes = Buffer.from(await renderPdf(document));
  // Model multipart's small/padded input view rather than a standalone file-read Buffer.
  const backing = Buffer.allocUnsafeSlow(bytes.length + 83);
  backing.fill(0x5a);
  bytes.copy(backing, 29);
  const uploaded = backing.subarray(29, 29 + bytes.length);
  assert.notEqual(uploaded.byteOffset, 0);
  assert.notEqual(uploaded.buffer.byteLength, uploaded.byteLength);
  const source = await extractPdf(fileFor(uploaded));
  assert.ok(source.pageCount > 1, 'The fixture must exercise page boundaries.');
  assert.ok(source.text.includes('FINAL_EXPORT_MARKER_742'), 'Final content must survive pagination.');
  assert.ok(!source.text.includes('never-print-'), 'UI identifiers must not be printed.');
  const selectableText = source.text.replace(/Page\s+\d+\s+of\s+\d+/g, '').replace(/\s/gu, '');
  for (const field of printedStrings(document)) {
    assert.ok(selectableText.includes(field.replace(/\s/gu, '')), `Export lost or clipped field: ${field.slice(0, 80)}`);
  }
});

test('multipart PDF route preserves browser UTF-8 filenames and extracts actual PDF text', async () => {
  const document = makeDocument();
  document.experience = [];
  document.summary = 'A real selectable-text PDF for the multipart filename boundary.';
  document.education = [];
  document.skills = [];
  document.projects = [];
  document.certifications = [];
  document.languages = [];
  document.extraSections = [];
  const bytes = await renderPdf(document);
  const app = createApp({ ai: { apiKey: '', baseUrl: 'http://127.0.0.1:1', model: 'unused' } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    // Includes Latin-1, non-Latin-1, and literal mojibake-looking characters.
    // Parsing UTF-8 at the multipart boundary must not decode the latter twice.
    for (const filename of ['Zoë Dvořák résumé.pdf', 'résumé.pdf', 'literal Ã© filename.pdf']) {
      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' }), filename);
      const response = await fetch(`http://127.0.0.1:${address.port}/api/extract-pdf`, { method: 'POST', body: form });
      assert.equal(response.status, 200);
      const result = await response.json() as ExtractPdfResponse;
      assert.equal(result.source.filename, filename);
      assert.equal(result.source.pageCount, 1);
      assert.ok(result.source.text.includes(document.summary));
      assert.ok(result.source.text.includes(document.contact.fullName));
    }
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('a valid image-only PDF returns PDF_NO_TEXT rather than an extraction error', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const image = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=', 'base64'));
  page.drawImage(image, { x: 48, y: 48, width: 150, height: 150 });
  page.drawRectangle({ x: 48, y: 250, width: 200, height: 40, color: rgb(0.3, 0.3, 0.3) });
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  await assert.rejects(extractPdf(fileFor(bytes)), error => {
    const apiError = error as Error & { status: number; code: ApiError['error']['code'] };
    assert.equal(apiError.status, 422);
    assert.equal(apiError.code, 'PDF_NO_TEXT');
    return true;
  });
});
