import {
    LINKEDIN_JOBS_SEARCH,
    DATE_POSTED_MAP,
    JOB_TYPE_MAP,
    EXPERIENCE_LEVEL_MAP,
    REMOTE_FILTER_MAP,
} from './constants.js';

/**
 * Build LinkedIn search URLs from the input configuration.
 * Each search query generates its own URL with all filters applied.
 *
 * @param {object} config - Search configuration
 * @returns {string[]} Array of search URLs
 */
export function buildSearchUrls({ searchQueries, location, datePosted, jobType, experienceLevel, remoteFilter }) {
    return searchQueries.map(query => {
        const params = new URLSearchParams();
        params.set('keywords', query);
        params.set('location', location);
        params.set('start', '0');

        // Apply filters
        const tpr = DATE_POSTED_MAP[datePosted];
        if (tpr) params.set('f_TPR', tpr);

        const jt = JOB_TYPE_MAP[jobType];
        if (jt) params.set('f_JT', jt);

        const exp = EXPERIENCE_LEVEL_MAP[experienceLevel];
        if (exp) params.set('f_E', exp);

        const wt = REMOTE_FILTER_MAP[remoteFilter];
        if (wt) params.set('f_WT', wt);

        // Sort by most recent
        params.set('sortBy', 'DD');

        return `${LINKEDIN_JOBS_SEARCH}?${params.toString()}`;
    });
}

/**
 * Clean up text by removing extra whitespace and newlines.
 *
 * @param {string} text - Raw text to clean
 * @returns {string} Cleaned text
 */
export function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract LinkedIn job ID from a URL.
 *
 * @param {string} url - LinkedIn job URL
 * @returns {string|null} Job ID or null
 */
export function extractJobId(url) {
    if (!url) return null;
    const match = url.match(/(\d{5,})/); // Job IDs are long numeric strings
    return match ? match[1] : null;
}

/**
 * Parse relative or human-readable dates into ISO format.
 *
 * @param {string} dateText - Date text like "2 days ago", "1 week ago"
 * @returns {string} The original text (kept as-is since LinkedIn uses relative dates)
 */
export function parseDate(dateText) {
    return cleanText(dateText);
}

/**
 * Derive the workplace type (Remote / Hybrid / On-site) from a location string.
 * LinkedIn appends "(Remote)" or "(Hybrid)" to the location text when applicable;
 * anything else is treated as on-site.
 *
 * @param {string} locationText - Raw location text, e.g. "New York, NY (Remote)"
 * @returns {string|null} 'Remote' | 'Hybrid' | 'On-site' | null
 */
export function detectWorkplaceType(locationText) {
    if (!locationText) return null;
    const text = locationText.toLowerCase();
    if (text.includes('remote')) return 'Remote';
    if (text.includes('hybrid')) return 'Hybrid';
    return 'On-site';
}

/**
 * Extract LinkedIn's numeric company ID from a data-entity-urn attribute
 * (e.g. "urn:li:organization:12345") or a company URL (e.g. ".../company/12345").
 *
 * @param {string} value - URN string or company URL
 * @returns {string|null} Numeric company ID or null
 */
export function extractCompanyId(value) {
    if (!value) return null;
    const urnMatch = value.match(/urn:li:(?:organization|company|fsd_company):(\d+)/);
    if (urnMatch) return urnMatch[1];
    const numMatch = value.match(/\/company\/(\d+)/);
    if (numMatch) return numMatch[1];
    return null;
}
