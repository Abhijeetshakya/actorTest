/**
 * Test suite for the LinkedIn Jobs Scraper.
 * Tests parser functions against sample HTML that matches LinkedIn's
 * guest job search endpoint response format.
 */
import { load } from 'cheerio';
import { parseJobListing, parseJobDetails } from './parsers.js';
import { buildSearchUrls, cleanText, extractJobId } from './utils.js';

// ─── Sample HTML ─────────────────────────────────────────────────────
const SAMPLE_SEARCH_HTML = `
<ul>
  <li>
    <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:3912345678">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/3912345678?trk=test&position=1">
        <span class="sr-only">Senior Software Engineer</span>
      </a>
      <div class="base-search-card__info">
        <h3 class="base-search-card__title">Senior Software Engineer</h3>
        <h4 class="base-search-card__subtitle">
          <a class="hidden-nested-link" href="https://www.linkedin.com/company/acme-corp">Acme Corp</a>
        </h4>
        <div class="base-search-card__metadata">
          <span class="job-search-card__location">San Francisco, CA</span>
          <time class="job-search-card__listdate" datetime="2024-01-15">2 days ago</time>
          <span class="job-search-card__salary-info">$150,000 - $200,000</span>
        </div>
      </div>
    </div>
  </li>
  <li>
    <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:3912345679">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/3912345679">
        <span class="sr-only">Data Scientist</span>
      </a>
      <div class="base-search-card__info">
        <h3 class="base-search-card__title">Data Scientist</h3>
        <h4 class="base-search-card__subtitle">
          <a class="hidden-nested-link">TechCo Inc</a>
        </h4>
        <div class="base-search-card__metadata">
          <span class="job-search-card__location">New York, NY (Remote)</span>
          <time class="job-search-card__listdate" datetime="2024-01-14">3 days ago</time>
        </div>
      </div>
    </div>
  </li>
  <li>
    <!-- Empty/invalid list item without card class -->
    <div class="some-other-div">Not a job card</div>
  </li>
</ul>
`;

const SAMPLE_DETAIL_HTML = `
<div class="decorated-job-posting__details">
  <div class="top-card-layout__entity-info">
    <h1 class="top-card-layout__title">Senior Software Engineer</h1>
    <a class="topcard__org-name-link" href="https://www.linkedin.com/company/acme-corp">Acme Corp</a>
    <span class="topcard__flavor topcard__flavor--metadata">Over 200 applicants</span>
  </div>
  <div class="description__text">
    <div class="show-more-less-html__markup">
      We are looking for a Senior Software Engineer to join our team.
      You will work on cutting-edge projects using React, Node.js, and Python.
      Requirements:
      - 5+ years of experience
      - Strong problem solving skills
    </div>
  </div>
  <ul class="description__job-criteria-list">
    <li class="description__job-criteria-item">
      <h3 class="description__job-criteria-subheader">Seniority level</h3>
      <span class="description__job-criteria-text">Mid-Senior level</span>
    </li>
    <li class="description__job-criteria-item">
      <h3 class="description__job-criteria-subheader">Employment type</h3>
      <span class="description__job-criteria-text">Full-time</span>
    </li>
    <li class="description__job-criteria-item">
      <h3 class="description__job-criteria-subheader">Job function</h3>
      <span class="description__job-criteria-text">Engineering and Information Technology</span>
    </li>
    <li class="description__job-criteria-item">
      <h3 class="description__job-criteria-subheader">Industries</h3>
      <span class="description__job-criteria-text">Technology, Information and Internet</span>
    </li>
  </ul>
</div>
`;

// ─── Test Runner ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.error(`  ❌ ${testName}`);
        failed++;
    }
}

function assertEqual(actual, expected, testName) {
    if (actual === expected) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.error(`  ❌ ${testName}: expected "${expected}", got "${actual}"`);
        failed++;
    }
}

// ─── Test: cleanText ─────────────────────────────────────────────────
console.log('\n🧪 Testing cleanText()');
assertEqual(cleanText('  hello   world  '), 'hello world', 'removes extra whitespace');
assertEqual(cleanText(''), '', 'handles empty string');
assertEqual(cleanText(null), '', 'handles null');
assertEqual(cleanText(undefined), '', 'handles undefined');
assertEqual(cleanText('no changes'), 'no changes', 'preserves clean text');
assertEqual(cleanText('\n\t  multi\n  line\t'), 'multi line', 'handles newlines and tabs');

// ─── Test: extractJobId ──────────────────────────────────────────────
console.log('\n🧪 Testing extractJobId()');
assertEqual(extractJobId('https://www.linkedin.com/jobs/view/3912345678'), '3912345678', 'extracts job ID from URL');
assertEqual(extractJobId('https://www.linkedin.com/jobs/view/3912345678?trk=test'), '3912345678', 'extracts job ID with query params');
assertEqual(extractJobId(null), null, 'handles null');
assertEqual(extractJobId(''), null, 'handles empty string');
assertEqual(extractJobId('https://www.linkedin.com/feed'), null, 'returns null for non-job URL');

