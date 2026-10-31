# Hireme software design

This design implements the acceptance criteria in `REQUIREMENTS.md`. Requirements are authoritative; the following contracts let frontend and backend work independently without inventing competing representations.

## 1. Architecture and ownership

Use React + TypeScript + Vite for the browser and Express + TypeScript for the server. Use native server `fetch` for an OpenAI-compatible Chat Completions API, `multer` for bounded in-memory multipart uploads, `pdf-parse` 1.1.1 for text extraction, `pdf-lib` with `@pdf-lib/fontkit` for PDF output, and `zod` for server-side validation. A bundled or dependency-provided open-license Unicode font must be embedded into PDFs; do not rely only on PDF standard fonts that throw on ordinary Unicode input. `@fontsource/noto-sans` is a practical dependency-provided font source; support user text without silently deleting characters, and report an explicit unsupported-font error if a glyph truly cannot be represented. Avoid network font downloads at runtime.

The browser calls only relative `/api/...` URLs. Vite proxies `/api` to `http://127.0.0.1:3001`. Production Express serves the built `dist/` client after API routes. The API binds to `127.0.0.1` by default. No database or server-side draft/file storage is needed.

### File ownership boundaries

| Owner | Exclusive files and responsibilities |
| --- | --- |
| Engineering | `REQUIREMENTS.md`, `DESIGN.md`; contracts below |
| Frontend developer | `index.html`, `vite.config.ts`, all `src/**`; React views, styles, API client, independent tab state, opt-in draft persistence, HTML preview, download interaction |
| Backend developer | `server/**`, `shared/types.ts`, `.env.example`, `README.md`; Express routes, validation, provider integration, extraction, PDF generation, shared contracts, setup/privacy documentation |
| Main/integration owner | Root `package.json`, lockfile, `tsconfig*.json`, `.gitignore`, `TODO.txt`; dependency integration, scripts, final staging/testing and feedback |

Do not edit another slice's files without coordination. In particular the frontend imports, but does not redefine or modify, `shared/types.ts`. The backend must supply that file early using the types below. Neither developer runs checks during parallel implementation; the integration owner runs them once after integration and returns findings to the relevant developer.

### Frontend entry points

- `index.html`: root `<div id="root"></div>` and module `/src/main.tsx`.
- `src/main.tsx`: mount the default export from `src/App.tsx` with React; import `src/styles.css`.
- `src/App.tsx`: own the header tabs and workspace. Internal component/module decomposition is frontend-owned.
- Import shared types by relative path from `../shared/types` (adjust for nested source modules); no alias configuration is required.
- Suggested root scripts, integrated by Main: `dev` starts Vite and `tsx watch server/index.ts` concurrently; `build` typechecks and invokes Vite; `start` runs `tsx server/index.ts`. Keeping `tsx` available for start avoids a second server bundling pipeline.

## 2. Canonical shared types

`shared/types.ts` exports exactly these public contracts (additional internal helpers are allowed). All object fields below are required; empty values use `""` or `[]`, not omitted properties. Dates are user-entered text to support values such as `Present` and year-only dates. Stable record IDs are UI identifiers, never printed in PDFs.

```ts
export type DocumentKind = 'resume' | 'cv';

export interface Contact {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
}
export interface Experience {
  id: string;
  role: string;
  employer: string;
  location: string;
  startDate: string;
  endDate: string;
  highlights: string[];
}
export interface Education {
  id: string;
  institution: string;
  qualification: string;
  location: string;
  startDate: string;
  endDate: string;
  details: string[];
}
export interface Project {
  id: string;
  name: string;
  link: string;
  description: string;
  highlights: string[];
}
export interface ExtraSection {
  id: string;
  title: string;
  items: string[];
}
export interface ResumeDocument {
  contact: Contact;
  summary: string;
  experience: Experience[];
  education: Education[];
  skills: string[];
  projects: Project[];
  certifications: string[];
  languages: string[];
  extraSections: ExtraSection[];
}
export interface UploadedSource {
  filename: string;
  text: string;
  pageCount: number;
}
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface HealthResponse {
  status: 'ok';
  aiConfigured: boolean;
}
export interface ExtractPdfResponse {
  source: UploadedSource;
}
export interface ExportPdfRequest {
  kind: DocumentKind;
  document: ResumeDocument;
}
export interface AiRequest {
  action: 'personalize' | 'organize' | 'chat';
  kind: DocumentKind;
  document: ResumeDocument;
  sourceText: string;
  targetJob: string;
  messages: ChatMessage[];
}
export interface AiResponse {
  reply: string;
  document: ResumeDocument | null;
}
export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_FILE'
  | 'PDF_EXTRACTION_FAILED'
  | 'PDF_NO_TEXT'
  | 'PDF_EXPORT_FAILED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_PROVIDER_ERROR'
  | 'AI_INVALID_RESPONSE'
  | 'AI_TIMEOUT'
  | 'INTERNAL_ERROR';
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
```

