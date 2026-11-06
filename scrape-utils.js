// Shared helpers for the platform scrapers: pacing, retries and error results.

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const MAX_RETRIES = parseInt(process.env.SCRAPE_MAX_RETRIES || '4', 10);
const BACKOFF_BASE_MS = parseInt(process.env.SCRAPE_BACKOFF_BASE_MS || '10000', 10);

// Error with a status-like code: 404 = profile not found, 400 = bad link, 429 = rate limited.
class ScrapeError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Returns a function that, when awaited, guarantees at least `minGapMs` between
// consecutive requests to the same site, even when called from several places.
function createThrottle(minGapMs) {
    let nextAllowed = 0;
    let queue = Promise.resolve();
    return function waitTurn() {
        const turn = queue.then(async () => {
            const wait = nextAllowed - Date.now();
            if (wait > 0) await sleep(wait);
            nextAllowed = Date.now() + minGapMs;
        });
        queue = turn.catch(() => {});
        return turn;
    };
}

// Runs `doRequest` (an axios call using validateStatus: () => true) and retries
// on rate limiting (429), server errors (5xx) and network failures.
async function requestWithRetry(doRequest, label) {
    for (let attempt = 0; ; attempt++) {
        let response;
        let networkError;
        try {
            response = await doRequest();
        } catch (err) {
            networkError = err;
        }

        const status = response ? response.status : null;
        const retryable = networkError || status === 429 || status >= 500;
        if (!retryable) return response;

        if (attempt >= MAX_RETRIES) {
            if (status === 429) throw new ScrapeError('Rate limited by the site, try again later', 429);
            if (networkError) throw new ScrapeError(`Network error: ${networkError.message}`, 0);
            throw new ScrapeError(`Site returned HTTP ${status}`, status);
        }

        const retryAfter = response && parseInt(response.headers['retry-after'] || '0', 10);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : BACKOFF_BASE_MS * (attempt + 1);
        const why = networkError ? networkError.code || networkError.message : `HTTP ${status}`;
        console.warn(`${label}: ${why}, retrying in ${Math.round(waitMs / 1000)}s (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(waitMs);
    }
}

// Builds the result object stored for a profile that could not be fetched.
// Every data field is set to 'Error' so tables and exports keep working.
function errorResult(username, fields, error) {
    const result = { username };
    for (const field of fields) result[field] = 'Error';
    result.error = true;
    result.errorCode = error && typeof error.code === 'number' ? error.code : undefined;
    result.errorMessage = (error && error.message) || 'Unknown error';
    return result;
}

module.exports = {
    USER_AGENT,
    ScrapeError,
    sleep,
    createThrottle,
    requestWithRetry,
    errorResult
};
