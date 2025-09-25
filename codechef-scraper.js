const axios = require('axios');
const cheerio = require('cheerio');

class CodeChefScraper {
  constructor() {
    this.baseUrl = 'https://www.codechef.com/users/';
  }

  async getUserStats(username) {
    try {
      const url = `${this.baseUrl}${username}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const result = {
        username: username,
        division: 'N/A',
        provisionalRating: 'N/A',
        globalRank: 'N/A',
        countryRank: 'N/A',
        totalProblemsSolved: 'N/A'
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

      // Extract Global Rank
      const globalRankMatch = divisionText.match(/Global Rank[:\s]*(\d+)/i);
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

      return result;
    } catch (error) {
      console.error(`Error fetching CodeChef data for ${username}:`, error.message);
      return {
        username,
        division: 'Error',
        provisionalRating: 'Error',
        globalRank: 'Error',
        countryRank: 'Error',
        totalProblemsSolved: 'Error',
        error: true
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

    // Process usernames sequentially to avoid rate limiting
    for (const username of usernames) {
      const stats = await this.getUserStats(username);
      results.push(stats);

      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
  }

  displayResults(results) {
    const Table = require('cli-table3');
    const table = new Table({
      head: ['Name', 'Division', 'Rating', 'Global Rank', 'Country Rank', 'Problems'],
      colWidths: [15, 8, 8, 12, 13, 10]
    });

    results.forEach(result => {
      table.push([
        result.username,
        result.division,
        result.provisionalRating,
        result.globalRank,
        result.countryRank,
        result.totalProblemsSolved
      ]);
    });

    console.log(table.toString());
  }
}

module.exports = CodeChefScraper;