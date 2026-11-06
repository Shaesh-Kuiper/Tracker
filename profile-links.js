// Turns whatever a student pasted into a platform + username.
// Handles links without https://, tracking parameters, old URL formats,
// short links (e.g. share.google) and links pasted into the wrong column.

const axios = require('./http-client');
const { USER_AGENT } = require('./scrape-utils');

const PLATFORM_LABELS = {
    leetcode: 'LeetCode',
    codechef: 'CodeChef',
    geeksforgeeks: 'GeeksforGeeks'
};

// First path segments on leetcode.com that are pages, not usernames.
const LEETCODE_RESERVED = new Set([
    'problems', 'problemset', 'contest', 'discuss', 'explore', 'studyplan', 'study-plan',
    'accounts', 'subscribe', 'store', 'interview', 'assessment', 'playground', 'company',
    'tag', 'list', 'progress', 'submissions', 'notifications', 'settings', 'premium', 'jobs',
    'u', 'profile'
]);

function platformFromHost(host) {
    host = host.toLowerCase();
    if (host === 'leetcode.com' || host.endsWith('.leetcode.com')) return 'leetcode';
    if (host === 'codechef.com' || host.endsWith('.codechef.com')) return 'codechef';
    if (host === 'geeksforgeeks.org' || host.endsWith('.geeksforgeeks.org')) return 'geeksforgeeks';
    return null;
}

// Picks the URL out of text such as "name | CodeChef profile https://share.google/abc".
function findUrl(text) {
    const tokens = String(text || '').split(/[\s|,;]+/).filter(Boolean);
    return tokens.find(t => /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/|$)/i.test(t)) || null;
}

function toUrl(raw) {
    try {
        return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch (_) {
        return null;
    }
}

function usernameFromPath(platform, pathname) {
    const parts = pathname.split('/').filter(Boolean).map(p => decodeURIComponent(p));
    switch (platform) {
        case 'leetcode':
            // leetcode.com/u/<name>, leetcode.com/profile/<name>, or legacy leetcode.com/<name>
            if ((parts[0] === 'u' || parts[0] === 'profile') && parts[1]) return parts[1];
            if (parts.length >= 1 && !LEETCODE_RESERVED.has(parts[0].toLowerCase())) return parts[0];
            return null;
        case 'codechef':
            // codechef.com/users/<name>
            return parts[0] === 'users' && parts[1] ? parts[1] : null;
        case 'geeksforgeeks':
            // geeksforgeeks.org/user/<name>, geeksforgeeks.org/profile/<name>, auth.geeksforgeeks.org/user/<name>
            return (parts[0] === 'user' || parts[0] === 'profile') && parts[1] ? parts[1] : null;
        default:
            return null;
    }
}

const VALID_USERNAME = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Parses a profile link without any network access.
 * @param {string} raw - what the student entered
 * @param {string} [expectedPlatform] - the column the link came from, if known
 * @returns {{ok: true, platform, username} | {ok: false, reason, needsResolve?, url?}}
 */
function parseProfileLink(raw, expectedPlatform) {
    const text = String(raw || '').trim();
    if (!text) return { ok: false, reason: 'No link provided' };

    const found = findUrl(text);
    if (!found) {
        // A bare username in a platform column, e.g. "jagan_5"
        if (expectedPlatform && VALID_USERNAME.test(text)) {
            return { ok: true, platform: expectedPlatform, username: text };
        }
        return { ok: false, reason: `Not a valid profile link: "${text.slice(0, 80)}"` };
    }

    const url = toUrl(found);
    if (!url) return { ok: false, reason: `Not a valid profile link: "${found.slice(0, 80)}"` };

    const platform = platformFromHost(url.hostname);
    if (!platform) {
        // Probably a short/redirect link; the caller can try resolving it.
        return { ok: false, reason: `Not a ${PLATFORM_LABELS[expectedPlatform] || 'supported'} profile link: ${url.href.slice(0, 80)}`, needsResolve: true, url: url.href };
    }

    if (expectedPlatform && platform !== expectedPlatform) {
        return { ok: false, reason: `This is a ${PLATFORM_LABELS[platform]} link, not a ${PLATFORM_LABELS[expectedPlatform]} link` };
    }

    const username = usernameFromPath(platform, url.pathname);
    if (!username || !VALID_USERNAME.test(username)) {
        return { ok: false, reason: `Link does not point to a ${PLATFORM_LABELS[platform]} profile: ${url.href.slice(0, 80)}` };
    }

    return { ok: true, platform, username };
}

/**
 * Same as parseProfileLink, but follows short links (share.google, bit.ly, ...)
 * to find the real profile URL.
 */
async function resolveProfileLink(raw, expectedPlatform) {
    const parsed = parseProfileLink(raw, expectedPlatform);
    if (parsed.ok || !parsed.needsResolve) return parsed;

    try {
        const response = await axios.get(parsed.url, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000,
            maxRedirects: 10,
            validateStatus: () => true,
            // Only the final URL matters, so don't download huge pages
            maxContentLength: 5 * 1024 * 1024
        });
        const finalUrl = response.request && response.request.res && response.request.res.responseUrl;
        if (finalUrl && finalUrl !== parsed.url) {
            const resolved = parseProfileLink(finalUrl, expectedPlatform);
            if (resolved.ok || !resolved.needsResolve) return resolved;
        }
    } catch (_) {
        // fall through to the original reason
    }
    const { needsResolve, url, ...rest } = parsed;
    return rest;
}

module.exports = {
    PLATFORM_LABELS,
    parseProfileLink,
    resolveProfileLink
};
