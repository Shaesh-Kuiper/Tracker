const axios = require('./http-client');
const { USER_AGENT, ScrapeError, createThrottle, requestWithRetry, errorResult } = require('./scrape-utils');
const { parseProfileLink } = require('./profile-links');

// GeeksforGeeks' own APIs (the same ones its profile page uses).
const PROFILE_INFO_URL = 'https://authapi.geeksforgeeks.org/api-get/user-profile-info/';
const SUBMISSIONS_URL = 'https://practiceapi.geeksforgeeks.org/api/v1/user/problems/submissions/';
const CONTEST_RATING_URL = 'https://practiceapi.geeksforgeeks.org/api/v1/rating/';

const GFG_MIN_GAP_MS = parseInt(process.env.SCRAPE_GFG_MIN_GAP_MS || '500', 10);
const waitTurn = createThrottle(GFG_MIN_GAP_MS);

const FIELDS = ['totalProblemsSolved', 'school', 'basic', 'easy', 'medium', 'hard', 'streak', 'codingScore', 'contestRating'];

const requestOptions = {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    timeout: 20000,
    validateStatus: () => true
};

function valueOr(value, fallback) {
    return value === undefined || value === null || value === '' ? fallback : value;
}

class GeeksforGeeksScraper {
    async fetchProfileInfo(username) {
        await waitTurn();
        const response = await requestWithRetry(
            () => axios.get(PROFILE_INFO_URL, { ...requestOptions, params: { handle: username } }),
            `GeeksforGeeks ${username}`
        );
        const body = response.data || {};
        if (response.status === 200 && body.data && typeof body.data === 'object') return body.data;

        if (response.status === 400 || response.status === 404 || /not found/i.test(body.message || '')) {
            throw new ScrapeError('GeeksforGeeks profile not found', 404);
        }
        throw new ScrapeError(`GeeksforGeeks returned HTTP ${response.status}${body.message ? `: ${body.message}` : ''}`, response.status);
    }

    // Returns { school, basic, easy, medium, hard } counts, or null if unavailable.
    async fetchSolvedByDifficulty(username) {
        await waitTurn();
        const response = await requestWithRetry(
            () => axios.post(SUBMISSIONS_URL, { handle: username, requestType: '', year: '', month: '' }, requestOptions),
            `GeeksforGeeks ${username} submissions`
        );
        const solved = response.status === 200 && response.data && response.data.result;
        if (!solved || typeof solved !== 'object') return null;

        const counts = { school: 0, basic: 0, easy: 0, medium: 0, hard: 0 };
        for (const [difficulty, problems] of Object.entries(solved)) {
            const key = difficulty.toLowerCase();
            if (key in counts && problems && typeof problems === 'object') {
                counts[key] = Object.keys(problems).length;
            }
        }
        return counts;
    }

    // Returns the current contest rating, or null if the user has no rating.
    async fetchContestRating(username) {
        await waitTurn();
        const response = await requestWithRetry(
            () => axios.get(`${CONTEST_RATING_URL}${encodeURIComponent(username)}/info/`, requestOptions),
            `GeeksforGeeks ${username} rating`
        );
        const contestData = response.status === 200 && response.data && response.data.user_contest_data;
        return contestData ? valueOr(contestData.current_rating, null) : null;
    }

    async getUserStats(username) {
        try {
            const info = await this.fetchProfileInfo(username);

            const result = {
                username,
                totalProblemsSolved: valueOr(info.total_problems_solved, 0),
                school: '--',
                basic: '--',
                easy: '--',
                medium: '--',
                hard: '--',
                streak: valueOr(info.pod_solved_current_streak, '--'),
                codingScore: valueOr(info.score, '--'),
                contestRating: '--'
            };

            // The difficulty breakdown and contest rating are extras: if they fail,
            // keep the main profile numbers instead of failing the whole profile.
            try {
                const counts = await this.fetchSolvedByDifficulty(username);
                if (counts) Object.assign(result, counts);
            } catch (err) {
                console.warn(`GeeksforGeeks difficulty breakdown failed for ${username}: ${err.message}`);
            }

            try {
                const rating = await this.fetchContestRating(username);
                if (rating !== null) result.contestRating = rating;
            } catch (err) {
                console.warn(`GeeksforGeeks contest rating failed for ${username}: ${err.message}`);
            }

            return result;
        } catch (error) {
            console.error(`Error fetching GeeksforGeeks data for ${username}:`, error.message);
            return errorResult(username, FIELDS, error);
        }
    }

    async scrapeMultipleProfiles(profileLinks) {
        const usernames = profileLinks.map(link => {
            const parsed = parseProfileLink(link, 'geeksforgeeks');
            return parsed.ok ? parsed.username : link;
        });

        console.log('Fetching GeeksforGeeks data for users:', usernames.join(', '));
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
            head: ['Name', 'Total', 'School', 'Basic', 'Easy', 'Medium', 'Hard', 'Streak', 'Score', 'Rating'],
            colWidths: [12, 8, 8, 8, 8, 8, 8, 8, 8, 8]
        });

        results.forEach(result => {
            table.push([
                result.username,
                result.totalProblemsSolved,
                result.school,
                result.basic,
                result.easy,
                result.medium,
                result.hard,
                result.streak,
                result.codingScore,
                result.contestRating
            ]);
        });

        console.log(table.toString());
    }
}

module.exports = GeeksforGeeksScraper;
