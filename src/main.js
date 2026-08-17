import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';
import { buildSearchUrls, isChallengePage, filterOutputFields } from './utils.js';
import { parseJobListing, parseJobDetails, parseCompanyDetails } from './parsers.js';
import { LABELS, LINKEDIN_BASE, BLOCKED_STATUS_CODES } from './constants.js';

await Actor.init();

// ─── Input ───────────────────────────────────────────────────────────
const input = await Actor.getInput() ?? {};
const {
    searchQueries = ['Software Engineer'],
    location = 'United States',
    maxItems = 100,
    scrapeJobDetails = false,
    scrapeCompanyDetails = false,
    datePosted = 'any',
    jobType = 'any',
    experienceLevel = 'any',
    remoteFilter = 'any',
    maxConcurrency = 5,
    proxyConfiguration: proxyConfig,
    startUrls = [],

    // ─── New options ───────────────────────────────────────────────
    resumeFromPreviousRun = false,     // Skip jobs/companies already seen in prior runs
    outputFields = [],                 // Restrict pushed records to these fields (+ id fields). Empty = all fields.
    webhookUrl = null,                 // POSTed with run summaries if set
    notifyOnCompletion = false,        // Send a webhook when the run finishes
    errorRateThreshold = 0.3,          // Fraction of blocked/failed requests that triggers concurrency throttling
} = input;

log.info('Starting LinkedIn Jobs Scraper', {
    searchQueries,
    location,
    maxItems,
    scrapeJobDetails,
    scrapeCompanyDetails,
    resumeFromPreviousRun,
});

// ─── Proxy ───────────────────────────────────────────────────────────
const proxyConfiguration = proxyConfig
    ? await Actor.createProxyConfiguration(proxyConfig)
    : undefined;

// ─── Persistence keys (default key-value store) ─────────────────────
const SEEN_JOB_IDS_KEY = 'SEEN_JOB_IDS';
const SEEN_COMPANY_IDS_KEY = 'SEEN_COMPANY_IDS';

// ─── State ───────────────────────────────────────────────────────────
let pushedItems = 0;      // Items actually pushed to dataset (this run)
let queuedItems = 0;      // Items queued (pushed + pending detail pages)
const seenJobIds = new Set();     // Deduplication across search queries (and, optionally, prior runs)
const seenCompanyIds = new Set(); // Deduplication of company page requests

// Rolling counters used to decide when to throttle concurrency / send alert webhooks
const rateLimitState = {
    totalAttempts: 0,
    blockedAttempts: 0,
    alertSent: false,
};

// ─── Resume from a previous run, if requested ────────────────────────
if (resumeFromPreviousRun) {
    const previousJobIds = await Actor.getValue(SEEN_JOB_IDS_KEY);
    if (Array.isArray(previousJobIds)) {
        previousJobIds.forEach((id) => seenJobIds.add(id));
        log.info(`Resumed with ${seenJobIds.size} job ID(s) seen in previous run(s).`);
    }
    const previousCompanyIds = await Actor.getValue(SEEN_COMPANY_IDS_KEY);
    if (Array.isArray(previousCompanyIds)) {
        previousCompanyIds.forEach((id) => seenCompanyIds.add(id));
    }
}

/**
 * Persist the current seen-ID sets to the key-value store so a future run with
 * `resumeFromPreviousRun: true` can skip jobs/companies already scraped.
 */
async function persistSeenIds() {
    await Actor.setValue(SEEN_JOB_IDS_KEY, Array.from(seenJobIds));
    await Actor.setValue(SEEN_COMPANY_IDS_KEY, Array.from(seenCompanyIds));
}

/**
 * POST a JSON event to the configured webhook URL, if any. Failures are logged
 * but never thrown - a broken webhook shouldn't crash the scrape.
 */
async function notifyWebhook(event, payload = {}) {
    if (!webhookUrl) return;
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event,
                timestamp: new Date().toISOString(),
                ...payload,
            }),
        });
    } catch (err) {
        log.warning(`Webhook notification failed: ${err.message}`);
    }
}

/**
 * Push a batch (or single) record to the dataset, applying the user's output-field
 * selection first.
 */
async function pushFiltered(records) {
    const list = Array.isArray(records) ? records : [records];
    const filtered = list.map((record) => filterOutputFields(record, outputFields));
    await Actor.pushData(filtered);
}

/**
 * Queue a company "about" page for scraping, if enabled and not already seen.
 * Company data is pushed to the dataset as its own record (type: 'COMPANY'),
 * keyed by companyId so it can be joined with job records afterward.
 */
async function maybeQueueCompany(companyId, companyUrl) {
    if (!scrapeCompanyDetails || !companyId || !companyUrl) return;
    if (seenCompanyIds.has(companyId)) return;
    seenCompanyIds.add(companyId);

    await crawler.addRequests([{
        url: `${companyUrl.replace(/\/$/, '')}/about`,
        userData: { label: LABELS.COMPANY, companyId, companyUrl },
        uniqueKey: `company-${companyId}`,
    }]);
}

