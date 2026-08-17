import { cleanText, extractJobId } from './utils.js';
import { LINKEDIN_BASE } from './constants.js';

/**
 * Parse a single job listing card from the search results page.
 * LinkedIn's guest job search returns HTML with job cards in <li> elements.
 *
 * The endpoint /jobs-guest/jobs/api/seeMoreJobPostings/search returns HTML
 * fragments where each job is an <li> containing a div with class
 * "base-card" or "base-search-card".
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
 * @param {import('cheerio').Element} element - The <li> element containing the job card
 * @returns {object|null} Parsed job data or null if not a valid job card
 */
export function parseJobListing($, element) {
    const $el = $(element);

    // The job card contains a base-card or similar structure
    const $card = $el.find('.base-card, .job-search-card, .base-search-card');
    if ($card.length === 0) {
        // Sometimes the <li> itself has the card class
        if (!$el.hasClass('base-card') && !$el.hasClass('job-search-card') && !$el.hasClass('base-search-card')) {
            return null;
        }
    }

    // Use whichever element has the card class
    const $target = $card.length > 0 ? $card : $el;

    // ─── Title ───────────────────────────────────────────────────
    // Prefer the explicit h3 title; fall back to .base-card__full-link only if needed
    const $h3Title = $target.find('h3.base-search-card__title');
    const $fallbackTitle = $target.find('.base-card__full-link .sr-only');
    const title = cleanText($h3Title.length > 0 ? $h3Title.first().text() : $fallbackTitle.first().text());
    if (!title) return null;

    // ─── Job URL ─────────────────────────────────────────────────
    const $link = $target.find('a.base-card__full-link, a[href*="/jobs/view/"]');
    let jobUrl = $link.attr('href') || '';
    if (jobUrl && !jobUrl.startsWith('http')) {
        jobUrl = `${LINKEDIN_BASE}${jobUrl}`;
    }
    // Strip tracking query parameters
    if (jobUrl) {
        try {
            const url = new URL(jobUrl);
            jobUrl = `${url.origin}${url.pathname}`;
        } catch {
            // Keep original URL if parsing fails
        }
    }

    // ─── Job ID ──────────────────────────────────────────────────
    const jobId = extractJobId(jobUrl)
        || $target.attr('data-entity-urn')?.split(':').pop()
        || $target.find('[data-entity-urn]').attr('data-entity-urn')?.split(':').pop()
        || '';

    if (!jobId) return null; // Can't deduplicate without an ID

    // ─── Company ─────────────────────────────────────────────────
    const $company = $target.find(
        '.base-search-card__subtitle, h4.base-search-card__subtitle, ' +
        'a.hidden-nested-link, a[data-tracking-control-name*="company"]'
    );
    const company = cleanText($company.first().text());

    // ─── Location ────────────────────────────────────────────────
    const $location = $target.find(
        '.job-search-card__location, .base-search-card__metadata span:not(time)'
    );
    const location = cleanText($location.first().text());

    // ─── Date Posted ─────────────────────────────────────────────
    const $date = $target.find(
        'time, .job-search-card__listdate, .job-search-card__listdate--new'
    );
    const postedDate = $date.attr('datetime') || cleanText($date.text());

    // ─── Salary ──────────────────────────────────────────────────
    const $salary = $target.find(
        '.job-search-card__salary-info, .base-search-card__metadata .salary-info'
    );
    const salary = cleanText($salary.text());

    return {
        jobId,
        title,
        company,
        location,
        salary: salary || null,
        postedDate: postedDate || null,
        jobUrl: jobUrl || null,
        scrapedAt: new Date().toISOString(),
    };
}

/**
 * Parse the full job detail page for additional information.
 * Uses the guest endpoint /jobs-guest/jobs/api/jobPosting/{jobId}
 * which returns a full HTML page with job details.
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
 * @param {object} jobData - Existing job data from the listing
 * @returns {object} Enriched job data with description and other details
 */
export function parseJobDetails($, jobData) {
    // ─── Job Description ─────────────────────────────────────────
    const $description = $(
        '.show-more-less-html__markup, .description__text .show-more-less-html__markup, ' +
        '.decorated-job-posting__details'
    );
    const descriptionHtml = $description.html();
    const description = cleanText($description.text());

    // ─── Job Criteria (seniority, type, function, industry) ──────
    const criteria = {};
    $('.description__job-criteria-item, .job-criteria__item').each((_, el) => {
        const label = cleanText(
            $(el).find('.description__job-criteria-subheader, h3').text()
        ).toLowerCase();
        const value = cleanText(
            $(el).find('.description__job-criteria-text, span:last-child').text()
        );

        if (label.includes('seniority')) criteria.seniorityLevel = value;
        else if (label.includes('employment')) criteria.employmentType = value;
        else if (label.includes('function')) criteria.jobFunction = value;
        else if (label.includes('industr')) criteria.industries = value;
    });

    // ─── Applicants ──────────────────────────────────────────────
    const $applicants = $(
        '.num-applicants__caption, .applicant-count, ' +
        '.topcard__flavor--metadata, .top-card-layout__bullet'
    );
    const applicantsText = cleanText($applicants.first().text());

    // ─── Company URL ─────────────────────────────────────────────
    const $companyLink = $(
        'a[data-tracking-control-name*="company"], .topcard__org-name-link, ' +
        'a.topcard__org-name-link'
    );
    let companyUrl = $companyLink.attr('href') || null;
    if (companyUrl && !companyUrl.startsWith('http')) {
        companyUrl = `${LINKEDIN_BASE}${companyUrl}`;
    }

    // ─── Title & Company from detail page (fallback) ─────────────
    const detailTitle = cleanText($('.top-card-layout__title, .topcard__title').text());
    const detailCompany = cleanText(
        $('.topcard__org-name-link, .top-card-layout__second-subline a').text()
    );

    return {
        ...jobData,
        // Override with detail-page values if listing values were empty
        title: jobData.title || detailTitle,
        company: jobData.company || detailCompany,
        description: description || null,
        descriptionHtml: descriptionHtml || null,
        seniorityLevel: criteria.seniorityLevel || null,
        employmentType: criteria.employmentType || null,
        jobFunction: criteria.jobFunction || null,
        industries: criteria.industries || null,
        applicants: applicantsText || null,
        companyUrl: companyUrl || null,
    };
}
