# Competitive Programming Profile Scraper

A Node.js application that fetches profile statistics from LeetCode and CodeChef, displaying them in a tabular format.

## Features

**LeetCode Support:**
- Scrapes multiple LeetCode profiles at once
- Displays problem counts by difficulty (Easy, Medium, Hard)
- Shows total problems solved
- Uses official LeetCode GraphQL API

**CodeChef Support:**
- Fetches Division, Provisional Rating, Global Rank, Country Rank
- Shows total problems solved
- Web scraping with fallback API support

**General:**
- Supports mixed platform URLs in a single command
- Outputs data in clean tabular formats
- Handles various URL formats
- Rate limiting to prevent API abuse

## Installation

```bash
npm install
```

## Usage

Run the script with LeetCode profile URLs or usernames:

```bash
# LeetCode profiles only
node index.js https://leetcode.com/u/username1 https://leetcode.com/u/username2

# CodeChef profiles only
node index.js https://www.codechef.com/users/username1 https://www.codechef.com/users/username2

# Mixed platforms in one command
node index.js https://leetcode.com/u/john_doe https://www.codechef.com/users/jane_smith

# Using just usernames (assumes LeetCode for ambiguous cases)
node index.js username1 username2
```

## Example Output

**LeetCode Profiles:**
```
=== LeetCode Profiles ===
┌────────────────────┬──────────┬──────────┬──────────┬──────────┐
│ Name               │ Easy     │ Medium   │ Hard     │ Total    │
├────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ john_doe           │ 145      │ 89       │ 23       │ 257      │
└────────────────────┴──────────┴──────────┴──────────┴──────────┘
```

**CodeChef Profiles:**
```
=== CodeChef Profiles ===
┌───────────────┬────────┬────────┬────────────┬─────────────┬──────────┐
│ Name          │ Divis… │ Rating │ Global Ra… │ Country Ra… │ Problems │
├───────────────┼────────┼────────┼────────────┼─────────────┼──────────┤
│ jane_smith    │ Div 3  │ 1456   │ 2341       │ 45672       │ 25       │
└───────────────┴────────┴────────┴────────────┴─────────────┴──────────┘
```

## How it Works

**LeetCode:**
- Uses LeetCode's official GraphQL API
- Extracts usernames from URLs
- Fetches submission statistics by difficulty
- Calculates totals from Easy + Medium + Hard counts

**CodeChef:**
- Web scrapes profile pages using Cheerio
- Extracts text-based statistics using regex patterns
- Falls back to third-party API when needed
- Parses division, rating, ranks, and problem counts

## Error Handling

- Invalid usernames will show "Error" in the table
- Rate limiting is implemented with 1-second delays between requests
- Detailed error messages are logged to the console

## Dependencies

- `axios`: HTTP client for API requests
- `cli-table3`: Terminal table formatting