/**
 * Track a request outcome for adaptive-concurrency purposes and, if the rolling
 * error rate crosses `errorRateThreshold`, halve the crawler's concurrency ceiling.
 * This intentionally only ever scales down; a fresh run/redeploy resets it.
 */
function recordAttempt({ blocked }) {
    rateLimitState.totalAttempts++;
    if (blocked) rateLimitState.blockedAttempts++;

    // Only start judging the error rate once we have a reasonable sample size
    if (rateLimitState.totalAttempts < 10) return;

    const errorRate = rateLimitState.blockedAttempts / rateLimitState.totalAttempts;
    if (errorRate <= errorRateThreshold) return;

    if (!rateLimitState.alertSent) {
        rateLimitState.alertSent = true;
        log.warning(`Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(errorRateThreshold * 100).toFixed(1)}%.`);
        notifyWebhook('HIGH_ERROR_RATE', { errorRate, blockedAttempts: rateLimitState.blockedAttempts, totalAttempts: rateLimitState.totalAttempts });
    }

    if (crawler?.autoscaledPool) {
        const current = crawler.autoscaledPool.maxConcurrency;
        const reduced = Math.max(1, Math.floor(current / 2));
        if (reduced < current) {
            crawler.autoscaledPool.maxConcurrency = reduced;
            log.warning(`Reducing concurrency from ${current} to ${reduced} due to high error rate.`);
        }
    }
}

// ─── Build search URLs ──────────────────────────────────────────────
let searchUrls;
if (startUrls && startUrls.length > 0) {
    // Use user-provided URLs directly (Apify requestListSources format)
    searchUrls = startUrls.map(item => typeof item === 'string' ? item : item.url);
    log.info(`Using ${searchUrls.length} user-provided start URL(s)`);
} else {
    searchUrls = buildSearchUrls({
        searchQueries,
        location,
        datePosted,
        jobType,
        experienceLevel,
        remoteFilter,
    });
    log.info(`Generated ${searchUrls.length} search URL(s) from queries`);
}

