import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';
import { buildSearchUrls } from './utils.js';
import { parseJobListing, parseJobDetails } from './parsers.js';
import { LABELS, LINKEDIN_BASE } from './constants.js';

await Actor.init();

// ─── Input ───────────────────────────────────────────────────────────
const input = await Actor.getInput() ?? {};
const {
    searchQueries = ['Software Engineer'],
    location = 'United States',
    maxItems = 100,
    scrapeJobDetails = false,
    datePosted = 'any',
    jobType = 'any',
    experienceLevel = 'any',
    remoteFilter = 'any',
    maxConcurrency = 5,
    proxyConfiguration: proxyConfig,
    startUrls = [],
} = input;

log.info('Starting LinkedIn Jobs Scraper', {
    searchQueries,
    location,
    maxItems,
    scrapeJobDetails,
});

// ─── Proxy ───────────────────────────────────────────────────────────
const proxyConfiguration = proxyConfig
    ? await Actor.createProxyConfiguration(proxyConfig)
    : undefined;

// ─── State ───────────────────────────────────────────────────────────
let pushedItems = 0;      // Items actually pushed to dataset
let queuedItems = 0;      // Items queued (pushed + pending detail pages)
const seenJobIds = new Set(); // Deduplication across search queries

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
const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    minConcurrency: 1,
    maxRequestsPerMinute: maxConcurrency * 8, // Scale rate limit with concurrency

    // Session pool for anti-blocking
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 20,
        sessionOptions: {
            maxUsageCount: 10,
        },
    },

    // Accept JSON responses from the API endpoint
    additionalMimeTypes: ['application/json'],

    // Browser-like headers to avoid detection
    preNavigationHooks: [
        (_crawlingContext, gotOptions) => {
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
        },
    ],

    async requestHandler({ request, $ }) {
        const { label } = request.userData;

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

                // Deduplicate
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
                await Actor.pushData(jobsToPush);
                pushedItems += jobsToPush.length;
            }

            // Queue detail pages
            if (jobsToQueue.length > 0) {
                await crawler.addRequests(jobsToQueue);
            }

            log.info(`Page parsed: ${jobsToPush.length} pushed, ${jobsToQueue.length} queued for details. Progress: ${queuedItems}/${maxItems}`);

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

            await Actor.pushData(detailedData);
            pushedItems++;

            if (pushedItems % 10 === 0) {
                log.info(`Progress: ${pushedItems}/${maxItems} jobs scraped`);
            }
        }
    },

    async failedRequestHandler({ request }, error) {
        log.error(`Request failed: ${request.url}`, { error: error.message });

        // If a detail page fails, push the listing data we already have
        if (request.userData?.label === LABELS.DETAIL && request.userData?.jobData) {
            log.warning(`Pushing partial data for failed detail page: ${request.url}`);
            await Actor.pushData({
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

log.info(`✅ Scraping complete. Total jobs scraped: ${pushedItems}`);

await Actor.exit();
