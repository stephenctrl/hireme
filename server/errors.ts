import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import type { ApiError, ApiErrorCode } from '../shared/types.js';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  let status = 500;
  let code: ApiErrorCode = 'INTERNAL_ERROR';
  let message = 'The server could not complete the request. Please try again.';
  if (error instanceof HttpError) {
    ({ status, code, message } = error);
  } else if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'PDF uploads must be at most 10 MiB (10,485,760 bytes).';
    } else {
      status = 400;
      code = 'INVALID_REQUEST';
      message = 'Upload exactly one PDF using the file field named "file", without other upload fields.';
    }
  } else if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The request body exceeds 1 MiB. Shorten the document or AI context.';
    } else if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_REQUEST';
      message = 'The request body is not valid JSON.';
    } else if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
      status = 400;
      code = 'INVALID_REQUEST';
      message = 'Use a UTF-8 JSON request body with a supported content encoding.';
    }
  } else if (error instanceof Error && /multipart|boundary|unexpected end of form/i.test(error.message)) {
    status = 400;
    code = 'INVALID_REQUEST';
    message = 'The multipart upload is malformed. Select one PDF and try uploading it again.';
  }
  const body: ApiError = { error: { code, message } };
  response.status(status).json(body);
};
