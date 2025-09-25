const axios = require('axios');

class GeeksforGeeksScraper {
  constructor() {
    this.apiUrl = 'https://geeks-for-geeks-api.vercel.app';
  }

  async getUserStats(username) {
    try {
      const url = `${this.apiUrl}/${username}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });

      const data = response.data;

      if (data.error) {
        throw new Error(data.error);
      }

      const result = {
        username: username,
        totalProblemsSolved: 0,
        school: 0,
        basic: 0,
        easy: 0,
        medium: 0,
        hard: 0,
        streak: '--',
        codingScore: '--',
        contestRating: '--'
      };

      // Extract basic info
      if (data.info) {
        result.codingScore = data.info.codingScore || '--';
        result.totalProblemsSolved = data.info.totalProblemsSolved || 0;
        result.streak = (data.info.currentStreak !== undefined) ? data.info.currentStreak : '--';

        // Extract contest rating if available
        if (data.info.contestRating) {
          result.contestRating = data.info.contestRating;
        }
      }

      // Extract problems solved by difficulty - correct structure
      if (data.solvedStats) {
        result.school = data.solvedStats.school?.count || 0;
        result.basic = data.solvedStats.basic?.count || 0;
        result.easy = data.solvedStats.easy?.count || 0;
        result.medium = data.solvedStats.medium?.count || 0;
        result.hard = data.solvedStats.hard?.count || 0;
      }

      return result;
    } catch (error) {
      console.error(`Error fetching GeeksforGeeks data for ${username}:`, error.message);
      return {
        username,
        totalProblemsSolved: 'Error',
        school: 'Error',
        basic: 'Error',
        easy: 'Error',
        medium: 'Error',
        hard: 'Error',
        streak: 'Error',
        codingScore: 'Error',
        contestRating: 'Error',
        error: true
      };
    }
  }

  async scrapeMultipleProfiles(profileLinks) {
    const usernames = profileLinks.map(link => {
      // Extract username from GeeksforGeeks URL
      const match = link.match(/geeksforgeeks\.org\/user\/([^\/\?]+)/);
      return match ? match[1] : link;
    });

    console.log('Fetching GeeksforGeeks data for users:', usernames.join(', '));
    console.log('This may take a moment...\n');

    const results = [];

    // Process usernames sequentially to avoid rate limiting
    for (const username of usernames) {
      const stats = await this.getUserStats(username);
      results.push(stats);

      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 1500));
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