import { randomUUID } from 'node:crypto';
import { decodeHTML } from 'entities';
import { z } from 'zod';
import type { CriterionCheck, JobAssistantRequest, JobCriteria, JobListing, JobSearchRequest, JobSearchResponse } from '../shared/jobs.js';
import { HttpError } from './errors.js';

export interface JobsConfiguration {
  appId: string;
  appKey: string;
  fetch?: typeof fetch;
  now?: () => number;
}
const domains = ['adzuna.co.uk', 'adzuna.com', 'adzuna.at', 'adzuna.com.au', 'adzuna.be', 'adzuna.com.br', 'adzuna.ca', 'adzuna.ch', 'adzuna.de', 'adzuna.es', 'adzuna.fr', 'adzuna.in', 'adzuna.co.in', 'adzuna.it', 'adzuna.com.mx', 'adzuna.nl', 'adzuna.co.nz', 'adzuna.pl', 'adzuna.sg', 'adzuna.co.za'];
const providerSchema = z.object({ results: z.array(z.unknown()).max(20), count: z.unknown().optional() });
const rowSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().min(1).max(2000),
  description: z.string().max(20_000), redirect_url: z.string().max(4000),
  created: z.string().max(100).optional(),
  company: z.object({ display_name: z.string().max(2000).optional() }).optional(),
  location: z.object({ display_name: z.string().max(2000).optional() }).optional(),
  salary_min: z.unknown().optional(), salary_max: z.unknown().optional(), salary_is_predicted: z.unknown().optional(),
});

function plainText(value: string): string {
  // Decode and remove markup as data; no embedded resources are ever fetched.
  return decodeHTML(value).replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>|<![^>]*>/gi, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/gu, ' ').trim();
}
function sourceUrl(value: string): URL | null {
  try {
    if (/[\u0000-\u0020\\]/u.test(value)) return null;
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !domains.includes(host) || !url.pathname.startsWith('/jobs/')) return null;
    return url;
  } catch { return null; }
}
function canonical(url: URL): string {
  // Adzuna land/ad IDs identify adverts independently of tracking/affiliate parameters.
  // Unknown URL shapes retain query data, since it might distinguish vacancies.
  const ad = /^\/jobs\/land\/ad\/([^/]+)\/?$/.exec(url.pathname);
  if (ad) return `${url.hostname.replace(/^www\./, '')}/jobs/land/ad/${ad[1]}`;
  const clean = new URL(url);
  clean.hash = '';
  for (const key of [...clean.searchParams.keys()]) {
    if (/^utm_/i.test(key)) clean.searchParams.delete(key);
  }
  clean.searchParams.sort();
  return `${clean.hostname.replace(/^www\./, '')}${clean.pathname}${clean.search}`;
}
const check = (requested: boolean, reason: string): CriterionCheck => ({ status: requested ? 'unverified' : 'not_requested', reason });
function checks(criteria: JobCriteria): JobListing['checks'] {
  return {
    role: check(Boolean(criteria.keywords), 'Provider keyword retrieval is relevance, not a verified role match.'),
    location: check(Boolean(criteria.location), 'Provider location search is geographic relevance, not eligibility evidence.'),
    salary: check(criteria.salary.minimum !== null || criteria.salary.maximum !== null, 'Pay period is not documented; unknown or predicted pay cannot verify salary compatibility.'),
    modality: check(criteria.modality !== 'any', 'Adzuna does not document structured remote, hybrid, or on-site modality; employment type is not modality.'),
    remoteEligibility: check(criteria.remoteEligibility !== 'unspecified', 'Provider location and remote wording do not establish worldwide or restricted work eligibility.'),
    skills: check(Boolean(criteria.skills.length), 'Skills are search keywords only; the excerpt may omit requirements and does not evidence applicant skills.'),
  };
}
const amount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
interface Snapshot { expiresAt: number; response: JobSearchResponse }

