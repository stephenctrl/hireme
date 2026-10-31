import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ExtractPdfResponse, HealthResponse } from '../shared/types.js';
import { errorHandler, HttpError } from './errors.js';
import { extractPdf } from './extract.js';
import { renderPdf } from './pdf.js';
import { requestAi } from './ai.js';
import type { AiConfiguration } from './ai.js';
import { validateAi, validateExport } from './validation.js';

export interface AppConfiguration {
  ai: AiConfiguration;
  distDirectory: string;
}

export function createApp(overrides: Partial<AppConfiguration> = {}) {
  const configuration: AppConfiguration = {
    ai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    },
    distDirectory: fileURLToPath(new URL('../dist/', import.meta.url)),
    ...overrides,
  };
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  const api = express.Router();
  api.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '1mb', strict: true }));
  api.get('/health', (_request, response) => {
    const health: HealthResponse = { status: 'ok', aiConfigured: Boolean(configuration.ai.apiKey.trim()) };
    response.json(health);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8',
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
  }).single('file');
  api.post('/extract-pdf', (request, response, next) => {
    upload(request, response, (error: unknown) => {
      if (error) {
        next(error instanceof multer.MulterError ? error : new HttpError(400, 'INVALID_REQUEST', 'The multipart upload is malformed. Upload exactly one PDF in the file field named "file".'));
      } else {
        next();
      }
    });
  }, async (request, response) => {
    if (!request.file) throw new HttpError(400, 'INVALID_REQUEST', 'Select exactly one PDF file using the file field named "file".');
    const result: ExtractPdfResponse = { source: await extractPdf(request.file) };
    response.json(result);
  });
  api.post('/export-pdf', async (request, response) => {
    const input = validateExport(request.body);
    const bytes = await renderPdf(input.document);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="hireme-${input.kind}.pdf"`);
    response.send(Buffer.from(bytes));
  });
  api.post('/ai', async (request, response) => {
    const input = validateAi(request.body);
    response.json(await requestAi(input, configuration.ai));
  });
  api.use((_request, _response, next) => next(new HttpError(404, 'INVALID_REQUEST', 'This API route does not exist.')));
  app.use('/api', api);
  app.use(express.static(configuration.distDirectory, { index: false }));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || !request.accepts('html')) return next();
    response.sendFile(join(configuration.distDirectory, 'index.html'), error => {
      if (error) next(new HttpError(404, 'INVALID_REQUEST', 'The frontend build is unavailable. Run npm run build, then restart the server, or use npm run dev.'));
    });
  });
  app.use((_request, _response, next) => next(new HttpError(404, 'INVALID_REQUEST', 'This route does not exist.')));
  app.use(errorHandler);
  return app;
}

export const app = createApp();
export default app;
