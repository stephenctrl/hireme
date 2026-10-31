# Hireme requirements

## Scope and priority

Hireme is a local-first web application for preparing truthful, readable application documents. Deliver the **Resume** and **Curriculum vitae** tabs; the **Job assistant** tab is deliberately deferred. Requirements and functional acceptance criteria below precede the implementation design in `DESIGN.md`.

## Functional acceptance criteria

### Workspace and navigation

- **F01 — Navigation:** The header contains the Hireme wordmark and Resume, Curriculum vitae, and Job assistant tabs. Selecting a tab updates its active styling and displayed content without losing another tab's draft.
- **F02 — Appearance:** Use a responsive dark charcoal interface, restrained lime/green accent, readable contrast, visible focus states, labelled inputs, and accessible expandable sections. On wide screens show the editor, document preview, and contextual assistant in a usable workspace; on small screens stack these areas without horizontal page overflow.
- **F03 — Honest empty states:** Empty previews explain how to start. Loading, success, validation, extraction, network, and missing-AI-configuration states are visible and actionable. Never present fabricated AI responses or sample details as the user's content.

### Resume

- **F04 — Manual authoring:** Users can enter contact information, a professional summary, multiple experiences, education records, skills, projects, certifications, languages, and additional named sections. Repeated records can be added and removed. Sections expand and collapse. Experience and project achievements support multiple bullets.
- **F05 — Manual output:** Editing immediately updates a readable document preview. A nonempty manual draft exports to a real, selectable-text PDF without an API key or AI request. Long content paginates rather than being clipped. A completely empty document cannot be exported.
- **F06 — Existing CV source:** Users can alternatively upload a PDF CV. The application displays its filename and extracted text for review, retains that source separately from the editable output, and allows replacement/removal. Only PDF uploads of at most 10 MiB are accepted. Unreadable, encrypted, or image-only files return an explicit error; OCR is not promised.
- **F07 — Targeted resume:** With uploaded CV text or manually entered facts, a target job description, and configured AI, users can request a personalized resume. The result may reorganize, prioritize, and rephrase only supplied facts, not invent skills, qualifications, employers, dates, or achievements. The proposed document is explicitly applied by the user; generating it does not silently overwrite the current draft.

### Curriculum vitae

- **F08 — Independent CV draft:** This tab has its own editable contact, summary, experience, education, skills, projects, certifications, languages, and custom-section data, independent of the Resume draft. The same manual preview and PDF export work without AI.
- **F09 — AI organization:** Users can ask configured AI to organize their entered CV facts into a clear minimalist document. Missing facts stay missing. The result is a proposal with an explicit Apply action, not an automatic mutation.

### Contextual assistant

- **F10 — Context:** Each functional tab has a separate assistant conversation. Requests include the active tab's current document and target job, plus any uploaded source belonging to that tab. The assistant can critique and suggest concrete improvements based on this context.
- **F11 — Suggestions:** A chat reply can include a proposed revised document. Show a clear Apply suggestion control only when a valid proposed document exists. Applying replaces only the active tab's document, retaining its original source and leaving the other tab untouched. Users can discard a proposal.
- **F12 — Truthfulness and configuration:** AI uses a real OpenAI-compatible HTTP provider through the local server. The API key never enters the client bundle, local storage, or API responses. Without a configured key, manual editing/extraction/export still function and AI actions explain what server configuration is missing.

### Persistence, privacy, and deferred scope

- **F13 — Draft persistence:** Drafts are independent and remain available when switching tabs. Browser persistence is opt-in and clearly labelled as local to this browser. When enabled, persist document fields, target job, and source text for both tabs; disclose that source CV content is included. Conversations are session-only. Disabling persistence removes the saved copy. A Clear all drafts action clears both drafts, sources, conversations, and the saved copy after confirmation.
- **F14 — Data handling:** Extraction and PDF rendering are in memory, without server-side file retention. AI disclosure states that clicking an AI action sends the supplied document/source/job/conversation to the configured provider. Do not send document content for analytics or log it on the server. Provider retention remains subject to that provider's policy.
- **F15 — Deferred Job assistant:** The third tab is a polished, explicitly unavailable placeholder. It performs no fake search or matching. `TODO.txt` describes future matching by role, salary/pay, work modality, and uploaded CV, plus the need for a real jobs source and matching implementation.

## Operational requirements

- A conventional TypeScript React client and TypeScript HTTP server run locally with documented setup commands and environment configuration.
- PDF extraction and export must be real implementations, not placeholders or browser print dialogs. Export is a restrained, monochrome, text-first document with predictable page margins, clear headings, and wrapping/pagination.
- Validate request bodies and provider output on the server. Restrict upload size and reject oversized AI contexts rather than silently discarding facts.
- Errors must not expose keys, provider response bodies, file contents, or stack traces. A health endpoint reports AI availability without revealing credentials.
- The provider base URL and model are configurable. Browser requests use same-origin `/api` paths; the development server proxies them to the API server.
- No accounts, database, remote persistence, OCR, job integrations, or authentication are in this delivery. A network-exposed deployment requires a separate security review; the documented default server binds to loopback.

## Acceptance walkthrough for the implementation owner/tester

1. Start without AI credentials; fill both manual tabs, switch tabs, verify independent state, and export each PDF. Include enough records to exceed one page and check the last content is present and selectable.
2. Exercise add/remove controls, multiline bullets, non-ASCII input, empty documents, keyboard navigation, and narrow-screen layout.
3. Upload a text PDF; inspect extracted text, replace/remove it, and try a non-PDF, an oversized file, an image-only PDF, and an invalid/encrypted PDF.
4. With a real provider configured, personalize a resume and organize a CV. Confirm proposals require Apply, retain source data, preserve facts, and never affect the other tab.
5. Chat separately in both tabs; verify contextual critique and explicit application/discarding of a returned proposal. Exercise missing key, provider/network failures, and malformed provider output without losing drafts.
6. Verify opt-in save/reload, source-text privacy notice, removal of stored copies on disable, and confirmed clearing of all drafts.
7. Confirm the Job assistant is visibly deferred and `TODO.txt` describes the requested future behavior.

These are acceptance instructions, not a claim that tests have been executed.
