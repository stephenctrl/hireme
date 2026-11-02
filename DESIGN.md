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

## 8. Planned Job assistant continuation contract

**Status: design only; no job routes, types, or controls below are implemented.** This section defines the next delivery's interfaces for parallel work. Existing sections describe the Resume/CV delivery. `TODO.txt` item 3 still gates implementation on configured Adzuna credentials and confirmed account access. Do not replace the placeholder or report search success on the strength of this design.

### 8.1 Ownership and provider boundary

- Backend owns new `shared/jobs.ts`, `server/jobs.ts`, job validation/analysis modules, server regression tests, and additive integration in `server/app.ts`. Frontend owns `src/JobAssistant.tsx`, its state, client API functions, scoped styles, and navigation integration. Integration owner updates this design, requirements, and `TODO.txt`.
- Keep `DocumentKind = 'resume' | 'cv'`. Jobs is a navigation destination, not another editable document kind. Do not repurpose `AiRequest` or the document-replacement response for job analysis.
- Use server-only `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`. The fixed upstream origin is `https://api.adzuna.com`; select the country-specific search path from a supported-country allowlist, never from an arbitrary browser-supplied URL. Browser requests remain same-origin `/api` calls.
- The [Adzuna overview](https://developer.adzuna.com/overview), [search documentation](https://developer.adzuna.com/docs/search), and [API terms](https://developer.adzuna.com/docs/terms_of_service) are the provider contract. Follow the account's actual quota; do not hardcode an assumed free-tier allowance. Follow the attribution and usage restrictions recorded in README.
- Adzuna receives search criteria only: role/keywords, country, location, and documented supported query filters. It never receives the attached document, extracted source, contact details, or conversation. Show the actual outgoing search terms so users can inspect them before searching.
- Provider descriptions are excerpts, not full employer requirements. Modality is not supplied as a documented structured field; contract time/type and the `hybrid` sorting option must not be interpreted as working modality. Preserve `salary_is_predicted`; omit estimated values from employer-published salary claims.

### 8.2 Shared job contracts

Define these separately from the existing document contracts. The following is the canonical shape for the planned API; fields are required unless explicitly nullable.

```ts
type PayPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';
type WorkModality = 'any' | 'remote' | 'hybrid' | 'on-site';
type CheckStatus = 'not_requested' | 'matched' | 'not_matched' | 'unverified';

interface JobCriteria {
  keywords: string;
  country: string;
  location: string;
  salary: {
    minimum: number | null;
    maximum: number | null;
    currency: string;
    period: PayPeriod;
  };
  modality: WorkModality;
  remoteEligibility: 'unspecified' | 'worldwide' | 'restricted';
  remoteRegion: string;
  skills: string[];
}

interface CriterionCheck {
  status: CheckStatus;
  reason: string;
}

interface JobListing {
  id: string;
  title: string;
  employer: string;
  location: string;
  modality: Exclude<WorkModality, 'any'> | 'unknown';
  remoteRestrictions: string | null;
  salary: {
    minimum: number | null;
    maximum: number | null;
    currency: string | null;
    period: PayPeriod | null;
    provenance: 'published' | 'predicted' | 'unknown';
  };
  source: 'Adzuna';
  sourceUrl: string;
  postedAt: string | null;
  retrievedAt: string;
  descriptionExcerpt: string;
  checks: Record<'role' | 'location' | 'salary' | 'modality'
    | 'remoteEligibility' | 'skills', CriterionCheck>;
}

interface JobSearchRequest {
  criteria: JobCriteria;
  page: number;
}

interface JobSearchResponse {
  searchId: string;
  criteria: JobCriteria;
  appliedQuery: Record<string, string>;
  limitations: string[];
  listings: JobListing[];
  page: number;
  total: number | null;
  retrievedAt: string;
}

interface JobAssistantRequest {
  action: 'chat' | 'analyze';
  criteria: JobCriteria;
  searchId: string | null;
  listingIds: string[];
  document: ResumeDocument | null;
  sourceText: string;
  messages: ChatMessage[];
}

interface SkillEvidence {
  requirement: string;
  requirementQuote: string;
  documentQuote: string | null;
  explanation: string;
}

interface JobAssistantResponse {
  reply: string;
  proposedCriteria: JobCriteria | null;
  analyses: {
    listingId: string;
    matches: SkillEvidence[];
    gaps: SkillEvidence[];
    limitations: string[];
  }[];
}
```

`country` must belong to the provider's documented supported countries; the UI uses a labelled selector rather than accepting an arbitrary path. Money uses finite, nonnegative values, optional one-sided bounds, minimum not exceeding maximum, and an ISO currency code. A restricted remote search requires a nonblank region; an unanswered restriction remains explicit. Dates are ISO timestamps when the provider supplies an unambiguous timestamp; otherwise use `null`, not an invented posting date.

Reuse strict Zod document/message validation and its existing size ceilings. Bound job keywords/location/region to 500 characters each, skills to 50 nonblank entries of at most 100 characters, page to a positive integer, and each result page to 20 listings. Provider excerpts and AI contexts must be bounded before parsing or serialisation; reject oversized analysis context rather than silently discarding document facts. Validate incoming API shapes and outgoing AI shapes on the server.

### 8.3 Search and evidence semantics

`POST /api/jobs/search` accepts `JobSearchRequest` and returns `JobSearchResponse`. It does not invoke AI or accept document content. Preserve the full requested criteria separately from `appliedQuery`; exclude credentials from that object and all responses/logs. Map only documented provider parameters. Unsupported fields remain visible in `limitations` and listing checks rather than being silently removed from the user's criteria.

Use a 20-second upstream timeout, bounded response reading, safe errors, and `Cache-Control: no-store` on browser responses. Deduplicate within returned pages by provider ID and canonical result URL, preserving provider attribution/query parameters in the actual outbound link. Pagination is explicit and does not imply exhaustive search coverage. The provider's reported total is not a deduplicated or verified-match count.

Salary comparison requires employer-published values, compatible currency and pay period, and sufficient bounds to establish overlap with the desired range. Do not perform FX conversion or assume annual pay because a number looks annual. If provider documentation cannot establish the period, leave it unknown and the check unverified; do not send a numerically misleading salary filter upstream. Predicted or missing salaries are never verified matches.

Structured modality and remote eligibility are unknown unless supported by actual provider evidence. A city in a remote listing is not proof of residence/work-authorisation eligibility, and the absence of the word "remote" is not proof of on-site work. AI may discuss quoted wording but cannot promote an unsupported field or criterion into a verified filter result.

Render unverified candidates explicitly as candidates, never as positions meeting every requested requirement. Any unmet or unverified criterion stays visible. Skills mentioned in a listing are requirements/context, not evidence the applicant possesses them. A provider keyword search establishes retrieval relevance, not semantic proof that all role requirements match.

Store only retrieved public listing data, original criteria, page, and any provider re-query reference in a bounded, request-independent server snapshot keyed by an opaque `searchId`; no documents or conversations belong in that snapshot. Retain snapshots for at most ten minutes and at most twenty searches per local app instance; this is an application bound, not a provider-required cache TTL. Expired/evicted snapshots require a new search and must not fall back to browser-supplied listing descriptions.

`POST /api/jobs/assistant` accepts `JobAssistantRequest`. `chat` needs a nonblank final user message; `analyze` needs an attached nonempty document/source and selected listing IDs. Limit selection to five listings per analysis. The server resolves every ID from the named unexpired search snapshot. Requests cannot introduce arbitrary job URLs or descriptions. Criteria that differ from the snapshot require a new search before analysing those results.

Before analysing a selected listing, use Adzuna's documented re-query mechanism where available. An explicit provider not-found/unavailable response removes it from analysis with an actionable error. Absence from a paginated search alone does not prove expiry. If currentness cannot be established, disclose that limitation; neither an earlier search response nor an HTTP redirect proves the employer is still hiring. Do not crawl third-party employer sites or follow arbitrary URLs server-side to test availability. Users open provider-supplied result links themselves.

### 8.4 AI and error boundaries

Reuse server-side AI configuration, JSON-mode transport conventions, the 60-second timeout, bounded response reading, and safe error envelopes. Use separate job-specific system instructions and schema. All listing excerpts, uploaded documents, user fields, and history are untrusted data, never instructions overriding server rules. Do not claim to have applied, contacted an employer, or changed criteria.

The AI response can propose full criteria but cannot apply them. Display a field-by-field change review and require explicit application; unchanged criteria must remain unchanged. A later search is a separate explicit action. Reject analysis IDs outside the selected server-resolved listings, duplicate IDs, or malformed/oversized output. A supported match requires a document quote and a requirement quote found in the supplied context; validate quoted substrings after consistent whitespace normalisation. Gap records require a listing requirement quote and describe only missing document evidence, not an asserted lack of skill. Quotes establish provenance, not proof that the model's interpretation is correct; retain review warnings.

Use existing `INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`, and `AI_*` codes where applicable. Add job-specific errors to the shared error union when implementing:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 503 | `JOBS_NOT_CONFIGURED` | One or both server credential settings are absent |
| 429 | `JOBS_RATE_LIMITED` | Provider quota/rate limit; include safe retry guidance, never the upstream body |
| 502 | `JOBS_PROVIDER_ERROR` | Provider rejected access, returned malformed data, or could not be reached |
| 504 | `JOBS_TIMEOUT` | Upstream search/re-query timed out |
| 410 | `JOB_CONTEXT_EXPIRED` | Search snapshot expired or was evicted; search again |
| 410 | `JOB_UNAVAILABLE` | Selected listing explicitly reported unavailable by the provider |

Extend health with `jobsConfigured: boolean` only at implementation time. It means both credential settings are present, not that authentication, quota, or live search has been verified. Missing AI configuration must not prevent a configured jobs search; missing jobs configuration must not affect manual editing/extraction/export.

### 8.5 Frontend isolation and privacy lifecycle

Mount a dedicated job workspace without unmounting its session state on tab changes. State comprises criteria, the last submitted search criteria/results, an explicit attached-document snapshot/source, job messages, proposed criteria, analyses, operation flags, errors, and generation counters. Do not derive its document from `active === 'cv' ? 'cv' : 'resume'`.

Offer explicit "Use Resume" and "Use Curriculum vitae" actions. Copy only the selected editable document into job state; include any retained uploaded source only through a separate, clearly labelled opt-in. Identify a snapshot as such; subsequent edits in either document tab do not change the attached context. PDF upload reuses `/api/extract-pdf` and existing validation/extraction errors, shows extracted text for review, and never mutates either editable draft.

Search sends only criteria. An explicit Analyse or Send action sends the attached snapshot/source, selected excerpts, criteria, and relevant conversation to the configured AI provider after the disclosure. No action sends document data to Adzuna or employers. Render provider content as text, never raw HTML; do not load employer logos, tracking images, or other resources embedded in descriptions.

Changing criteria makes previous results visibly stale until a new search. Changing/removing the attached document invalidates analyses and document-bearing conversation context. Reset conversation clears chat/proposals/analyses, retaining criteria, results, and attachment. Reset job workspace clears all job state, not either document draft. Confirmed Clear all drafts clears all three workspaces and existing saved document data. Footer disclosures must distinguish session-only job state from the unchanged opt-in storage of the two editable drafts.

Capture request context at dispatch and use operation-specific generations plus AbortControllers. Document removal, relevant edits, new searches, and resets invalidate affected completions; stale replies cannot repopulate context or appear grounded in current data. Browser cancellation cannot retract data already sent to a provider; disclose this rather than promising remote erasure. Tab switching alone does not cancel a request or move its result to another workspace.

Preserve the current responsive dark-mode conventions, semantic labels, visible keyboard focus, loading/error announcements, and usable narrow-screen stacking. No applications, employer contact, accounts, remote draft storage, or job-state browser persistence are added by this contract.

### 8.6 Implementation and verification gate

Once credentials are configured, verify one intentional authenticated Adzuna search without logging credential-bearing URLs or provider bodies. Confirm field availability, quota and attribution with the real account before implementing parallel backend/frontend slices against these contracts. If provider evidence requires a contract change, update it before dispatching work rather than inventing fields.

Integration verification must exercise the actual UI and API: query and result links, explicit unsupported salary/modality/geography, document consent/removal, malformed and image-only PDFs, rate limits/unavailable listings/provider failure, snapshot expiry, stale responses after changes/reset, independent drafts, keyboard navigation, and narrow screens. Permanent regression tests cover those consumer-visible boundaries; mocked providers do not count as live-provider verification. No real search or AI success is implied by these planned contracts.
