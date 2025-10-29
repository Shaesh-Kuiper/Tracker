const axios = require('axios');
const cheerio = require('cheerio');

// Configurable throttling and retry settings via env vars (with sane defaults)
// Default internal delay is 0 so bulk upload pacing fully controls the rate
const CODECHEF_DELAY_MS = parseInt(process.env.SCRAPE_CODECHEF_DELAY_MS || process.env.SCRAPE_DELAY_MS || '0', 10);
const MAX_RETRIES = parseInt(process.env.SCRAPE_MAX_RETRIES || '3', 10);
const BACKOFF_BASE_MS = parseInt(process.env.SCRAPE_BACKOFF_BASE_MS || '4000', 10);
const BACKOFF_FACTOR = parseFloat(process.env.SCRAPE_BACKOFF_FACTOR || '2');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class CodeChefScraper {
  constructor() {
    this.baseUrl = 'https://www.codechef.com/users/';
  }

  async getUserStats(username) {
    try {
      const url = `${this.baseUrl}${username}`;

      // Fetch with retry/backoff on 429, bail fast on 404
      let response;
      let lastStatus = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          response = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36'
            },
            validateStatus: () => true,
            timeout: 15000
          });
          lastStatus = response.status;
          if (response.status === 200) {
            break; // success
          }

          if (response.status === 404) {
            throw new Error('404 Not Found');
          }

          if (response.status === 429) {
            const retryAfter = parseInt(response.headers['retry-after'] || '0', 10);
            const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.round(BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempt));
            console.warn(`CodeChef 429 for ${username}. Backing off ${waitMs} ms (attempt ${attempt + 1}/${MAX_RETRIES + 1}).`);
            if (attempt < MAX_RETRIES) {
              await sleep(waitMs);
              continue;
            }
            throw new Error('429 Too Many Requests');
          }

          // Other 5xx/4xx: small backoff and retry
          if (attempt < MAX_RETRIES) {
            await sleep(Math.round(BACKOFF_BASE_MS * Math.pow(1.5, attempt)));
            continue;
          }
          throw new Error(`HTTP ${response.status}`);
        } catch (netErr) {
          if (attempt >= MAX_RETRIES) throw netErr;
          await sleep(Math.round(BACKOFF_BASE_MS * Math.pow(1.5, attempt)));
        }
      }

      const $ = cheerio.load(response.data);
      const result = {
        username: username,
        division: 'N/A',
        provisionalRating: 'N/A',
        globalRank: 'N/A',
        countryRank: 'N/A',
        totalProblemsSolved: 'N/A',
        contestsParticipated: 'N/A'
      };

      // Extract Division - look for division information in rating section
      const divisionText = $('body').text();
      const divMatch = divisionText.match(/Div\s*(\d+)/i);
      if (divMatch) {
        result.division = `Div ${divMatch[1]}`;
      }

      // Extract Provisional Rating - look for rating information
      const ratingMatch = divisionText.match(/(\d{3,4})\?\s*.*?Provisional Rating/i) ||
                         divisionText.match(/(\d{3,4})\s*Provisional Rating/i) ||
                         divisionText.match(/Rating[:\s]*(\d{3,4})/i);
      if (ratingMatch) {
        result.provisionalRating = ratingMatch[1];
      }

      // Extract Global Rank - prioritize the rating section global rank
      const globalRankMatch = divisionText.match(/(\d+)\s*Global Rank/i) ||
                             divisionText.match(/Global Rank[:\s]*(\d+)/i);
      if (globalRankMatch) {
        result.globalRank = globalRankMatch[1];
      }

      // Extract Country Rank
      const countryRankMatch = divisionText.match(/(\d+)\s*Country Rank/i);
      if (countryRankMatch) {
        result.countryRank = countryRankMatch[1];
      }

      // Extract Total Problems Solved
      const problemsMatch = divisionText.match(/Total Problems Solved[:\s]*(\d+)/i);
      if (problemsMatch) {
        result.totalProblemsSolved = problemsMatch[1];
      }

      // Extract Number of Contests Participated
      const contestsMatch = divisionText.match(/No\.\s*of\s*Contests\s*Participated[:\s]*(\d+)/i) ||
                           divisionText.match(/Contests\s*Participated[:\s]*(\d+)/i) ||
                           divisionText.match(/(\d+)\s*contests?\s*participated/i);
      if (contestsMatch) {
        result.contestsParticipated = contestsMatch[1];
      }

      // Fallback: Try alternative API approach
      if (result.globalRank === 'N/A' || result.countryRank === 'N/A') {
        try {
          const apiResponse = await axios.get('https://api-base-sahil.herokuapp.com/codechef', {
            params: { username: username },
            timeout: 5000
          });

          if (apiResponse.data && typeof apiResponse.data === 'object') {
            const apiData = apiResponse.data;
            if (apiData.global_rank && result.globalRank === 'N/A') {
              result.globalRank = apiData.global_rank;
            }
            if (apiData.country_rank && result.countryRank === 'N/A') {
              result.countryRank = apiData.country_rank;
            }
            if (apiData.rating && result.provisionalRating === 'N/A') {
              result.provisionalRating = apiData.rating;
            }
          }
        } catch (apiError) {
          console.log(`API fallback failed for ${username}, using scraped data only`);
        }
      }

      // Respect inter-request delay to avoid rate limiting
      await sleep(CODECHEF_DELAY_MS);

      return result;
    } catch (error) {
      // Attempt to extract status code from error message
      let errorCode = undefined;
      const m = String(error && error.message || '').match(/(\d{3})/);
      if (m) {
        errorCode = parseInt(m[1], 10);
      }
      console.error(`Error fetching CodeChef data for ${username}:`, error.message);
      return {
        username,
        division: 'Error',
        provisionalRating: 'Error',
        globalRank: 'Error',
        countryRank: 'Error',
        totalProblemsSolved: 'Error',
        contestsParticipated: 'Error',
        error: true,
        errorCode
      };
    }
  }

  async scrapeMultipleProfiles(profileLinks) {
    const usernames = profileLinks.map(link => {
      // Extract username from CodeChef URL
      const match = link.match(/codechef\.com\/users\/([^\/\?]+)/);
      return match ? match[1] : link;
    });

    console.log('Fetching CodeChef data for users:', usernames.join(', '));
    console.log('This may take a moment...\n');

    const results = [];

    // Process usernames sequentially; getUserStats includes delay
    for (const username of usernames) {
      const stats = await this.getUserStats(username);
      results.push(stats);
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

module.exports = CodeChefScraper;
