const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const LeetCodeScraper = require('./index.js');
const CodeChefScraper = require('./codechef-scraper');
const GeeksforGeeksScraper = require('./geeksforgeeks-scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'profiles.json');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize scrapers
const leetcodeScraper = new LeetCodeScraper();
const codechefScraper = new CodeChefScraper();
const geeksforgeeksScraper = new GeeksforGeeksScraper();

// Ensure data directory exists
async function ensureDataDirectory() {
    try {
        await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    } catch (error) {
        console.error('Error creating data directory:', error);
    }
}

// Load profiles from file
async function loadProfiles() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If file doesn't exist or is invalid, return empty structure
        return {
            leetcode: [],
            codechef: [],
            geeksforgeeks: []
        };
    }
}

// Save profiles to file
async function saveProfiles(profiles) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(profiles, null, 2));
    } catch (error) {
        console.error('Error saving profiles:', error);
        throw error;
    }
}

// Determine platform from URL
function determinePlatform(url) {
    if (url.includes('leetcode.com')) return 'leetcode';
    if (url.includes('codechef.com')) return 'codechef';
    if (url.includes('geeksforgeeks.org')) return 'geeksforgeeks';
    return null;
}

// Extract username from URL
function extractUsername(url, platform) {
    switch (platform) {
        case 'leetcode':
            const leetcodeMatch = url.match(/leetcode\.com\/(?:u\/|profile\/)?([^\/\?]+)/);
            return leetcodeMatch ? leetcodeMatch[1] : url;
        case 'codechef':
            const codechefMatch = url.match(/codechef\.com\/users\/([^\/\?]+)/);
            return codechefMatch ? codechefMatch[1] : url;
        case 'geeksforgeeks':
            const gfgMatch = url.match(/geeksforgeeks\.org\/user\/([^\/\?]+)/);
            return gfgMatch ? gfgMatch[1] : url;
        default:
            return url;
    }
}

// Scrape profile data based on platform
async function scrapeProfileData(username, platform) {
    try {
        switch (platform) {
            case 'leetcode':
                return await leetcodeScraper.getUserStats(username);
            case 'codechef':
                return await codechefScraper.getUserStats(username);
            case 'geeksforgeeks':
                return await geeksforgeeksScraper.getUserStats(username);
            default:
                throw new Error('Unsupported platform');
        }
    } catch (error) {
        console.error(`Error scraping ${platform} data for ${username}:`, error);
        return { error: true };
    }
}

// API Routes

// Get all profiles for a platform
app.get('/api/profiles/:platform', async (req, res) => {
    try {
        const platform = req.params.platform;
        const profiles = await loadProfiles();

        if (!profiles[platform]) {
            return res.status(400).json({ error: 'Invalid platform' });
        }

        res.json(profiles[platform]);
    } catch (error) {
        console.error('Error loading profiles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add a new profile
app.post('/api/profiles', async (req, res) => {
    try {
        const { name, regNumber, profileLink } = req.body;

        // Validation
        if (!name || !regNumber || !profileLink) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!/^\d{12}$/.test(regNumber)) {
            return res.status(400).json({ error: 'Registration number must be exactly 12 digits' });
        }

        const platform = determinePlatform(profileLink);
        if (!platform) {
            return res.status(400).json({ error: 'Unsupported platform' });
        }

        // Load existing profiles
        const profiles = await loadProfiles();

        // Check if registration number already exists
        const allProfiles = [...profiles.leetcode, ...profiles.codechef, ...profiles.geeksforgeeks];
        if (allProfiles.some(profile => profile.regNumber === regNumber)) {
            return res.status(400).json({ error: 'Registration number already exists' });
        }

        // Check total profile limit (120)
        if (allProfiles.length >= 120) {
            return res.status(400).json({ error: 'Maximum limit of 120 profiles reached' });
        }

        // Extract username and scrape data
        const username = extractUsername(profileLink, platform);
        const data = await scrapeProfileData(username, platform);

        // Create profile object
        const newProfile = {
            id: Date.now().toString(),
            name,
            regNumber,
            profileLink,
            username,
            data,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        // Add to appropriate platform array
        profiles[platform].push(newProfile);

        // Save profiles
        await saveProfiles(profiles);

        res.status(201).json({ message: 'Profile added successfully', profile: newProfile });
    } catch (error) {
        console.error('Error adding profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Refresh data for a specific platform
app.post('/api/profiles/:platform/refresh', async (req, res) => {
    try {
        const platform = req.params.platform;
        const profiles = await loadProfiles();

        if (!profiles[platform]) {
            return res.status(400).json({ error: 'Invalid platform' });
        }

        // Refresh data for all profiles in this platform
        const updatedProfiles = [];

        for (const profile of profiles[platform]) {
            console.log(`Refreshing ${platform} data for ${profile.name}...`);

            const newData = await scrapeProfileData(profile.username, platform);
            const updatedProfile = {
                ...profile,
                data: newData,
                lastUpdated: new Date().toISOString()
            };

            updatedProfiles.push(updatedProfile);

            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        profiles[platform] = updatedProfiles;
        await saveProfiles(profiles);

        res.json(updatedProfiles);
    } catch (error) {
        console.error('Error refreshing profiles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a profile
app.delete('/api/profiles/:platform/:id', async (req, res) => {
    try {
        const { platform, id } = req.params;
        const profiles = await loadProfiles();

        if (!profiles[platform]) {
            return res.status(400).json({ error: 'Invalid platform' });
        }

        const profileIndex = profiles[platform].findIndex(p => p.id === id);
        if (profileIndex === -1) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        profiles[platform].splice(profileIndex, 1);
        await saveProfiles(profiles);

        res.json({ message: 'Profile deleted successfully' });
    } catch (error) {
        console.error('Error deleting profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const profiles = await loadProfiles();
        const stats = {
            total: 0,
            platforms: {
                leetcode: profiles.leetcode.length,
                codechef: profiles.codechef.length,
                geeksforgeeks: profiles.geeksforgeeks.length
            }
        };

        stats.total = stats.platforms.leetcode + stats.platforms.codechef + stats.platforms.geeksforgeeks;

        res.json(stats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {
    await ensureDataDirectory();

    app.listen(PORT, () => {
        console.log(`Competitive Programming Tracker server running on http://localhost:${PORT}`);
        console.log(`Open your browser and go to: http://localhost:${PORT}`);
    });
}

startServer().catch(console.error);