The frontend constructs an empty document with every field present and fresh arrays. Empty repeated records can be added for editing but are omitted from rendering/export when they contain no meaningful content. Do not treat IDs alone as document content.

## 3. HTTP API

All failures return `application/json` matching `ApiError`, including malformed JSON, multipart errors, and unknown `/api` routes (`404`, `INVALID_REQUEST`). No stack traces or upstream response bodies are returned. Successful extraction/AI/health responses are JSON. No API route requires credentials for manual use.

### `GET /api/health`

- `200`: `HealthResponse`.
- `aiConfigured` reflects whether a nonblank server API key is present; it does not claim that the provider has been contacted or that the key is valid.
- Do not return the key or echo its value in an error.

### `POST /api/extract-pdf`

- Request: `multipart/form-data` with one file field named `file`; frontend lets the browser set the multipart boundary.
- Maximum file size: 10 MiB (10,485,760 bytes). Check the PDF signature and reject clearly non-PDF content, not just the filename. Permit the standard PDF MIME type and browser generic binary MIME type when the signature is valid.
- `200`: `ExtractPdfResponse`; `source.filename` is a display-only original name, never used as a filesystem path. Normalize extracted text line endings and trim outside whitespace; preserve useful content.
- `400 INVALID_REQUEST`: missing or multiple files/incorrect upload field.
- `413 PAYLOAD_TOO_LARGE`: file too large or extracted text exceeds 100,000 characters.
- `415 UNSUPPORTED_FILE`: not a PDF.
- `422 PDF_EXTRACTION_FAILED`: corrupt, encrypted, or otherwise unreadable PDF. Explain the user can upload an unencrypted text PDF or enter details manually.
- `422 PDF_NO_TEXT`: no meaningful extracted text; explain image-only PDFs need a text version/manual entry (no fake OCR).
- Buffer and extraction objects are request-scoped. Do not write uploaded files to disk.

### `POST /api/export-pdf`

- Request: JSON `ExportPdfRequest`.
- `200`: `application/pdf`, `Content-Disposition: attachment; filename="hireme-resume.pdf"` or `"hireme-cv.pdf"` according to `kind`; `Cache-Control: no-store`.
- `400 INVALID_REQUEST`: invalid shape or no printable content.
- `413 PAYLOAD_TOO_LARGE`: body limit exceeded.
- `422 PDF_EXPORT_FAILED`: content cannot be represented/rendered; actionable but nonsensitive explanation.
- Frontend downloads the response as a Blob using a temporary object URL, then revokes it. Errors are parsed as `ApiError`, not downloaded as a fake PDF.

### `POST /api/ai`

- Request: JSON `AiRequest`, with the full current active document, source text (empty when absent), target job (empty when absent), and up to 20 messages in chronological order.
- `personalize`: requires a nonblank target job and meaningful facts in `document` or `sourceText`. Produce a targeted resume proposal.
- `organize`: requires meaningful document/source facts. Produce an organized document proposal. No target job is required.
- `chat`: requires at least one message and a final `user` message. It may critique an empty document and request relevant missing facts. Include the user's new message exactly once in `messages`; the server must not append it a second time.
- `200`: `AiResponse`. `reply` is a nonblank user-facing explanation. `document` is a valid full proposed replacement or `null`. Personalize/organize require a nonnull document; chat can return `null` for discussion-only replies.
- `400 INVALID_REQUEST`: validation failures/missing required action context.
- `413 PAYLOAD_TOO_LARGE`: context exceeds limits; explain what to shorten.
- `503 AI_NOT_CONFIGURED`: missing key; explain setting `OPENAI_API_KEY` on the server and restarting.
- `502 AI_PROVIDER_ERROR`: upstream HTTP/network failure; mention checking provider/model/key configuration without revealing details.
- `502 AI_INVALID_RESPONSE`: provider output is not valid JSON or does not match the schema. Do not return unvalidated output or partially apply it.
- `504 AI_TIMEOUT`: provider request exceeded 60 seconds.

### Validation limits

