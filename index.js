const axios = require('./http-client');
const Table = require('cli-table3');
const CodeChefScraper = require('./codechef-scraper');
const GeeksforGeeksScraper = require('./geeksforgeeks-scraper');
const { USER_AGENT, ScrapeError, createThrottle, requestWithRetry, errorResult } = require('./scrape-utils');
const { parseProfileLink } = require('./profile-links');

const LEETCODE_MIN_GAP_MS = parseInt(process.env.SCRAPE_LEETCODE_MIN_GAP_MS || '1000', 10);
const waitTurn = createThrottle(LEETCODE_MIN_GAP_MS);

const FIELDS = ['easy', 'medium', 'hard', 'total'];

const PROFILE_QUERY = `
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

class LeetCodeScraper {
  constructor() {
    this.graphqlUrl = 'https://leetcode.com/graphql/';
  }

  async getUserStats(username) {
    try {
      await waitTurn();
      const response = await requestWithRetry(() => axios.post(this.graphqlUrl, {
        query: PROFILE_QUERY,
        variables: { username }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'Referer': 'https://leetcode.com/'
        },
        timeout: 20000,
        validateStatus: () => true
      }), `LeetCode ${username}`);

      const data = response.data || {};
      const user = data.data && data.data.matchedUser;
      if (!user) {
        const message = (data.errors && data.errors[0] && data.errors[0].message) || '';
        if (/does not exist|not found/i.test(message) || (response.status === 200 && data.data)) {
          throw new ScrapeError('LeetCode profile not found', 404);
        }
        throw new ScrapeError(`LeetCode returned HTTP ${response.status}${message ? `: ${message}` : ''}`, response.status);
      }

      const result = {
        username: user.username,
        easy: 0,
        medium: 0,
        hard: 0,
        total: 0
      };

      for (const stat of user.submitStatsGlobal.acSubmissionNum) {
        const difficulty = stat.difficulty.toLowerCase();
        if (difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard') {
          result[difficulty] = stat.count;
        }
      }

      // Calculate total from Easy + Medium + Hard only
      result.total = result.easy + result.medium + result.hard;

      return result;
    } catch (error) {
      console.error(`Error fetching LeetCode data for ${username}:`, error.message);
      return errorResult(username, FIELDS, error);
    }
  }

  async scrapeMultipleProfiles(profileLinks) {
    const usernames = profileLinks.map(link => {
      const parsed = parseProfileLink(link, 'leetcode');
      return parsed.ok ? parsed.username : link;
    });

    console.log('Fetching data for users:', usernames.join(', '));
    console.log('This may take a moment...\n');

    const results = [];
    // Requests are paced by the shared throttle
    for (const username of usernames) {
      results.push(await this.getUserStats(username));
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
    const parsed = parseProfileLink(link);
    const platform = parsed.ok ? parsed.platform : null;
    if (platform === 'codechef') {
      codechefLinks.push(link);
    } else if (platform === 'geeksforgeeks') {
      geeksforgeeksLinks.push(link);
    } else {
      if (platform !== 'leetcode') {
        // Assume it's a LeetCode username
        console.log(`Warning: Unable to determine platform for "${link}". Treating as LeetCode username.`);
      }
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