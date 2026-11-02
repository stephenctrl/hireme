# Hireme

A local-first Resume and Curriculum vitae workspace with independent drafts, manual editing, a live document preview, real PDF export, optional contextual AI assistance, and a separate Adzuna Job assistant workspace. Real job search requires authorised server-side Adzuna credentials; document-aware job discussion additionally requires configured AI.

## Requirements and setup

Use a current Node.js LTS release (Node 22 or newer) and npm. The application is TypeScript, React, Vite, and Express; it does not need a database, account, or AI key for manual use.

1. Run `npm install` in the repository root.
2. Copy `.env.example` to `.env` if you want to change the defaults, configure AI, or configure real job search. For example, in PowerShell: `Copy-Item .env.example .env`.
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

## Job assistant — real Adzuna search

Register through the [Adzuna developer portal](https://developer.adzuna.com/overview) and confirm authorised account access. Set both `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` in the local server environment or uncommitted `.env`, then restart. Never paste credentials into chat or use a `VITE_` prefix. The server uses only `https://api.adzuna.com`; there is no fake job fallback, configurable jobs origin, or employer crawler. Search does not need an AI key. Document-aware analysis/chat uses the separate `OPENAI_API_KEY` settings below.

The Job assistant has independent, session-only criteria, search results, attachment, conversation, and analysis; it does not replace or silently attach either document draft. Enter role/keywords, a supported provider country, location, salary preferences, modality, remote eligibility, and skills. Inspect the outgoing terms, then explicitly search. Only keywords plus skills (joined into the documented `what` parameter), location (`where`), country/page path and `results_per_page=20` go to Adzuna, with server credentials. Changing criteria does not silently search or make old results current.

Requested criteria remain separate from `appliedQuery`. Salary numbers are not sent as filters because the [provider reference](https://developer.adzuna.com/swagger/spec/test2.json) does not establish their pay period. Currency and period remain unknown, even when a salary number is returned. Employer-published, Jobsworth-predicted and unknown provenance are distinct. Missing/predicted pay, unknown currency/period, modality and remote eligibility are never verified matches. Employment contract type/time is not work modality; geographic relevance is not work-authorisation evidence. Skills included in retrieval are not proof of all requirements or applicant skills. Results are candidates, not guarantees. Predicted salary amounts must not be displayed without the required Jobsworth attribution below.

Open the provider-supplied result link to inspect details yourself. Both HTTP and HTTPS Adzuna country-domain redirects are supported without changing their attribution/query strings. Malformed links, credentials in URLs, nondefault ports, other hosts, and non-job paths are omitted. Provider HTML is decoded to plain text; no provider images, logos, embedded scripts or tracking resources are fetched. Descriptions are incomplete excerpts. Explicit pages and the provider total do not establish exhaustive coverage or a deduplicated/verified-match count.

Attach a PDF or explicitly reuse a document snapshot only when you want document-aware analysis. Extraction alone sends nothing to AI. Analyse selected results (at most five) or send a job message only after reviewing the AI disclosure. The configured AI receives the explicit attachment/source, criteria, conversation and authoritative server listing excerpts; Adzuna receives none of the document, source, contact details or conversation. Evidence quotes are checked against the attached facts and that listing's title/excerpt; missing evidence is not proof that you lack a skill. Quotes are provenance checks, not proof that AI interpretation is correct. Review results and explicitly apply proposed criteria; applying a proposal does not search, change either document, submit an application, or contact an employer.

Search snapshots contain only public listing data, criteria and page, expire after ten minutes, and are capped at twenty searches per local server instance. Restart, expiry or eviction requires a fresh search; browser-supplied job bodies/URLs cannot restore context. Changed criteria also require a fresh search before analysing old results. Job state is not added to saved document drafts. Removing/replacing an attachment invalidates its analysis context; reset conversation retains criteria/results/attachment; reset workspace clears jobs only; confirmed Clear all drafts also clears the job workspace.

**Currentness limitation:** Adzuna documents `adref` as a re-query reference but its current public endpoint reference omits the corresponding `ad` route and response contract. The server does not invent that endpoint, infer expiry from absence in paginated results, treat search HTTP 410 (documented authorisation failure) as an expired job, or crawl employers. Analyses explicitly label availability/currentness unverified. A provider-specific currentness check cannot be trusted without documented authorised endpoint access; an ordinary redirect does not prove an employer is still hiring. If you discover that a listing is unavailable, dismiss it in the workspace rather than treating it as an analysed live vacancy.

J01–J08 in [REQUIREMENTS.md](REQUIREMENTS.md) and [DESIGN.md §8](DESIGN.md#8-job-assistant) define the contracts. Implementation and isolated simulated-provider regressions are not live-provider acceptance. This delivery has no authenticated Adzuna or live AI acceptance evidence because credentials are absent. Intentionally configure authorised accounts and validate actual fields, quota, attribution, result links and AI evidence before relying on the workflow.

The [Adzuna API terms](https://developer.adzuna.com/docs/terms_of_service) impose these constraints:

- Personal job search is a permitted use. The free tier is for evaluation; actual account limits and paid plans are shown in the provider account and may change.
- Organisational use has a 14-day validation trial, not permission for ongoing work or research. Continued organisational use needs written consent; revenue- or lead-generating products need a licence. Do not assume this local app's personal use authorises public or commercial deployment.
- Each displayed advert must carry a linked "Adzuna" label at least 116 × 23 pixels, pointing to the relevant Adzuna country domain. Preserve provider-supplied result links; do not replace them with model-generated URLs.
- Publishing Jobsworth salary estimates requires a linked icon at least 20 × 20 pixels and the words "Adzuna Jobsworth", pointing to `http://www.adzuna.co.uk/jobs/salary-predictor.html`, with the tooltip "Salary estimate powered by Adzuna Jobsworth". Estimates must not be represented as employer-published salary or used as verified published-salary matches.
- On termination, remove acquired Adzuna data from website pages. Do not build indefinite retention into the integration.

All queries must go through Adzuna; contacting third-party listing-content providers breaches the API terms. Confirm your account's current permissions, limits and terms before use. The app applies no assumed free-tier quota and performs no automatic retries.

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

`GET /api/health` returns `{ "status": "ok", "aiConfigured": boolean, "jobsConfigured": boolean }`. These flags mean only that the corresponding server credentials are present; they do not verify authentication, provider availability, quota, or a live search.

## PDFs, fonts, and extraction limits

- Uploads must be a PDF with a valid `%PDF-` signature and PDF or generic binary MIME type, at most **10 MiB (10,485,760 bytes)**, submitted as one multipart field named `file`. Filenames are display-only, never filesystem paths. Uploads use memory storage and are not saved to disk.
- Text extraction uses `pdf-parse` 1.1.1 and its bundled PDF.js engine. The package's parser module is loaded directly to avoid its root module's development-fixture behavior. Unreadable/password-protected PDFs return a clear error; use an unencrypted text PDF or enter details manually. Image-only/scanned files have no usable text and need a text-based version or manual entry. There is **no OCR**. Complex columns, font encodings, and unusual PDF structures can alter reading order or fail extraction; always review the extracted source before using AI.
- Before parsing, uploaded Node.js buffers are normalized to ordinary typed arrays so the legacy PDF.js engine uses correct slice/backing-buffer semantics, including for small pooled multipart uploads.
- Extracted source text is capped at **100,000 characters**. Text line endings are normalized; content is not silently truncated. A shorter source is required if extraction exceeds the limit.
- Export uses `pdf-lib`, embedded dependency-provided Noto Sans fonts, A4 pages, approximately 48-point margins, dark text, explicit line breaks, width-based wrapping, splitting of long tokens, page numbers, and automatic pagination. There is no one-page restriction. All nonempty document fields are represented; stable record IDs are not printed.
- Noto Sans font assets are read locally from `@fontsource/noto-sans`, including available Latin/extended Latin, Greek, Cyrillic, Devanagari, and other supplied subsets at regular/bold weights. They are not downloaded at runtime. This is not universal Unicode coverage: many CJK characters, emoji, and scripts outside the installed Noto Sans subsets are unsupported. Export rejects an unsupported character with its Unicode code point and asks you to replace it/use a supported script; it does not silently delete characters or produce missing-glyph boxes. Complex script shaping, extraction, and PDF viewer behavior can vary; inspect the exported result. Font licensing is included in the font dependency (SIL Open Font License).

Server validation limits are authoritative: a JSON request body may be at most **1 MiB**; document scalar strings **10,000 characters** each; record IDs **100**; document and nested bullet arrays **100 items** each; serialized document **100,000 characters**. AI source text may be **100,000 characters**, target job **20,000**, history **20 messages**, and the combined serialized AI request **150,000 characters**. Document-chat messages remain limited to **4,000 characters** each. Job-chat user messages are limited to **4,000 characters**, while accepted assistant replies and assistant history allow **10,000 characters**, so a valid reply can be included unchanged in a later turn. Oversized content is rejected with an explanation instead of silently dropping facts. Shorten older conversation history or large fields before retrying.

## Privacy and local security boundary

- Drafts live in browser memory by default. Optional saving stores both document drafts, their job descriptions, and uploaded source text in this browser's local storage under `hireme.drafts.v1`. The saved entry represents opt-in consent. Conversations, current AI proposals and the separate Job assistant workspace are session-only. Disabling saving removes the saved copy; confirmed Clear all drafts clears both document tabs, the job workspace and the saved copy.
- Local storage is **not encrypted** and may be accessible to others using the same browser profile, browser extensions, or software with access to that profile. Avoid saving sensitive CV details on shared computers.
- Extraction and export process content in server memory; there is no database, server draft persistence, retained upload directory, or analytics transmission. Requests and document/source/conversation/provider bodies are not logged by the application. In-memory handling does not promise forensic erasure of operating-system memory or swap.
- Clicking an AI action sends the supplied document, retained source text, target job, and conversation to the **configured provider**. That provider's privacy/retention policy applies. No AI request occurs merely because you type, switch tabs, preview, extract, or export a PDF.
- Provider keys stay on the server and are not sent in health responses, API error messages, browser storage, or the client bundle. Treat `.env` and your provider accounts as secrets. Avoid sharing screenshots, credential-bearing URLs or terminal commands containing a key.
- The default server and development server bind to **loopback**. This is a trusted local single-user application, not a hardened hosted service: it has no authentication, accounts, cross-user isolation, or rate limiting. Do not expose it via `0.0.0.0`, a public reverse proxy, tunnel, or shared network without a separate security review and appropriate controls. Other local processes/users can still access a local listening server. Keep Node and dependencies updated, and only process PDFs from sources you trust.

## API and engineering reference

`REQUIREMENTS.md` defines acceptance criteria and `DESIGN.md` defines complete request/response/error contracts. Browser calls use relative `/api` paths:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Key-presence status without contacting the provider |
| `POST /api/extract-pdf` | Bounded in-memory multipart PDF text extraction |
| `POST /api/export-pdf` | Validated manual document to PDF |
| `POST /api/ai` | Truthful personalization, organization, or contextual critique |
| `POST /api/jobs/search` | Strict criteria-only real Adzuna search and bounded public-listing snapshot |
| `POST /api/jobs/assistant` | Separate strict AI job chat/evidence analysis using server-resolved selected listings |

API errors are JSON `{ "error": { "code": "...", "message": "..." } }`, including malformed JSON, upload errors, and unknown API routes. API responses use `Cache-Control: no-store`. Jobs errors distinguish `JOBS_NOT_CONFIGURED` (503), `JOBS_RATE_LIMITED` (429), `JOBS_PROVIDER_ERROR` (502), `JOBS_TIMEOUT` (504), and `JOB_CONTEXT_EXPIRED` (410); listing expiry is not inferred from search failure. Adzuna requests abort after 20 seconds and reject responses larger than 2 MiB. Job criteria limits: keywords/location/remote region 200 characters each; skills 20 × 80 characters; salary bounds finite, nonnegative, at most 1 billion and correctly ordered; uppercase three-letter currency; page 1–1000. Job assistant uses the existing document/source/history/context limits, at most five unique selected listing IDs, and a nonblank final user message for chat.

Provider salary amounts outside the finite nonnegative 0–1 billion range become unknown rather than breaking otherwise usable results. Source links longer than 4,000 characters are omitted with the other invalid rows. Missing, fractional, negative or unsafe-integer provider totals become `null`; an invalid-total limitation is included when a total was supplied. These normalization bounds do not imply a salary match or exhaustive result count.

`server/app.ts` exports `createApp` and `app` separately from `server/index.ts` listening. `createApp` accepts optional `ai`, `jobs` and `distDirectory` overrides. The `jobs` override is `{ appId, appKey, fetch?: typeof fetch, now?: () => number }`; its fetch seam controls only Adzuna transport and does not change the fixed production origin. Snapshots belong to that app instance. AI retains its configured base URL and the common JSON-mode transport. Never point test tooling at a paid provider unintentionally.

Run `npm test` for the permanent server regression suite (`node --import tsx --test server/*.test.ts`). PDF tests generate real Unicode, multipage PDFs and check every printable field and long-token content after extraction from a padded/subarray upload buffer; they exercise actual multipart HTTP uploads with UTF-8 filenames and verify image-only PDFs return `PDF_NO_TEXT`. Jobs tests use actual HTTP routes with controlled Adzuna fetch responses and an isolated loopback AI provider: criteria/privacy boundaries, safe URLs/deduplication, salary/modality uncertainty, missing credentials, rate limits, safe provider errors, timeout/body bounds, snapshot expiry/cap/stale criteria, authoritative AI context, forged IDs/quotes/URLs, and explicit proposals. Tests use no real provider credentials and are not authenticated-provider validation. Run `npm run build` separately for TypeScript checking and the production client build.

No live-provider success is implied by installation or by the health flag. Use the acceptance walkthrough in `REQUIREMENTS.md` to exercise manual drafts, multipage Unicode export, uploads, errors, persistence, and (only with intentionally configured credentials) live AI proposals and conversations.