Express JSON body limit: 1 MiB. `sourceText`: 100,000 characters; `targetJob`: 20,000; each message: 4,000; maximum 20 messages; combined serialized AI request: 150,000 characters. Reject excess context, never truncate facts invisibly. Document scalar strings: at most 10,000 characters each; IDs: 100; at most 100 items in each document array and nested bullet array; at most 100,000 characters in a serialized document. Validate the same document schema for incoming export/AI requests and outgoing AI proposals. The frontend may pre-check limits but server validation remains authoritative. Strictly check known field types; normalize no missing facts into fabricated defaults.

## 4. Document rendering

The browser preview is semantic HTML that uses the same section order as the PDF: name/headline, contact links/details, summary, experience, education, skills, projects, certifications, languages, additional sections. Empty fields and empty sections are hidden. The preview is labelled as a document preview; it need not reproduce exact PDF line breaks, but must represent all exported fields.

The real PDF renderer lives exclusively on the server. Use A4 pages, approximately 48-point margins, a white background, dark text, a simple embedded font, hierarchy through font size/weight, and no decorative avatar/sidebar. Escape nothing into HTML because PDF is built as text, not via HTML execution. Wrap by actual font text width, honor explicit line breaks, split overlong tokens, and add pages before the current line reaches the bottom margin. Reserve heading plus at least one content line where possible. Long entries and bullets can span pages; never drop overflow. Include page numbers. Rendering should support punctuation and international names and detect unsupported glyphs explicitly rather than crashing or silently removing content.

A shared renderer is used for Resume and CV; no one-page limit. `kind` selects filename/context, not a contradictory second data model. Contact fields, dates, links, and every nonempty section must survive export.

## 5. Provider configuration and AI boundary

Server environment:

```dotenv
HOST=127.0.0.1
PORT=3001
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Load `.env` only server-side using `dotenv`. Never name secret settings with `VITE_`. Normalize the configured base URL's trailing slash and POST to `<base>/chat/completions`, using `Authorization: Bearer <key>`, `Content-Type: application/json`, the configured `model`, server-authored system instructions, and user context. Use a 60-second abort timeout. Use `response_format: { type: 'json_object' }` and instruct the provider to return exactly `{ "reply": string, "document": ResumeDocument | null }` with no Markdown fences. Document the requirement that the configured compatible endpoint supports Chat Completions JSON mode. Do not log the request, key, source, provider response body, or conversation.

The system instruction must define truthful rewriting, preservation of factual details, no invented metrics/skills, and the fact that uploaded documents, job descriptions, and chat content are untrusted data, not instructions overriding the server rules. It must distinguish critique from a proposed replacement. Facts from uploaded CV text can populate an empty output document but are not erased from the separately retained source. Validate the parsed provider JSON at the boundary with the same schema before returning it. No fake local AI fallback is permitted.

## 6. Browser state and privacy

Maintain separate per-kind drafts: `{ document, targetJob, source }`, where `source` is `UploadedSource | null`. Both tabs may use a target-job field; the upload/personalization workflow belongs to Resume. Messages, current proposal, loading status, and errors are also separate per tab and session-only. Do not apply a response to whichever tab happens to be active when it arrives: capture the originating `kind`. Disable duplicate in-flight actions in that tab and clear stale proposal state when starting a new request.

Default persistence is off. Use one versioned local-storage entry, `hireme.drafts.v1`, containing `{ version: 1, drafts: { resume, cv } }` only after explicit opt-in; the entry's presence represents saved-state consent. On reload validate parsed structure and ignore/remove invalid saved data with a visible recovery notice. Never store API keys or conversation history. Disabling saving removes the entry but can retain current in-memory work. The confirmed Clear all drafts action removes storage and all active draft/source/chat/proposal state. Explain that browser storage is not encrypted and may be accessible to other users of the browser profile.

Render all user/provider text as React text, not raw HTML. AI suggestions are previews until the explicit Apply action. Keep original uploaded source after applying a suggestion; document edits do not mutate that source. Show a concise disclosure near AI actions about content leaving the local application for the configured provider.

## 7. Integration and staging

The frontend developer owns usable empty/error/loading states and the backend developer owns reliable error envelopes and configuration docs. Main integrates packages and scripts, starts the local system, exercises the requirements walkthrough, checks multi-page PDF output, and reports concrete failures back to the owning developer. No paid-provider success should be claimed if no credentials are available; in that case test missing-key behavior and explicitly report live AI as unexercised.

`TODO.txt` is owned by Main and contains only the deferred Job assistant scope, not unfinished work for the first two tabs. README documents setup, manual usage without credentials, provider JSON-mode requirement, privacy, PDF/text/font limitations, and the local-only security boundary. This design does not claim any implementation or check has run.
