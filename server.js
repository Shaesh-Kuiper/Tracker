const express = require('express');
const path = require('path');
const http = require('http');
const fsp = require('fs').promises;
const fs = require('fs');
const { exec } = require('child_process');
const XLSX = require('xlsx');
const multer = require('multer');
const LeetCodeScraper = require('./index.js');
const CodeChefScraper = require('./codechef-scraper');
const GeeksforGeeksScraper = require('./geeksforgeeks-scraper');
const { PLATFORM_LABELS, resolveProfileLink } = require('./profile-links');

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve base directory for runtime assets and data
const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : __dirname;
// Serve static assets from the snapshot (packaged) or source folder
const publicDir = path.join(__dirname, 'public');
const DATA_DIR = path.join(baseDir, 'data');
const DATA_FILE = path.join(DATA_DIR, 'profiles.json');

// Basic file logger to capture startup issues in packaged exe
const LOG_DIR = path.join(baseDir, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'cptracker.log');
function logLine(msg) {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (_) { /* ignore */ }
}

process.on('uncaughtException', (err) => {
    logLine(`UncaughtException: ${err && err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
    logLine(`UnhandledRejection: ${reason && reason.stack || reason}`);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Middleware
app.use(express.json());
app.use(express.static(publicDir));

// SSE logging: in-memory log buffer and client list
const sseClients = new Set();
let logBuffer = [];
const LOG_BUFFER_MAX = 200;

function sseBroadcast(event) {
    try {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of sseClients) {
            res.write(payload);
        }
        logBuffer.push(event);
        if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
    } catch (e) {
        console.error('SSE broadcast error:', e);
    }
}

app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    // Send existing buffer
    for (const ev of logBuffer) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    sseClients.add(res);
    const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 25000);
    req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
    });
});

// Initialize scrapers
const leetcodeScraper = new LeetCodeScraper();
const codechefScraper = new CodeChefScraper();
const geeksforgeeksScraper = new GeeksforGeeksScraper();

// Ensure data directory exists
async function ensureDataDirectory() {
    try {
        await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
    } catch (error) {
        console.error('Error creating data directory:', error);
        logLine(`Error creating data directory: ${error && error.stack || error}`);
    }
}

// Load profiles from file
async function loadProfiles() {
    try {
        const data = await fsp.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If file doesn't exist or is invalid, return empty structure
        logLine('Initializing empty profiles store');
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
        await fsp.writeFile(DATA_FILE, JSON.stringify(profiles, null, 2));
    } catch (error) {
        console.error('Error saving profiles:', error);
        logLine(`Error saving profiles: ${error && error.stack || error}`);
        throw error;
    }
}

// Data stored for a profile whose link could not be understood
function invalidLinkData(reason) {
    return { error: true, errorCode: 400, errorMessage: reason };
}

// Short log/UI message for a failed profile
function describeFailure(data) {
    if (data && data.errorCode === 404) return 'Profile does not exist';
    if (data && data.errorCode === 400) return 'Invalid link';
    if (data && data.errorCode === 429) return 'Rate limited';
    return 'Failed';
}

// Use '' only for missing values, so real zeros still show up in exports
function cell(value) {
    return value === undefined || value === null ? '' : value;
}

// Normalize headers to canonical keys
function normalizeHeader(h) {
    const s = String(h || '').trim().toLowerCase();
    return s
        .replace(/\s+/g, ' ')
        .replace(/[_.-]/g, ' ')
        .trim();
}

function mapHeaderToKey(h) {
    const n = normalizeHeader(h);
    if (['name', 'student name', 'full name'].includes(n)) return 'name';
    if (['reg no', 'reg no.', 'reg number', 'registration number', 'reg', 'regno', 'register number'].includes(n)) return 'reg';
    if (['dept', 'department'].includes(n)) return 'dept';
    if (['leetcode link', 'leetcode', 'lc link'].includes(n)) return 'leetcode';
    if (['codechef link', 'codechef', 'cc link'].includes(n)) return 'codechef';
    if (['geeksforgeeks link', 'geeksforgeeks', 'gfg link', 'gfg'].includes(n)) return 'geeksforgeeks';
    return null;
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Platform-specific delay configuration (ms)
function getPlatformDelayMs(platform) {
    const def = parseInt(process.env.SCRAPE_DELAY_MS || '1000', 10);
    switch (platform) {
        case 'codechef':
            return parseInt(process.env.SCRAPE_CODECHEF_DELAY_MS || process.env.SCRAPE_DELAY_MS || '6000', 10);
        case 'leetcode':
            return parseInt(process.env.SCRAPE_LEETCODE_DELAY_MS || process.env.SCRAPE_DELAY_MS || '1000', 10);
        case 'geeksforgeeks':
            return parseInt(process.env.SCRAPE_GFG_DELAY_MS || process.env.SCRAPE_DELAY_MS || '1500', 10);
        default:
            return def;
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
        return { error: true, errorMessage: error.message || 'Unexpected error' };
    }
}

// API Routes

// Get all profiles for a platform
app.get('/api/profiles/:platform(leetcode|codechef|geeksforgeeks)', async (req, res) => {
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
        const { name, regNumber, profileLink, dept } = req.body;

        // Validation
        if (!name || !regNumber || !profileLink) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!/^\d{12}$/.test(regNumber)) {
            return res.status(400).json({ error: 'Registration number must be exactly 12 digits' });
        }

        const parsedLink = await resolveProfileLink(profileLink);
        if (!parsedLink.ok) {
            return res.status(400).json({ error: parsedLink.reason });
        }
        const { platform, username } = parsedLink;

        // Load existing profiles
        const profiles = await loadProfiles();

        // Per-platform duplicate check by registration number (allow same reg across different platforms)
        if (profiles[platform].some(p => p.regNumber === regNumber)) {
            return res.status(400).json({ error: `Registration number already exists in ${platform}` });
        }

        // Optional: prevent duplicate username in same platform
        if (profiles[platform].some(p => p.username === username)) {
            return res.status(400).json({ error: `Username already exists in ${platform}` });
        }

        // Per-platform capacity limit (default 120)
        const MAX_PER_PLATFORM = parseInt(process.env.MAX_PER_PLATFORM || '120', 10);
        if (profiles[platform].length >= MAX_PER_PLATFORM) {
            return res.status(400).json({ error: `Maximum limit of ${MAX_PER_PLATFORM} ${platform} profiles reached` });
        }

        // Scrape data
        const data = await scrapeProfileData(username, platform);
        if (data.error && data.errorCode === 404) {
            return res.status(400).json({ error: `${PLATFORM_LABELS[platform]} profile "${username}" does not exist` });
        }

        // Create profile object
        const newProfile = {
            id: Date.now().toString(),
            name,
            regNumber,
            dept: dept || '',
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
app.post('/api/profiles/:platform(leetcode|codechef|geeksforgeeks)/refresh', async (req, res) => {
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

            // Re-read the link so profiles saved by older versions (with a bad username) get fixed
            const parsedLink = await resolveProfileLink(profile.profileLink, platform);
            if (!parsedLink.ok) {
                updatedProfiles.push({
                    ...profile,
                    username: '',
                    data: invalidLinkData(parsedLink.reason),
                    lastUpdated: new Date().toISOString()
                });
                continue;
            }

            const newData = await scrapeProfileData(parsedLink.username, platform);
            const updatedProfile = {
                ...profile,
                username: parsedLink.username,
                data: newData,
                lastUpdated: new Date().toISOString()
            };

            updatedProfiles.push(updatedProfile);

            // Add delay to avoid rate limiting (platform-specific)
            await delay(getPlatformDelayMs(platform));
        }

        profiles[platform] = updatedProfiles;
        await saveProfiles(profiles);

        res.json(updatedProfiles);
    } catch (error) {
        console.error('Error refreshing profiles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a single profile by platform and id
app.delete('/api/profiles/:platform(leetcode|codechef|geeksforgeeks)/:id', async (req, res) => {
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

// Remove student by registration number (across all platforms)
app.delete('/api/profiles/student/:regNumber', async (req, res) => {
    try {
        const { regNumber } = req.params;
        const profiles = await loadProfiles();

        let found = false;
        let name = null;
        const removedPlatforms = [];

        // Remove matching entries across all platforms
        for (const platform of ['leetcode', 'codechef', 'geeksforgeeks']) {
            const matches = profiles[platform].filter(p => p.regNumber === regNumber);
            if (matches.length > 0) {
                if (!name) name = matches[0].name;
                profiles[platform] = profiles[platform].filter(p => p.regNumber !== regNumber);
                removedPlatforms.push(platform);
                found = true;
            }
        }

        if (!found) {
            return res.status(404).json({ error: 'Student with this registration number not found' });
        }

        await saveProfiles(profiles);

        res.json({
            message: 'Student removed successfully',
            removed: {
                name,
                regNumber,
                platforms: removedPlatforms,
                count: removedPlatforms.length
            }
        });
    } catch (error) {
        console.error('Error removing student:', error);
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

// Excel helpers
function autosizeColumns(worksheet, rows) {
    const keys = Object.keys(rows[0] || {});
    worksheet['!cols'] = keys.map(key => ({
        wch: Math.min(Math.max(key.length, ...rows.map(row => String(cell(row[key])).length)) + 2, 50)
    }));
}

function appendSheet(workbook, rows, sheetName) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    autosizeColumns(worksheet, rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

function lastContestText(data) {
    if (!data.lastContest || data.lastContest === '--') return '';
    return data.lastContestDate ? `${data.lastContest} (${data.lastContestDate})` : data.lastContest;
}

// One row per student per CodeChef contest, newest first
function codechefContestRows(codechefProfiles) {
    const rows = [];
    for (const profile of codechefProfiles || []) {
        const history = profile.data && Array.isArray(profile.data.contestHistory) ? profile.data.contestHistory : [];
        for (const contest of [...history].reverse()) {
            rows.push({
                'Name': profile.name,
                'Registration Number': profile.regNumber,
                'Dept': profile.dept || '',
                'CodeChef Username': profile.username,
                'Contest': contest.name,
                'Contest Code': contest.code,
                'Date': contest.date,
                'Rank': cell(contest.rank),
                'Rating After': cell(contest.rating),
                'Rating Change': cell(contest.change),
                'Penalised for Cheating': contest.penalised ? 'Yes' : ''
            });
        }
    }
    return rows;
}

function sendWorkbook(res, workbook, fileName) {
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
}

const ALL_EXPORT_COLUMNS = [
    'LC_Easy', 'LC_Medium', 'LC_Hard', 'LC_Total',
    'CC_Division', 'CC_Rating', 'CC_Highest Rating', 'CC_Global Rank', 'CC_Contests', 'CC_Problems',
    'CC_Last Contest', 'CC_Last Contest Rank', 'CC_Contests (30d)', 'CC_Rating Change (30d)', 'CC_Penalties',
    'GG_Easy', 'GG_Medium', 'GG_Hard', 'GG_Score', 'GG_Rank'
];

// Export all students (one row per student) plus their CodeChef contest history
app.get('/api/export/all', async (req, res) => {
    try {
        const profiles = await loadProfiles();

        // Combine all student data by registration number
        const studentMap = new Map();
        const studentRow = profile => {
            if (!studentMap.has(profile.regNumber)) {
                const row = { 'Name': profile.name, 'Registration Number': profile.regNumber, 'Dept': profile.dept || '' };
                for (const column of ALL_EXPORT_COLUMNS) row[column] = '';
                studentMap.set(profile.regNumber, row);
            }
            return studentMap.get(profile.regNumber);
        };
        const hasData = profile => profile.data && !profile.data.error;

        for (const profile of profiles.leetcode || []) {
            const student = studentRow(profile);
            if (!hasData(profile)) continue;
            const d = profile.data;
            Object.assign(student, {
                'LC_Easy': cell(d.easy),
                'LC_Medium': cell(d.medium),
                'LC_Hard': cell(d.hard),
                'LC_Total': cell(d.total)
            });
        }

        for (const profile of profiles.codechef || []) {
            const student = studentRow(profile);
            if (!hasData(profile)) continue;
            const d = profile.data;
            Object.assign(student, {
                'CC_Division': cell(d.division),
                'CC_Rating': cell(d.provisionalRating),
                'CC_Highest Rating': cell(d.highestRating),
                'CC_Global Rank': cell(d.globalRank),
                'CC_Contests': cell(d.contestsParticipated),
                'CC_Problems': cell(d.totalProblemsSolved),
                'CC_Last Contest': lastContestText(d),
                'CC_Last Contest Rank': cell(d.lastContestRank),
                'CC_Contests (30d)': cell(d.recentContests),
                'CC_Rating Change (30d)': cell(d.recentRatingChange),
                'CC_Penalties': cell(d.penalties)
            });
        }

        for (const profile of profiles.geeksforgeeks || []) {
            const student = studentRow(profile);
            if (!hasData(profile)) continue;
            const d = profile.data;
            Object.assign(student, {
                'GG_Easy': cell(d.easy),
                'GG_Medium': cell(d.medium),
                'GG_Hard': cell(d.hard),
                'GG_Score': cell(d.codingScore),
                'GG_Rank': cell(d.contestRating)
            });
        }

        const excelData = Array.from(studentMap.values());
        if (excelData.length === 0) {
            return res.status(400).json({ error: 'No data to export' });
        }

        const workbook = XLSX.utils.book_new();
        appendSheet(workbook, excelData, 'Student Data');
        const contestRows = codechefContestRows(profiles.codechef);
        if (contestRows.length) appendSheet(workbook, contestRows, 'CodeChef Contests');

        sendWorkbook(res, workbook, `student_data_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
        console.error('Error exporting all student data to Excel:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/export/:platform(leetcode|codechef|geeksforgeeks)', async (req, res) => {
    try {
        const platform = req.params.platform;
        const profiles = await loadProfiles();

        if (!profiles[platform]) {
            return res.status(400).json({ error: 'Invalid platform' });
        }

        if (profiles[platform].length === 0) {
            return res.status(400).json({ error: 'No data to export' });
        }

        // Prepare data for Excel
        const excelData = profiles[platform].map(profile => {
            const baseData = {
                'Name': profile.name,
                'Registration Number': profile.regNumber,
                'Dept': profile.dept || '',
                'Profile Link': profile.profileLink,
                'Last Updated': new Date(profile.lastUpdated).toLocaleString()
            };

            // Add platform-specific data
            if (profile.data && !profile.data.error) {
                switch (platform) {
                    case 'leetcode':
                        Object.assign(baseData, {
                            'Easy': profile.data.easy,
                            'Medium': profile.data.medium,
                            'Hard': profile.data.hard,
                            'Total': profile.data.total
                        });
                        break;
                    case 'codechef':
                        Object.assign(baseData, {
                            'Division': profile.data.division,
                            'Rating': profile.data.provisionalRating,
                            'Highest Rating': cell(profile.data.highestRating),
                            'Global Rank': profile.data.globalRank,
                            'Country Rank': profile.data.countryRank,
                            'Problems Solved': profile.data.totalProblemsSolved,
                            'Contests Participated': profile.data.contestsParticipated,
                            'Last Contest': lastContestText(profile.data),
                            'Last Contest Rank': cell(profile.data.lastContestRank),
                            'Contests (last 30 days)': cell(profile.data.recentContests),
                            'Rating Change (last 30 days)': cell(profile.data.recentRatingChange),
                            'Cheating Penalties': cell(profile.data.penalties)
                        });
                        break;
                    case 'geeksforgeeks':
                        Object.assign(baseData, {
                            'School': profile.data.school,
                            'Basic': profile.data.basic,
                            'Easy': profile.data.easy,
                            'Medium': profile.data.medium,
                            'Hard': profile.data.hard,
                            'Total Problems': profile.data.totalProblemsSolved,
                            'Streak': profile.data.streak,
                            'Coding Score': profile.data.codingScore,
                            'Contest Rating': profile.data.contestRating
                        });
                        break;
                }
            } else {
                // Say why there is no data (bad link, deleted account, ...)
                baseData['Error'] = (profile.data && profile.data.errorMessage) || 'Could not load data';
            }

            return baseData;
        });

        const workbook = XLSX.utils.book_new();
        appendSheet(workbook, excelData, `${platform.charAt(0).toUpperCase() + platform.slice(1)} Profiles`);
        if (platform === 'codechef') {
            const contestRows = codechefContestRows(profiles.codechef);
            if (contestRows.length) appendSheet(workbook, contestRows, 'CodeChef Contests');
        }

        sendWorkbook(res, workbook, `${platform}_profiles_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bulk upload via Excel: replaces all data
app.post('/api/bulk-upload', upload.single('file'), async (req, res) => {
    try {
        // Bulk upload pacing: add 1 profile every 2 seconds by default
        const BULK_UPLOAD_DELAY_MS = parseInt(process.env.BULK_UPLOAD_DELAY_MS || '2000', 10);
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            return res.status(400).json({ error: 'No sheets found in Excel file' });
        }
        const ws = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        if (!rows.length) {
            return res.status(400).json({ error: 'Empty Excel sheet' });
        }

        const headerRow = rows[0];
        const idx = { name: -1, reg: -1, dept: -1, leetcode: -1, codechef: -1, geeksforgeeks: -1 };
        headerRow.forEach((h, i) => {
            const key = mapHeaderToKey(h);
            if (key && idx[key] === -1) idx[key] = i;
        });

        if (idx.name === -1 || idx.reg === -1) {
            return res.status(400).json({ error: 'Missing required headers: name and reg no' });
        }

        // Pre-count how many profiles will be created for progress reporting
        let expectedTotal = 0;
        const MAX_TOTAL = parseInt(process.env.BULK_UPLOAD_MAX_TOTAL || '1000', 10);
        for (let r = 1; r < rows.length; r++) {
            const row = rows[r] || [];
            const leet = idx.leetcode !== -1 ? String(row[idx.leetcode] || '').trim() : '';
            const cc = idx.codechef !== -1 ? String(row[idx.codechef] || '').trim() : '';
            const gfg = idx.geeksforgeeks !== -1 ? String(row[idx.geeksforgeeks] || '').trim() : '';
            const links = [
                { platform: 'leetcode', link: leet },
                { platform: 'codechef', link: cc },
                { platform: 'geeksforgeeks', link: gfg }
            ].filter(x => x.link);
            expectedTotal += links.length;
            if (expectedTotal > MAX_TOTAL) { expectedTotal = MAX_TOTAL; break; }
        }
        // Announce start/reset to log listeners
        sseBroadcast({ type: 'reset', total: expectedTotal, ts: Date.now() });

        const newProfiles = { leetcode: [], codechef: [], geeksforgeeks: [] };
        const errors = [];
        let totalToCreate = 0;

        for (let r = 1; r < rows.length; r++) {
            const row = rows[r] || [];
            const name = String(row[idx.name] || '').trim();
            const regRaw = String(row[idx.reg] || '').trim();
            const regNumber = (regRaw.match(/\d+/g) || []).join('');
            const dept = idx.dept !== -1 ? String(row[idx.dept] || '').trim() : '';

            const leet = idx.leetcode !== -1 ? String(row[idx.leetcode] || '').trim() : '';
            const cc = idx.codechef !== -1 ? String(row[idx.codechef] || '').trim() : '';
            const gfg = idx.geeksforgeeks !== -1 ? String(row[idx.geeksforgeeks] || '').trim() : '';

            if (!name || !/^\d{12}$/.test(regNumber)) {
                errors.push(`Row ${r + 1}: invalid name/reg no`);
                continue;
            }

            const links = [
                { platform: 'leetcode', link: leet },
                { platform: 'codechef', link: cc },
                { platform: 'geeksforgeeks', link: gfg }
            ].filter(x => x.link);

            totalToCreate += links.length;
            if (totalToCreate > MAX_TOTAL) {
                return res.status(400).json({ error: `Total profiles across all platforms cannot exceed ${MAX_TOTAL}` });
            }

            for (const { platform, link } of links) {
                // Broken links still get a row (with the reason) so they are easy to spot and fix
                const parsedLink = await resolveProfileLink(link, platform);
                const username = parsedLink.ok ? parsedLink.username : '';
                let data = parsedLink.ok
                    ? await scrapeProfileData(username, platform)
                    : invalidLinkData(parsedLink.reason);
                if (!data) {
                    data = { error: true, errorMessage: 'No data returned' };
                }

                const newProfile = {
                    id: `${Date.now()}-${platform}-${Math.random().toString(36).slice(2, 8)}`,
                    name,
                    regNumber,
                    dept,
                    profileLink: link,
                    username,
                    data,
                    createdAt: new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };

                newProfiles[platform].push(newProfile);
                // Emit per-profile log line
                let status = 'success';
                let message = `Uploaded successfully : ${platform} -> ${username}`;
                if (data.error) {
                    status = 'error';
                    message = `${describeFailure(data)} : ${platform} -> ${username || name} (${data.errorMessage || 'unknown error'})`;
                }
                sseBroadcast({ type: 'log', status, platform, username, message, ts: Date.now() });
                // Add one profile every BULK_UPLOAD_DELAY_MS (default 2000ms); no need to wait after a bad link
                if (parsedLink.ok) await delay(BULK_UPLOAD_DELAY_MS);
            }
        }

        if (errors.length && newProfiles.leetcode.length + newProfiles.codechef.length + newProfiles.geeksforgeeks.length === 0) {
            return res.status(400).json({ error: `No valid rows found. Errors: ${errors.join('; ')}` });
        }

        await saveProfiles(newProfiles);

        return res.json({
            message: 'Bulk upload successful',
            counts: {
                leetcode: newProfiles.leetcode.length,
                codechef: newProfiles.codechef.length,
                geeksforgeeks: newProfiles.geeksforgeeks.length
            },
            total: newProfiles.leetcode.length + newProfiles.codechef.length + newProfiles.geeksforgeeks.length,
            errors
        });
    } catch (error) {
        console.error('Error during bulk upload:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Start server
async function startServer() {
    await ensureDataDirectory();

    let server;
    async function listenWithRetry(startPort, maxAttempts = 10) {
        let port = Number(startPort) || 3000;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                server = http.createServer(app);
                await new Promise((resolve, reject) => {
                    const onError = (err) => {
                        server.off('listening', onListening);
                        reject(err);
                    };
                    const onListening = () => {
                        server.off('error', onError);
                        resolve();
                    };
                    server.once('error', onError);
                    server.once('listening', onListening);
                    server.listen(port, '127.0.0.1');
                });
                return port;
            } catch (err) {
                logLine(`Listen error on port ${port}: ${err.code || err.message}`);
                // Increment port on EADDRINUSE, otherwise rethrow
                if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
                    port += 1;
                    try { server.close(); } catch(_) {}
                    continue;
                }
                throw err;
            }
        }
        throw new Error('Unable to bind to any port');
    }

    try {
        const boundPort = await listenWithRetry(PORT, 20);
        const url = `http://localhost:${boundPort}`;
        const msg1 = `Competitive Programming Tracker server running on ${url}`;
        const msg2 = `Open your browser and go to: ${url}`;
        console.log(msg1);
        console.log(msg2);
        logLine(msg1);
        logLine(msg2);

        // Auto-open the default browser
        try {
            if (process.platform === 'win32') {
                exec(`start "" "${url}"`);
            } else if (process.platform === 'darwin') {
                exec(`open "${url}"`);
            } else {
                exec(`xdg-open "${url}"`);
            }
        } catch (e) {
            logLine(`Failed to open browser: ${e && e.stack || e}`);
        }
    } catch (e) {
        const emsg = `Fatal error starting server: ${e && e.stack || e}`;
        console.error(emsg);
        logLine(emsg);
        // Keep process alive for a short period so the console doesn't vanish immediately
        setTimeout(() => process.exit(1), 15000);
    }
}

startServer().catch(console.error);
