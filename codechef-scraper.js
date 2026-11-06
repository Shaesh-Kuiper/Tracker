const axios = require('./http-client');
const cheerio = require('cheerio');
const { USER_AGENT, ScrapeError, createThrottle, requestWithRetry, errorResult } = require('./scrape-utils');
const { parseProfileLink } = require('./profile-links');

// CodeChef starts answering 429 at roughly one request every 4s, so keep a safe gap.
const CODECHEF_MIN_GAP_MS = parseInt(process.env.SCRAPE_CODECHEF_MIN_GAP_MS || '5000', 10);
const waitTurn = createThrottle(CODECHEF_MIN_GAP_MS);

// "Recent activity" columns cover this many days
const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const FIELDS = [
    'division', 'provisionalRating', 'globalRank', 'countryRank', 'totalProblemsSolved', 'contestsParticipated',
    'highestRating', 'lastContest', 'lastContestRank', 'recentContests', 'recentRatingChange', 'penalties'
];

function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

function numberOrNA(s) {
    const m = cleanText(s).replace(/,/g, '').match(/\d+/);
    return m ? Number(m[0]) : 'N/A';
}

function toInt(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

function signed(n) {
    return n > 0 ? `+${n}` : String(n);
}

// The profile page embeds its data as `jQuery.extend(Drupal.settings, {...});`
function readPageSettings(html) {
    const m = String(html).match(/jQuery\.extend\(Drupal\.settings,\s*(\{.*\})\);/);
    if (!m) return {};
    try {
        return JSON.parse(m[1]);
    } catch (_) {
        return {};
    }
}

// Contest-by-contest history, oldest first.
function parseContestHistory(settings) {
    const series = settings.date_versus_rating && settings.date_versus_rating.all;
    if (!Array.isArray(series)) return [];

    const initialRating = settings.user_initial_ratings && toInt(settings.user_initial_ratings.all);
    // Users from before CodeChef's Dec 2022 rating reset have an older series;
    // for them the first contest's change can't be worked out from the start rating.
    const hasOldSeries = Array.isArray(settings.date_versus_rating.all_old) && settings.date_versus_rating.all_old.length > 0;

    const contests = series
        .filter(c => c && c.code)
        .map(c => ({
            code: c.code,
            name: c.name || c.code,
            date: String(c.end_date || '').slice(0, 10),
            // CodeChef times are IST
            time: Date.parse(String(c.end_date || '').replace(' ', 'T') + '+05:30') || 0,
            rank: toInt(c.rank),
            rating: toInt(c.rating),
            penalised: Boolean(c.reason || (Array.isArray(c.penalised_in) && c.penalised_in.length))
        }))
        .sort((a, b) => a.time - b.time);

    let previous = hasOldSeries ? null : initialRating;
    for (const c of contests) {
        c.change = previous !== null && c.rating !== null ? c.rating - previous : null;
        previous = c.rating;
    }
    return contests;
}

// Summary columns built from the contest history.
function summariseContests(contests, now = Date.now()) {
    const summary = {
        lastContest: '--',
        lastContestDate: '',
        lastContestTs: 0,
        lastContestRank: '--',
        recentContests: 0,
        recentRatingChange: 0,
        penalties: contests.filter(c => c.penalised).length
    };
    if (!contests.length) return summary;

    const last = contests[contests.length - 1];
    summary.lastContest = last.name;
    summary.lastContestDate = last.date;
    summary.lastContestTs = last.time;
    summary.lastContestRank = last.rank !== null ? last.rank : '--';

    const recent = contests.filter(c => c.time >= now - RECENT_DAYS * DAY_MS);
    summary.recentContests = recent.length;
    if (recent.length) {
        const changes = recent.map(c => c.change);
        summary.recentRatingChange = changes.every(ch => ch !== null)
            ? signed(changes.reduce((sum, ch) => sum + ch, 0))
            : '--';
    }
    return summary;
}

// Reads the stats out of a CodeChef profile page.
function parseProfilePage(html, username) {
    const $ = cheerio.load(html);

    if (!$('.user-details-container').length && !$('.rating-header').length) {
        throw new ScrapeError('CodeChef page did not look like a profile (layout may have changed)', 500);
    }

    const result = {
        username,
        division: 'N/A',
        provisionalRating: 'N/A',
        globalRank: 'N/A',
        countryRank: 'N/A',
        totalProblemsSolved: 'N/A',
        contestsParticipated: 'N/A',
        highestRating: 'N/A'
    };

    // The sidebar has a "CodeChef Rating" block (#rating-block-all) and a separate
    // "DSA Rating" block. We want the main contest rating.
    let block = $('#rating-block-all');
    if (!block.length) block = $('.widget-rating').first();
    if (!block.length) block = $('body');

    const header = block.find('.rating-header').first();
    result.provisionalRating = numberOrNA(header.find('.rating-number').first().text());

    const divMatch = cleanText(header.text()).match(/\bDiv(?:ision)?\s*(\d)\b/i);
    if (divMatch) result.division = `Div ${divMatch[1]}`;

    const highestMatch = cleanText(header.text()).match(/Highest Rating\s*(\d+)/i);
    if (highestMatch) result.highestRating = Number(highestMatch[1]);

    block.find('.rating-ranks li').each((_, li) => {
        const text = cleanText($(li).text());
        const value = numberOrNA($(li).find('strong').first().text());
        if (/Global Rank/i.test(text)) result.globalRank = value;
        else if (/Country Rank/i.test(text)) result.countryRank = value;
    });

    const pageText = cleanText($('body').text());

    const contests = cleanText($('.contest-participated-count').first().text()).match(/No\.?\s*of\s*Contests\s*Participated:?\s*(\d+)/i)
        || pageText.match(/No\.?\s*of\s*Contests\s*Participated:?\s*(\d+)/i);
    if (contests) result.contestsParticipated = Number(contests[1]);

    const solvedHeading = $('h3').filter((_, el) => /Total Problems Solved/i.test($(el).text())).first().text();
    const solved = cleanText(solvedHeading).match(/Total Problems Solved:?\s*(\d+)/i)
        || pageText.match(/Total Problems Solved:?\s*(\d+)/i);
    if (solved) result.totalProblemsSolved = Number(solved[1]);

    // Contest history (same page, no extra request)
    const history = parseContestHistory(readPageSettings(html));
    Object.assign(result, summariseContests(history));
    if (result.highestRating === 'N/A' && history.length) {
        const best = Math.max(...history.map(c => c.rating).filter(r => r !== null));
        if (Number.isFinite(best)) result.highestRating = best;
    }
    if (result.contestsParticipated === 'N/A') result.contestsParticipated = history.length;
    result.contestHistory = history.map(({ time, ...c }) => c);

    return result;
}

class CodeChefScraper {
    constructor() {
        this.baseUrl = 'https://www.codechef.com/users/';
    }

    async fetchProfilePage(username) {
        let url = `${this.baseUrl}${encodeURIComponent(username)}`;

        for (let hop = 0; hop < 3; hop++) {
            await waitTurn();
            const response = await requestWithRetry(() => axios.get(url, {
                headers: { 'User-Agent': USER_AGENT },
                timeout: 20000,
                maxRedirects: 0,
                validateStatus: () => true
            }), `CodeChef ${username}`);

            if (response.status === 200) return response.data;
            if (response.status === 404) throw new ScrapeError('CodeChef profile not found', 404);

            if (response.status >= 300 && response.status < 400) {
                // CodeChef redirects unknown or deactivated users to the home page.
                // A redirect to another /users/ page (e.g. different letter case) is fine to follow.
                const location = new URL(response.headers.location || '/', url);
                if (!/^\/users\/[^/]+\/?$/.test(location.pathname)) {
                    throw new ScrapeError('CodeChef profile not found (account missing or deactivated)', 404);
                }
                url = location.href;
                continue;
            }

            throw new ScrapeError(`CodeChef returned HTTP ${response.status}`, response.status);
        }
        throw new ScrapeError('CodeChef redirected too many times', 500);
    }

    async getUserStats(username) {
        try {
            const html = await this.fetchProfilePage(username);
            return parseProfilePage(html, username);
        } catch (error) {
            console.error(`Error fetching CodeChef data for ${username}:`, error.message);
            return errorResult(username, FIELDS, error);
        }
    }

    async scrapeMultipleProfiles(profileLinks) {
        const usernames = profileLinks.map(link => {
            const parsed = parseProfileLink(link, 'codechef');
            return parsed.ok ? parsed.username : link;
        });

        console.log('Fetching CodeChef data for users:', usernames.join(', '));
        console.log('This may take a moment...\n');

        const results = [];
        // Requests are paced by the shared throttle
        for (const username of usernames) {
            results.push(await this.getUserStats(username));
        }
        return results;
    }

    displayResults(results) {
        const Table = require('cli-table3');
        const table = new Table({
            head: ['Name', 'Division', 'Rating', 'Global Rank', 'Country Rank', 'Problems', 'Contests'],
            colWidths: [15, 8, 8, 12, 13, 10, 10]
        });

        results.forEach(result => {
            table.push([
                result.username,
                result.division,
                result.provisionalRating,
                result.globalRank,
                result.countryRank,
                result.totalProblemsSolved,
                result.contestsParticipated
            ]);
        });

        console.log(table.toString());
    }
}

CodeChefScraper.parseProfilePage = parseProfilePage;

module.exports = CodeChefScraper;
