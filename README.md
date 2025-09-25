# Competitive Programming Tracker

A comprehensive web application to track and monitor competitive programming profiles across LeetCode, CodeChef, and GeeksforGeeks. Features both a modern web interface and command-line tools.

## Features

### Web Application
- **Modern Web Interface**: Clean, responsive design with tabbed navigation
- **Profile Management**: Add profiles with name, registration number, and platform URL
- **Multi-Platform Support**: Track up to 120 profiles across all platforms
- **Real-time Data**: Refresh profile data with a single click
- **Statistics Dashboard**: View summary statistics for each platform
- **Data Persistence**: All profile data is saved locally

### Platform Support

**LeetCode:**
- Problem counts by difficulty (Easy, Medium, Hard, Total)
- Uses official LeetCode GraphQL API

**CodeChef:**
- Division, Provisional Rating, Global Rank, Country Rank
- Total problems solved and contests participated
- Web scraping with fallback API support

**GeeksforGeeks:**
- Total problems solved with difficulty breakdown (School, Basic, Easy, Medium, Hard)
- Coding score, current streak, and contest rating
- API-based data fetching

## Installation

```bash
npm install
```

## Usage

### Web Application

Start the web server:

```bash
npm start
```

Then open your browser and go to: `http://localhost:3000`

### Command Line Interface

Use the original CLI for batch operations:

```bash
# LeetCode profiles only
npm run cli https://leetcode.com/u/username1 https://leetcode.com/u/username2

# CodeChef profiles only
npm run cli https://www.codechef.com/users/username1 https://www.codechef.com/users/username2

# Mixed platforms in one command
npm run cli https://leetcode.com/u/john_doe https://www.codechef.com/users/jane_smith

# Using just usernames (assumes LeetCode for ambiguous cases)
npm run cli username1 username2
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