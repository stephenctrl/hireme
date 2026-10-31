import { createRequire } from 'node:module';
import type pdfParse from 'pdf-parse';
import type { UploadedSource } from '../shared/types.js';
import { HttpError } from './errors.js';

// The package root executes fixture code in some ESM environments; load its parser directly.
const parsePdf = createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js') as
  (data: Uint8Array, options?: pdfParse.Options) => Promise<pdfParse.Result>;

interface PdfTextPage {
  getTextContent(options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{
    items: Array<{ str: string; transform: number[] }>;
  }>;
}

export async function extractPdf(file: Express.Multer.File): Promise<UploadedSource> {
  const acceptedMime = ['application/pdf', 'application/octet-stream', 'binary/octet-stream'];
  if (!acceptedMime.includes(file.mimetype.toLowerCase()) || file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new HttpError(415, 'UNSUPPORTED_FILE', 'This file is not a supported PDF. Select a PDF file, not a renamed image or document.');
  }
  let tooLarge = false;
  let failedPage = false;
  let characters = 0;
  try {
    // PDF.js expects ordinary typed-array slicing. Node Buffers (including their
    // pooled backing stores) have different slice semantics, so normalize once.
    const result = await parsePdf(Uint8Array.from(file.buffer), {
      pagerender: async (page: PdfTextPage) => {
        if (tooLarge || failedPage) return '';
        try {
          const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
          const pieces: string[] = [];
          let previousY: number | undefined;
          for (const item of content.items) {
            const currentY = item.transform[5];
            const separator = previousY !== undefined && currentY !== previousY ? '\n' : '';
            characters += separator.length + item.str.length;
            if (characters > 100_000) {
              tooLarge = true;
              return '';
            }
            pieces.push(separator, item.str);
            previousY = currentY;
          }
          return pieces.join('');
        } catch {
          // pdf-parse otherwise suppresses individual page errors; never return partial facts.
          failedPage = true;
          return '';
        }
      },
    });
    const text = result.text.replace(/\r\n?/g, '\n').trim();
    if (tooLarge || text.length > 100_000) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The PDF contains more than 100,000 extracted characters. Upload a shorter text PDF or enter the relevant facts manually.');
    }
    if (failedPage) throw new Error('Unreadable page');
    if (!text || !/[\p{L}\p{N}]/u.test(text)) {
      throw new HttpError(422, 'PDF_NO_TEXT', 'No meaningful text could be extracted. Image-only or scanned PDFs need a text-based version or manual entry; OCR is not available.');
    }
    return { filename: file.originalname, text, pageCount: result.numpages };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, 'PDF_EXTRACTION_FAILED', 'This PDF is corrupt, encrypted, or unreadable. Upload an unencrypted text PDF or enter your details manually.');
  }
}
