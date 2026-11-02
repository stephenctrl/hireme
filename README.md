# Hireme

A local-first Resume and Curriculum vitae workspace with independent drafts, manual editing, a live document preview, real PDF export, and optional contextual AI assistance. The Job assistant tab is intentionally unavailable; its deferred scope is in `TODO.txt`.

## Requirements and setup

Use a current Node.js LTS release (Node 22 or newer) and npm. The application is TypeScript, React, Vite, and Express; it does not need a database, account, or AI key for manual use.

1. Run `npm install` in the repository root.
2. Copy `.env.example` to `.env` if you want to change the defaults or configure AI. For example, in PowerShell: `Copy-Item .env.example .env`.
3. Run `npm run dev`.
4. Open the Vite URL shown in the terminal (normally `http://127.0.0.1:5173`). Vite proxies relative `/api` requests to `http://127.0.0.1:3001`.

For the built application, run `npm run build`, then `npm start` and open `http://127.0.0.1:3001`. The build command typechecks the project and builds the browser bundle into `dist/`. The server runs through `tsx`; install development dependencies on the machine that runs this local application. Express serves `dist/` and the API from the same origin. Rebuild after browser-code changes; restart after changing server environment settings.

If you change `PORT`, also adjust the API proxy target in `vite.config.ts` for development. The browser never needs the provider key or a provider URL.

## Manual use without credentials

- Choose **Resume** or **Curriculum vitae** in the header. Each has its own draft and conversation.
- Enter contact details, summary, experience, education, skills, projects, certifications, languages, and additional named sections. Add/remove repeated entries and use multiple achievement bullets as needed.
- The document preview reflects your current fields. Empty fields and records containing only UI IDs are not printed.
- Export a nonempty draft to a real, selectable-text PDF. This is an in-memory server operation, not browser printing, and it works with no AI key. Both kinds use the same minimalist, paginated layout; the download names are `hireme-resume.pdf` and `hireme-cv.pdf`.
- For Resume, you can upload a PDF CV and review its extracted text as a separate source. Extraction does not silently replace the editable draft. Replace or remove the source when appropriate.
- Resume personalization needs supplied document/source facts and a target job description. CV organization needs supplied facts. AI responses are proposals: review them and explicitly apply or discard them. Applying a proposal replaces that tab's editable document, not the retained uploaded source or the other tab's draft.
- Each contextual assistant can critique the active document and job context; a discussion-only reply does not create a replacement document. A proposed document requires explicit application.

With no configured key, AI actions explain that `OPENAI_API_KEY` must be configured on the server. There is no fake AI fallback. Manual editing, extraction, and PDF export remain available.

## Selected jobs provider — implementation prerequisite

**Adzuna was selected for the Job assistant continuation. Search and matching are not implemented yet.** `TODO.txt` requires obtaining credentials and documenting usage restrictions before implementation.

