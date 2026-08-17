/**
 * Request labels to distinguish between search result pages and job detail pages.
 */
export const LABELS = {
    SEARCH: 'SEARCH',
    DETAIL: 'DETAIL',
    COMPANY: 'COMPANY',
};

/**
 * LinkedIn base URLs for guest (no-login) access.
 */
export const LINKEDIN_BASE = 'https://www.linkedin.com';
export const LINKEDIN_JOBS_SEARCH = `${LINKEDIN_BASE}/jobs-guest/jobs/api/seeMoreJobPostings/search`;
export const LINKEDIN_JOB_DETAIL = `${LINKEDIN_BASE}/jobs/view`;

/**
 * Mapping of date posted filter values to LinkedIn's f_TPR parameter.
 */
export const DATE_POSTED_MAP = {
    any: '',
    past24hours: 'r86400',
    pastWeek: 'r604800',
    pastMonth: 'r2592000',
};

/**
 * Mapping of job type filter values to LinkedIn's f_JT parameter.
 */
export const JOB_TYPE_MAP = {
    any: '',
    fullTime: 'F',
    partTime: 'P',
    contract: 'C',
    temporary: 'T',
    internship: 'I',
};

/**
 * Mapping of experience level filter to LinkedIn's f_E parameter.
 */
export const EXPERIENCE_LEVEL_MAP = {
    any: '',
    internship: '1',
    entryLevel: '2',
    associate: '3',
    midSenior: '4',
    director: '5',
    executive: '6',
};

/**
 * Mapping of remote filter values to LinkedIn's f_WT parameter.
 */
export const REMOTE_FILTER_MAP = {
    any: '',
    onSite: '1',
    remote: '2',
    hybrid: '3',
};

/**
 * Keywords/suffixes used to detect a salary's pay period (e.g. "$80/hr", "$150K per year").
 * Keys are matched as "/{key}" or "per {key}" (case-insensitive) against the raw salary text.
 */
export const SALARY_PERIOD_MAP = {
    yr: 'yearly',
    year: 'yearly',
    annum: 'yearly',
    hr: 'hourly',
    hour: 'hourly',
    mo: 'monthly',
    month: 'monthly',
    wk: 'weekly',
    week: 'weekly',
    day: 'daily',
};

/**
 * Currency symbol/prefix to ISO 4217 code mapping, used for structured salary parsing.
 * Longer/more specific prefixes (e.g. "C$") are checked before shorter ones (e.g. "$").
 */
export const CURRENCY_SYMBOL_MAP = {
    'C$': 'CAD',
    'A$': 'AUD',
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '₹': 'INR',
    '¥': 'JPY',
};

/**
 * HTTP status codes that indicate the session/proxy has been rate-limited or blocked
 * by LinkedIn. Used to configure Crawlee's session pool blocking detection and to
 * drive custom retry/backoff and concurrency-throttling logic.
 */
export const BLOCKED_STATUS_CODES = [401, 403, 429, 999];

/**
 * Text fragments that indicate LinkedIn has served a login wall, security checkpoint,
 * or bot-challenge page instead of the expected content. Used to detect blocking that
 * doesn't necessarily come back as a non-2xx HTTP status.
 */
export const CHALLENGE_MARKERS = [
    'checkpoint/challenge',
    'authwall',
    'id="captcha"',
    'class="challenge-dialog"',
    'unusual activity from your account',
];