export function createJobsService(configuration: JobsConfiguration) {
  const snapshots = new Map<string, Snapshot>();
  const now = configuration.now ?? Date.now;
  const providerFetch = configuration.fetch ?? fetch;
  function prune() {
    const time = now();
    for (const [id, snapshot] of snapshots) if (snapshot.expiresAt <= time) snapshots.delete(id);
  }
  async function search(request: JobSearchRequest): Promise<JobSearchResponse> {
    if (!configuration.appId.trim() || !configuration.appKey.trim()) {
      throw new HttpError(503, 'JOBS_NOT_CONFIGURED', 'Job search is not configured. Set ADZUNA_APP_ID and ADZUNA_APP_KEY on the server and restart. Manual document tools remain available.');
    }
    const appliedQuery: Record<string, string> = { results_per_page: '20' };
    const what = [request.criteria.keywords, ...request.criteria.skills].map(value => value.trim()).filter(Boolean).join(' ');
    if (what) appliedQuery.what = what;
    if (request.criteria.location.trim()) appliedQuery.where = request.criteria.location.trim();
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${request.criteria.country}/search/${request.page}`);
    for (const [key, value] of Object.entries(appliedQuery)) url.searchParams.set(key, value);
    url.searchParams.set('app_id', configuration.appId.trim());
    url.searchParams.set('app_key', configuration.appKey.trim());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let body: z.infer<typeof providerSchema>;
    try {
      const response = await providerFetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new HttpError(429, 'JOBS_RATE_LIMITED', 'Adzuna rate or account quota limit reached. Wait before searching again and check your provider account allowance.');
        // Search 410 is documented as authorization failure, not an expired advert.
        throw new HttpError(502, 'JOBS_PROVIDER_ERROR', 'Adzuna rejected the search. Check server credentials and authorised account access.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Oversized body'); }
        chunks.push(part.value);
      }
      body = providerSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (error) {
      if (controller.signal.aborted) throw new HttpError(504, 'JOBS_TIMEOUT', 'Adzuna took longer than 20 seconds. Please try another search later.');
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'JOBS_PROVIDER_ERROR', 'Adzuna could not be reached or returned invalid data. Try later or check your account configuration.');
    } finally { clearTimeout(timeout); }
    const retrievedAt = new Date(now()).toISOString();
    const listings: JobListing[] = [];
    const ids = new Set<string>();
    const urls = new Set<string>();
    let omitted = 0;
    for (const input of body.results) {
      const parsed = rowSchema.safeParse(input);
      if (!parsed.success) { omitted++; continue; }
      const row = parsed.data;
      const safeUrl = sourceUrl(row.redirect_url);
      if (!safeUrl) { omitted++; continue; }
      const key = canonical(safeUrl);
      if (ids.has(row.id) || urls.has(key)) continue;
      const title = plainText(row.title);
      if (!title) { omitted++; continue; }
      ids.add(row.id); urls.add(key);
      let minimum = amount(row.salary_min);
      let maximum = amount(row.salary_max);
      if (minimum !== null && maximum !== null && minimum > maximum) { minimum = null; maximum = null; }
      const flag = row.salary_is_predicted;
      const provenance = minimum === null && maximum === null ? 'unknown' : flag === 1 || flag === '1' ? 'predicted' : flag === 0 || flag === '0' ? 'published' : 'unknown';
      listings.push({
        id: row.id, title, employer: plainText(row.company?.display_name ?? ''), location: plainText(row.location?.display_name ?? ''),
        modality: 'unknown', remoteRestrictions: null,
        salary: { minimum, maximum, currency: null, period: null, provenance },
        source: 'Adzuna', sourceUrl: row.redirect_url,
        postedAt: row.created && Number.isFinite(Date.parse(row.created)) ? new Date(row.created).toISOString() : null,
        retrievedAt, descriptionExcerpt: plainText(row.description), checks: checks(request.criteria),
      });
    }
    const limitations = [
      'Candidates are keyword/geographic search results, not verified matches. Skills are included as keywords only.',
      'Salary filters are not sent: Adzuna does not document a compatible pay period. Currency and pay period remain unknown; predictions are not employer-published pay.',
      'Modality and remote eligibility filters are unsupported and cannot be verified from employment type or location.',
      'Descriptions are provider excerpts, not complete employer requirements. Posting dates do not establish current availability.',
      'Pagination is not exhaustive. The provider total is not a deduplicated or verified-match count.',
    ];
    if (omitted) limitations.push(`${omitted} provider result(s) omitted because required fields or authorised source links were invalid.`);
    const total = typeof body.count === 'number' && Number.isSafeInteger(body.count) && body.count >= 0 ? body.count : null;
    if (body.count !== undefined && total === null) limitations.push('The provider total was invalid and is unavailable; returned candidates are still usable.');
    const response: JobSearchResponse = { searchId: randomUUID(), criteria: request.criteria, appliedQuery, limitations, listings, page: request.page, total, retrievedAt };
    prune();
    while (snapshots.size >= 20) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(response.searchId, { expiresAt: now() + 10 * 60_000, response });
    return response;
  }
  function resolve(request: JobAssistantRequest): JobListing[] {
    if (!request.searchId) return [];
    prune();
    const snapshot = snapshots.get(request.searchId);
    if (!snapshot) throw new HttpError(410, 'JOB_CONTEXT_EXPIRED', 'This search expired or was evicted. Search again before discussing or analysing these listings.');
    if (JSON.stringify(request.criteria) !== JSON.stringify(snapshot.response.criteria)) throw new HttpError(400, 'INVALID_REQUEST', 'Criteria changed since this search. Search again before using its listings.');
    const listings = request.listingIds.map(id => snapshot.response.listings.find(listing => listing.id === id));
    if (listings.some(listing => !listing)) throw new HttpError(400, 'INVALID_REQUEST', 'Selected listing IDs must belong to this server search snapshot.');
    return listings as JobListing[];
  }
  return { search, resolve };
}
