/**
 * Request labels to distinguish between search result pages and job detail pages.
 */
export const LABELS = {
    SEARCH: 'SEARCH',
    DETAIL: 'DETAIL',
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
