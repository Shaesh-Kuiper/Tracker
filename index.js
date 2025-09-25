const axios = require('axios');
const Table = require('cli-table3');
const CodeChefScraper = require('./codechef-scraper');
const GeeksforGeeksScraper = require('./geeksforgeeks-scraper');

class LeetCodeScraper {
  constructor() {
    this.graphqlUrl = 'https://leetcode.com/graphql/';
  }

  async getUserStats(username) {
    const query = `
      query getUserProfile($username: String!) {
        matchedUser(username: $username) {
          username
          submitStatsGlobal {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }
    `;

    try {
      const response = await axios.post(this.graphqlUrl, {
        query,
        variables: { username }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const data = response.data;
      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      const user = data.data?.matchedUser;
      if (!user) {
        throw new Error(`User ${username} not found`);
      }

      const stats = user.submitStatsGlobal.acSubmissionNum;
      const result = {
        username: user.username,
        easy: 0,
        medium: 0,
        hard: 0,
        total: 0
      };

      stats.forEach(stat => {
        const difficulty = stat.difficulty.toLowerCase();
        const count = stat.count;

        if (difficulty === 'easy') {
          result.easy = count;
        } else if (difficulty === 'medium') {
          result.medium = count;
        } else if (difficulty === 'hard') {
          result.hard = count;
        }
      });

      // Calculate total from Easy + Medium + Hard only
      result.total = result.easy + result.medium + result.hard;

      return result;
    } catch (error) {
      console.error(`Error fetching data for ${username}:`, error.message);
      return {
        username,
        easy: 'Error',
        medium: 'Error',
        hard: 'Error',
        total: 'Error',
        error: true
      };
    }
  }

  async scrapeMultipleProfiles(profileLinks) {
    const usernames = profileLinks.map(link => {
      // Extract username from various LeetCode URL formats
      const match = link.match(/leetcode\.com\/(?:u\/|profile\/)?([^\/\?]+)/);
      return match ? match[1] : link;
    });

    console.log('Fetching data for users:', usernames.join(', '));
    console.log('This may take a moment...\n');

    const results = [];

    // Process usernames sequentially to avoid rate limiting
    for (const username of usernames) {
      const stats = await this.getUserStats(username);
      results.push(stats);

      // Add small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  }

  displayResults(results) {
    const table = new Table({
      head: ['Name', 'Easy', 'Medium', 'Hard', 'Total'],
      colWidths: [20, 10, 10, 10, 10]
    });

    results.forEach(result => {
      table.push([
        result.username,
        result.easy,
        result.medium,
        result.hard,
        result.total
      ]);
    });

    console.log(table.toString());
  }
}

function categorizeLinks(profileLinks) {
  const leetcodeLinks = [];
  const codechefLinks = [];
  const geeksforgeeksLinks = [];

  profileLinks.forEach(link => {
    if (link.includes('leetcode.com')) {
      leetcodeLinks.push(link);
    } else if (link.includes('codechef.com')) {
      codechefLinks.push(link);
    } else if (link.includes('geeksforgeeks.org')) {
      geeksforgeeksLinks.push(link);
    } else {
      // Assume it's a username - try to determine platform by context or let user specify
      console.log(`Warning: Unable to determine platform for "${link}". Treating as LeetCode username.`);
      leetcodeLinks.push(link);
    }
  });

  return { leetcodeLinks, codechefLinks, geeksforgeeksLinks };
}

async function main() {
  // Check if profile links are provided as command line arguments
  const profileLinks = process.argv.slice(2);

  if (profileLinks.length === 0) {
    console.log('Usage: node index.js <profile-url1> <profile-url2> ...');
    console.log('\nSupported platforms: LeetCode, CodeChef, and GeeksforGeeks');
    console.log('\nExamples:');
    console.log('node index.js https://leetcode.com/u/john_doe https://www.codechef.com/users/jane_smith');
    console.log('node index.js https://www.geeksforgeeks.org/user/username/');
    console.log('node index.js https://leetcode.com/u/user1 https://www.codechef.com/users/user2 https://www.geeksforgeeks.org/user/user3/');
    return;
  }

  const { leetcodeLinks, codechefLinks, geeksforgeeksLinks } = categorizeLinks(profileLinks);

  try {
    // Process LeetCode profiles
    if (leetcodeLinks.length > 0) {
      console.log('=== LeetCode Profiles ===');
      const leetcodeScraper = new LeetCodeScraper();
      const leetcodeResults = await leetcodeScraper.scrapeMultipleProfiles(leetcodeLinks);
      leetcodeScraper.displayResults(leetcodeResults);
      console.log();
    }

    // Process CodeChef profiles
    if (codechefLinks.length > 0) {
      console.log('=== CodeChef Profiles ===');
      const codechefScraper = new CodeChefScraper();
      const codechefResults = await codechefScraper.scrapeMultipleProfiles(codechefLinks);
      codechefScraper.displayResults(codechefResults);
      console.log();
    }

    // Process GeeksforGeeks profiles
    if (geeksforgeeksLinks.length > 0) {
      console.log('=== GeeksforGeeks Profiles ===');
      const gfgScraper = new GeeksforGeeksScraper();
      const gfgResults = await gfgScraper.scrapeMultipleProfiles(geeksforgeeksLinks);
      gfgScraper.displayResults(gfgResults);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Export for potential module use
module.exports = LeetCodeScraper;

// Run if this file is executed directly
if (require.main === module) {
  main();
}