// ─── Test: buildSearchUrls ───────────────────────────────────────────
console.log('\n🧪 Testing buildSearchUrls()');
const urls = buildSearchUrls({
    searchQueries: ['Software Engineer', 'Data Scientist'],
    location: 'San Francisco',
    datePosted: 'pastWeek',
    jobType: 'fullTime',
    experienceLevel: 'midSenior',
    remoteFilter: 'remote',
});
assertEqual(urls.length, 2, 'generates one URL per query');
assert(urls[0].includes('keywords=Software+Engineer'), 'includes keywords');
assert(urls[0].includes('location=San+Francisco'), 'includes location');
assert(urls[0].includes('f_TPR=r604800'), 'includes date filter');
assert(urls[0].includes('f_JT=F'), 'includes job type filter');
assert(urls[0].includes('f_E=4'), 'includes experience filter');
assert(urls[0].includes('f_WT=2'), 'includes remote filter');
assert(urls[0].includes('sortBy=DD'), 'sorts by date');
assert(urls[0].includes('start=0'), 'starts at 0');
assert(urls[1].includes('keywords=Data+Scientist'), 'second URL has correct keywords');

const minimalUrls = buildSearchUrls({
    searchQueries: ['Test'],
    location: 'US',
    datePosted: 'any',
    jobType: 'any',
    experienceLevel: 'any',
    remoteFilter: 'any',
});
assert(!minimalUrls[0].includes('f_TPR'), 'omits empty date filter');
assert(!minimalUrls[0].includes('f_JT'), 'omits empty job type filter');

// ─── Test: parseJobListing ───────────────────────────────────────────
console.log('\n🧪 Testing parseJobListing()');
const $search = load(SAMPLE_SEARCH_HTML);
const listItems = $search('li');

const job1 = parseJobListing($search, listItems[0]);
assert(job1 !== null, 'parses first job card');
assertEqual(job1.title, 'Senior Software Engineer', 'extracts title');
assertEqual(job1.company, 'Acme Corp', 'extracts company');
assertEqual(job1.location, 'San Francisco, CA', 'extracts location');
assertEqual(job1.salary, '$150,000 - $200,000', 'extracts salary');
assertEqual(job1.postedDate, '2024-01-15', 'extracts datetime attribute');
assertEqual(job1.jobId, '3912345678', 'extracts job ID from URL');
assert(job1.jobUrl.includes('/jobs/view/3912345678'), 'has clean job URL');
assert(!job1.jobUrl.includes('trk='), 'strips tracking params');
assert(job1.scrapedAt, 'includes scrapedAt timestamp');

const job2 = parseJobListing($search, listItems[1]);
assert(job2 !== null, 'parses second job card');
assertEqual(job2.title, 'Data Scientist', 'second job title');
assertEqual(job2.company, 'TechCo Inc', 'second job company');
assertEqual(job2.location, 'New York, NY (Remote)', 'second job location');
assertEqual(job2.salary, null, 'null salary when not present');
assertEqual(job2.jobId, '3912345679', 'second job ID');

const job3 = parseJobListing($search, listItems[2]);
assert(job3 === null, 'returns null for non-job list items');

// ─── Test: parseJobDetails ───────────────────────────────────────────
console.log('\n🧪 Testing parseJobDetails()');
const $detail = load(SAMPLE_DETAIL_HTML);
const baseJobData = {
    jobId: '3912345678',
    title: 'Senior Software Engineer',
    company: 'Acme Corp',
    location: 'San Francisco, CA',
    jobUrl: 'https://www.linkedin.com/jobs/view/3912345678',
};

const detailedJob = parseJobDetails($detail, baseJobData);
assertEqual(detailedJob.jobId, '3912345678', 'preserves jobId');
assertEqual(detailedJob.title, 'Senior Software Engineer', 'preserves title');
assert(detailedJob.description.includes('Senior Software Engineer'), 'extracts description');
assert(detailedJob.description.includes('5+ years'), 'description includes requirements');
assertEqual(detailedJob.seniorityLevel, 'Mid-Senior level', 'extracts seniority level');
assertEqual(detailedJob.employmentType, 'Full-time', 'extracts employment type');
assertEqual(detailedJob.jobFunction, 'Engineering and Information Technology', 'extracts job function');
assertEqual(detailedJob.industries, 'Technology, Information and Internet', 'extracts industries');
assert(detailedJob.applicants.includes('200'), 'extracts applicant count');
assertEqual(detailedJob.companyUrl, 'https://www.linkedin.com/company/acme-corp', 'extracts company URL');
assert(detailedJob.descriptionHtml !== null, 'includes HTML description');

// Fallback test - empty base data
const emptyBase = { jobId: '123', title: '', company: '' };
const fallbackJob = parseJobDetails($detail, emptyBase);
assertEqual(fallbackJob.title, 'Senior Software Engineer', 'falls back to detail page title');
assertEqual(fallbackJob.company, 'Acme Corp', 'falls back to detail page company');

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    console.error('\n💥 Some tests FAILED!');
    process.exit(1);
} else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
}
