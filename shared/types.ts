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
  jobsConfigured: boolean;
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
  | 'JOBS_NOT_CONFIGURED'
  | 'JOBS_RATE_LIMITED'
  | 'JOBS_PROVIDER_ERROR'
  | 'JOBS_TIMEOUT'
  | 'JOB_CONTEXT_EXPIRED'
  | 'INTERNAL_ERROR';
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