The planned acceptance criteria are J01–J08 in [REQUIREMENTS.md](REQUIREMENTS.md); API shapes, evidence rules, ownership, and privacy/reset boundaries are in [DESIGN.md §8](DESIGN.md#8-planned-job-assistant-continuation-contract). These are implementation contracts, not available features.

Register through the [Adzuna developer portal](https://developer.adzuna.com/overview) to obtain an app ID and key. Configure `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` only in the local server environment or uncommitted `.env`; these are the planned integration settings, not settings consumed by the current app. Never paste credentials into chat or use a `VITE_` prefix. Live AI matching also needs the existing `OPENAI_API_KEY` configuration below.

The [Adzuna API terms](https://developer.adzuna.com/docs/terms_of_service) impose these constraints:

- Personal job search is a permitted use. The free tier is for evaluation; actual account limits and paid plans are shown in the provider account and may change.
- Organisational use has a 14-day validation trial, not permission for ongoing work or research. Continued organisational use needs written consent; revenue- or lead-generating products need a licence. Do not assume this local app's planned personal use authorises public or commercial deployment.
- Each displayed advert must carry a linked "Adzuna" label at least 116 × 23 pixels, pointing to the relevant Adzuna country domain. Preserve provider-supplied result links; do not replace them with model-generated URLs.
- Salary estimates have additional Jobsworth attribution requirements and must not be represented as employer-published salary. Prefer omitting estimates from published-salary matching.
- On termination, remove acquired Adzuna data from website pages. Do not build indefinite retention into the integration.

Implementation must also preserve the provider's actual field limitations: unsupported modality, unknown pay period/currency, missing salary, and predicted salary are not verified matches. Confirm account access and current terms before implementing; this section does not claim an authenticated search has succeeded.

## Optional AI configuration

The server reads `.env` through `dotenv`. Defaults:

```dotenv
HOST=127.0.0.1
PORT=3001
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Set `OPENAI_API_KEY`, choose the desired base URL/model, and restart the server. Never prefix secrets with `VITE_`; Vite-prefixed settings can enter the browser bundle. Do not commit `.env`.

The provider must support **OpenAI-compatible Chat Completions with JSON mode**, including `response_format: { "type": "json_object" }`. The server POSTs to `<OPENAI_BASE_URL without trailing slash>/chat/completions`, sends bearer authorization, and aborts the provider operation after 60 seconds. Include `/v1` in the base URL if your provider requires it; do not put `/chat/completions` in the base URL. Prefer HTTPS except for a trusted local provider. Provider charges and retention terms are your responsibility.

Server-authored instructions require factual rewriting, no invented achievements or qualifications, and treating uploaded documents/job descriptions/chat as untrusted source material rather than higher-priority instructions. This reduces but cannot eliminate model mistakes or prompt injection: always verify every factual detail before applying or sending a document. Input and proposed output must pass the same complete document schema. Invalid provider JSON/schema, upstream HTTP/network failures, missing configuration, and timeouts return safe actionable errors; raw upstream responses are not exposed. No partial proposal is applied by the server.

`GET /api/health` returns `{ "status": "ok", "aiConfigured": boolean }`. The flag means only that a nonblank server key is present; it does not verify the provider or key.

## PDFs, fonts, and extraction limits

- Uploads must be a PDF with a valid `%PDF-` signature and PDF or generic binary MIME type, at most **10 MiB (10,485,760 bytes)**, submitted as one multipart field named `file`. Filenames are display-only, never filesystem paths. Uploads use memory storage and are not saved to disk.
- Text extraction uses `pdf-parse` 1.1.1 and its bundled PDF.js engine. The package's parser module is loaded directly to avoid its root module's development-fixture behavior. Unreadable/password-protected PDFs return a clear error; use an unencrypted text PDF or enter details manually. Image-only/scanned files have no usable text and need a text-based version or manual entry. There is **no OCR**. Complex columns, font encodings, and unusual PDF structures can alter reading order or fail extraction; always review the extracted source before using AI.
- Before parsing, uploaded Node.js buffers are normalized to ordinary typed arrays so the legacy PDF.js engine uses correct slice/backing-buffer semantics, including for small pooled multipart uploads.
- Extracted source text is capped at **100,000 characters**. Text line endings are normalized; content is not silently truncated. A shorter source is required if extraction exceeds the limit.
- Export uses `pdf-lib`, embedded dependency-provided Noto Sans fonts, A4 pages, approximately 48-point margins, dark text, explicit line breaks, width-based wrapping, splitting of long tokens, page numbers, and automatic pagination. There is no one-page restriction. All nonempty document fields are represented; stable record IDs are not printed.
- Noto Sans font assets are read locally from `@fontsource/noto-sans`, including available Latin/extended Latin, Greek, Cyrillic, Devanagari, and other supplied subsets at regular/bold weights. They are not downloaded at runtime. This is not universal Unicode coverage: many CJK characters, emoji, and scripts outside the installed Noto Sans subsets are unsupported. Export rejects an unsupported character with its Unicode code point and asks you to replace it/use a supported script; it does not silently delete characters or produce missing-glyph boxes. Complex script shaping, extraction, and PDF viewer behavior can vary; inspect the exported result. Font licensing is included in the font dependency (SIL Open Font License).

Server validation limits are authoritative: a JSON request body may be at most **1 MiB**; document scalar strings **10,000 characters** each; record IDs **100**; document and nested bullet arrays **100 items** each; serialized document **100,000 characters**. AI source text may be **100,000 characters**, target job **20,000**, each message **4,000**, history **20 messages**, and the combined serialized AI request **150,000 characters**. Oversized content is rejected with an explanation instead of silently dropping facts. Shorten older conversation history or large fields before retrying.

## Privacy and local security boundary

- Drafts live in browser memory by default. Optional saving stores both drafts, their job descriptions, and uploaded source text in this browser's local storage under `hireme.drafts.v1`. The saved entry represents opt-in consent. Conversations and current AI proposals are session-only. Disabling saving removes the saved copy; Clear all drafts clears both tabs and the saved copy after confirmation.
- Local storage is **not encrypted** and may be accessible to others using the same browser profile, browser extensions, or software with access to that profile. Avoid saving sensitive CV details on shared computers.
- Extraction and export process content in server memory; there is no database, server draft persistence, retained upload directory, or analytics transmission. Requests and document/source/conversation/provider bodies are not logged by the application. In-memory handling does not promise forensic erasure of operating-system memory or swap.
- Clicking an AI action sends the supplied document, retained source text, target job, and conversation to the **configured provider**. That provider's privacy/retention policy applies. No AI request occurs merely because you type, switch tabs, preview, extract, or export a PDF.
- The API key stays on the server and is not sent in health responses, API error messages, browser storage, or the client bundle. Treat `.env` and your provider account as secrets. Avoid sharing screenshots or terminal commands containing a key.
- The default server and development server bind to **loopback**. This is a trusted local single-user application, not a hardened hosted service: it has no authentication, accounts, cross-user isolation, or rate limiting. Do not expose it via `0.0.0.0`, a public reverse proxy, tunnel, or shared network without a separate security review and appropriate controls. Other local processes/users can still access a local listening server. Keep Node and dependencies updated, and only process PDFs from sources you trust.

## API and engineering reference

`REQUIREMENTS.md` defines acceptance criteria and `DESIGN.md` defines complete request/response/error contracts. Browser calls use relative `/api` paths:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Key-presence status without contacting the provider |
| `POST /api/extract-pdf` | Bounded in-memory multipart PDF text extraction |
| `POST /api/export-pdf` | Validated manual document to PDF |
| `POST /api/ai` | Truthful personalization, organization, or contextual critique |

API errors are JSON `{ "error": { "code": "...", "message": "..." } }`, including malformed JSON, upload errors, and unknown API routes. API responses use `Cache-Control: no-store`. `server/app.ts` exports `createApp` and `app` separately from `server/index.ts` listening, allowing an integration harness to use a temporary local port and explicit provider configuration. `createApp` accepts optional `ai` and `distDirectory` overrides; never point test tooling at a paid provider unintentionally.

Run `npm test` for the permanent server regression suite (`node --import tsx --test server/*.test.ts`). It generates real Unicode, multipage PDFs and checks every printable field and long-token content after extraction from a padded/subarray upload buffer; it exercises actual multipart HTTP uploads with UTF-8 filenames (including literal mojibake-looking names) and verifies image-only PDFs return `PDF_NO_TEXT`. The tests bind only a temporary loopback port, keep files in memory, and make no provider requests. Run `npm run build` separately for TypeScript checking and the production client build.

No live-provider success is implied by installation or by the health flag. Use the acceptance walkthrough in `REQUIREMENTS.md` to exercise manual drafts, multipage Unicode export, uploads, errors, persistence, and (only with intentionally configured credentials) live AI proposals and conversations.