// ─── Crawler ─────────────────────────────────────────────────────────
// Declared with `let` and assigned below so that callbacks referencing `crawler`
// (e.g. recordAttempt, maybeQueueCompany) resolve it correctly once the run starts.
let crawler;
crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency,
    // A few extra retries than the default, since 429s are common and usually
    // resolve themselves once a fresh session/proxy + backoff is applied.
    maxRequestRetries: 5,
    requestHandlerTimeoutSecs: 60,
    minConcurrency: 1,
    maxRequestsPerMinute: maxConcurrency * 8, // Scale rate limit with concurrency

    // Session pool for anti-blocking. Sessions that receive a blocked status code
    // are retired automatically, so the next attempt gets a new session (and, with
    // a rotating proxy group, a new outbound IP).
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 20,
        blockedStatusCodes: BLOCKED_STATUS_CODES,
        sessionOptions: {
            maxUsageCount: 10,
        },
    },

    // Accept JSON responses from the API endpoint
    additionalMimeTypes: ['application/json'],

    // Browser-like headers to avoid detection, plus a small randomized delay to
    // avoid an obviously-robotic request cadence.
    preNavigationHooks: [
        async (_crawlingContext, gotOptions) => {
            gotOptions.headers = {
                ...gotOptions.headers,
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
            };
            const jitterMs = 150 + Math.floor(Math.random() * 500);
            await new Promise((resolve) => setTimeout(resolve, jitterMs));
        },
    ],

    async requestHandler({ request, $, body, session }) {
        const { label } = request.userData;

        // ── Challenge / login-wall detection ───────────────────────
        // LinkedIn sometimes returns a 200 with a checkpoint or auth-wall page
        // instead of real content, so a status-code check alone isn't enough.
        if (typeof body === 'string' && isChallengePage(body)) {
            session?.retire();
            recordAttempt({ blocked: true });
            throw new Error(`LinkedIn challenge/checkpoint page detected at ${request.url}`);
        }
        recordAttempt({ blocked: false });

        // ── SEARCH results page ──────────────────────────────────
        if (label === LABELS.SEARCH) {
            log.info(`Parsing search results: ${request.url}`);

            const jobCards = $('li');
            const jobsToQueue = [];
            const jobsToPush = [];

            jobCards.each((_index, element) => {
                if (queuedItems >= maxItems) return false;

                const jobData = parseJobListing($, element);
                if (!jobData || !jobData.jobId) return;

                // Deduplicate (also skips jobs already scraped in a previous run
                // when resumeFromPreviousRun is enabled)
                if (seenJobIds.has(jobData.jobId)) return;
                seenJobIds.add(jobData.jobId);

                if (scrapeJobDetails && jobData.jobUrl) {
                    // Use the guest-accessible job detail endpoint
                    const detailUrl = `${LINKEDIN_BASE}/jobs-guest/jobs/api/jobPosting/${jobData.jobId}`;
                    jobsToQueue.push({
                        url: detailUrl,
                        userData: {
                            label: LABELS.DETAIL,
                            jobData,
                        },
                        uniqueKey: `detail-${jobData.jobId}`,
                    });
                    queuedItems++;
                } else {
                    jobsToPush.push(jobData);
                    queuedItems++;
                }
            });

            // Push listing-only results in batch
            if (jobsToPush.length > 0) {
                await pushFiltered(jobsToPush);
                pushedItems += jobsToPush.length;

                if (scrapeCompanyDetails) {
                    for (const job of jobsToPush) {
                        await maybeQueueCompany(job.companyId, job.companyUrl);
                    }
                }
            }

            // Queue detail pages
            if (jobsToQueue.length > 0) {
                await crawler.addRequests(jobsToQueue);
            }

            log.info(`Page parsed: ${jobsToPush.length} pushed, ${jobsToQueue.length} queued for details. Progress: ${queuedItems}/${maxItems}`);

            // Periodically persist dedup state in case the run is stopped early
            if (pushedItems > 0 && pushedItems % 25 === 0) {
                await persistSeenIds();
            }

            // ── Paginate ─────────────────────────────────────────
            if ((jobsToPush.length + jobsToQueue.length) > 0 && queuedItems < maxItems) {
                const currentUrl = new URL(request.url);
                const currentStart = parseInt(currentUrl.searchParams.get('start') || '0', 10);
                const nextStart = currentStart + 25;

                // LinkedIn caps results at ~1000
                if (nextStart < 1000) {
                    currentUrl.searchParams.set('start', String(nextStart));
                    await crawler.addRequests([{
                        url: currentUrl.toString(),
                        userData: { label: LABELS.SEARCH },
                        uniqueKey: currentUrl.toString(),
                    }]);
                }
            }

        // ── DETAIL page ──────────────────────────────────────────
        } else if (label === LABELS.DETAIL) {
            log.debug(`Parsing job details: ${request.url}`);
            const { jobData } = request.userData;
            const detailedData = parseJobDetails($, jobData);

            await pushFiltered(detailedData);
            pushedItems++;

            await maybeQueueCompany(detailedData.companyId, detailedData.companyUrl);

            if (pushedItems % 10 === 0) {
                log.info(`Progress: ${pushedItems}/${maxItems} jobs scraped`);
                await persistSeenIds();
            }

        // ── COMPANY "about" page ─────────────────────────────────
        } else if (label === LABELS.COMPANY) {
            log.debug(`Parsing company details: ${request.url}`);
            const { companyId, companyUrl } = request.userData;
            const companyData = parseCompanyDetails($, companyId, companyUrl);

            await pushFiltered({ type: 'COMPANY', ...companyData });
        }
    },

    // Called on each failed attempt, before Crawlee decides whether to retry.
    // This is where 429-specific exponential backoff + concurrency throttling live.
    async errorHandler({ request, session }, error) {
        const statusCode = error?.response?.statusCode ?? error?.statusCode ?? null;
        const looksRateLimited = BLOCKED_STATUS_CODES.includes(statusCode)
            || /challenge|checkpoint/i.test(error?.message || '');

        if (looksRateLimited) {
            recordAttempt({ blocked: true });
            session?.retire(); // Force a fresh session (and proxy, if rotating) on retry

            const retryCount = request.retryCount ?? 0;
            const backoffMs = Math.min(2 ** retryCount * 2000, 60_000) + Math.floor(Math.random() * 1000);
            log.warning(`Rate-limited (status ${statusCode ?? 'n/a'}) on ${request.url}. Backing off ${backoffMs}ms before retry ${retryCount + 1}.`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
    },

    async failedRequestHandler({ request }, error) {
        log.error(`Request failed: ${request.url}`, { error: error.message });

        // If a detail page fails, push the listing data we already have
        if (request.userData?.label === LABELS.DETAIL && request.userData?.jobData) {
            log.warning(`Pushing partial data for failed detail page: ${request.url}`);
            await pushFiltered({
                ...request.userData.jobData,
                detailScrapeFailed: true,
            });
            pushedItems++;
        }
    },
});

// ─── Run ─────────────────────────────────────────────────────────────
await crawler.run(searchUrls.map((url, index) => ({
    url,
    userData: { label: LABELS.SEARCH },
    uniqueKey: `search-${index}-start-0`,
})));

await persistSeenIds();

const errorRate = rateLimitState.totalAttempts > 0
    ? rateLimitState.blockedAttempts / rateLimitState.totalAttempts
    : 0;

log.info(`✅ Scraping complete. Total jobs scraped: ${pushedItems}`, {
    blockedAttempts: rateLimitState.blockedAttempts,
    totalAttempts: rateLimitState.totalAttempts,
    errorRate: `${(errorRate * 100).toFixed(1)}%`,
});

if (notifyOnCompletion) {
    await notifyWebhook('COMPLETED', { pushedItems, errorRate, totalSeenJobIds: seenJobIds.size });
}

await Actor.exit();
