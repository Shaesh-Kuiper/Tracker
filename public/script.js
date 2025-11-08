// Store profiles data for search functionality
const platformProfiles = {
    leetcode: [],
    codechef: [],
    geeksforgeeks: []
};

// Tab functionality
document.addEventListener('DOMContentLoaded', function() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // Remove active class from all tabs and contents
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked tab and corresponding content
            btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');

            // Load data when switching to platform tabs
            if (tabId !== 'home') {
                loadPlatformData(tabId);
            }
        });
    });

    // Form submission
    document.getElementById('profileForm').addEventListener('submit', handleFormSubmit);

    // Remove student form submission
    document.getElementById('removeStudentForm').addEventListener('submit', handleRemoveStudent);

    // Bulk upload submission
    const bulkUploadForm = document.getElementById('bulkUploadForm');
    if (bulkUploadForm) {
        bulkUploadForm.addEventListener('submit', handleBulkUpload);
    }

    // Refresh buttons
    document.getElementById('refreshLeetCode').addEventListener('click', () => refreshPlatformData('leetcode'));
    document.getElementById('refreshCodeChef').addEventListener('click', () => refreshPlatformData('codechef'));
    document.getElementById('refreshGeeksforGeeks').addEventListener('click', () => refreshPlatformData('geeksforgeeks'));

    // Export buttons
    document.getElementById('exportLeetCode').addEventListener('click', () => exportPlatformData('leetcode'));
    document.getElementById('exportCodeChef').addEventListener('click', () => exportPlatformData('codechef'));
    document.getElementById('exportGeeksforGeeks').addEventListener('click', () => exportPlatformData('geeksforgeeks'));

    // Search inputs
    document.getElementById('searchLeetCode').addEventListener('input', (e) => handleSearch('leetcode', e.target.value));
    document.getElementById('searchCodeChef').addEventListener('input', (e) => handleSearch('codechef', e.target.value));
    document.getElementById('searchGeeksforGeeks').addEventListener('input', (e) => handleSearch('geeksforgeeks', e.target.value));

    // Load initial data
    loadAllData();

    // Connect to upload log stream
    connectLogStream();
});

async function handleFormSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const profileData = {
        name: formData.get('name'),
        regNumber: formData.get('regNumber'),
        dept: formData.get('dept'),
        profileLink: formData.get('profileLink')
    };

    // Validate registration number
    if (!/^\d{12}$/.test(profileData.regNumber)) {
        showMessage('Registration number must be exactly 12 digits', 'error');
        return;
    }

    // Determine platform
    const platform = determinePlatform(profileData.profileLink);
    if (!platform) {
        showMessage('Unsupported platform. Please use LeetCode, CodeChef, or GeeksforGeeks URLs', 'error');
        return;
    }

    try {
        const response = await fetch('/api/profiles', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(profileData)
        });

        const result = await response.json();

        if (response.ok) {
            showMessage('Profile added successfully!', 'success');
            e.target.reset();
            // Refresh the relevant platform data
            await loadPlatformData(platform);
        } else {
            showMessage(result.error || 'Failed to add profile', 'error');
        }
    } catch (error) {
        showMessage('Network error. Please try again.', 'error');
    }
}

function determinePlatform(url) {
    if (url.includes('leetcode.com')) return 'leetcode';
    if (url.includes('codechef.com')) return 'codechef';
    if (url.includes('geeksforgeeks.org')) return 'geeksforgeeks';
    return null;
}

function showMessage(text, type) {
    const messageEl = document.getElementById('message');
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';

    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 5000);
}

function showRemoveMessage(text, type) {
    const messageEl = document.getElementById('removeMessage');
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';

    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 5000);
}

function showBulkMessage(text, type) {
    const messageEl = document.getElementById('bulkMessage');
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';

    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 7000);
}

async function handleBulkUpload(e) {
    e.preventDefault();
    const fileInput = document.getElementById('bulkFile');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showBulkMessage('Please select an Excel file to upload.', 'error');
        return;
    }

    const file = fileInput.files[0];
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
        showBulkMessage('Only .xlsx or .xls files are supported.', 'error');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading...';
    }

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/bulk-upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            showBulkMessage(`Upload successful. Total: ${result.total}. LeetCode: ${result.counts.leetcode}, CodeChef: ${result.counts.codechef}, GeeksforGeeks: ${result.counts.geeksforgeeks}.`, 'success');
            await loadAllData();
            e.target.reset();
        } else {
            showBulkMessage(result.error || 'Bulk upload failed.', 'error');
        }
    } catch (err) {
        showBulkMessage('Network error during bulk upload.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload and Replace';
        }
    }
}

// --- Upload log stream (SSE) ---
let LOG_SUCCESS = 0;
let LOG_FAIL = 0;
let LOG_TOTAL = 0;

function connectLogStream() {
    const terminal = document.getElementById('logTerminal');
    if (!terminal) return; // Not on page

    const progressEl = document.getElementById('logProgress');
    const es = new EventSource('/api/logs/stream');

    es.onmessage = (evt) => {
        try {
            const data = JSON.parse(evt.data);
            if (data.type === 'reset') {
                LOG_SUCCESS = 0; LOG_FAIL = 0; LOG_TOTAL = data.total || 0;
                terminal.innerHTML = '';
                updateLogProgress();
                appendLogLine('info', `Started bulk upload. Expected: ${LOG_TOTAL}`);
                return;
            }
            if (data.type === 'log') {
                appendLogLine(data.status === 'success' ? 'success' : 'error', data.message);
                if (data.status === 'success') LOG_SUCCESS++; else LOG_FAIL++;
                updateLogProgress();
                return;
            }
        } catch (e) {
            // ignore malformed events
        }
    };

    es.onerror = () => {
        // Try to reconnect automatically after brief pause
        setTimeout(() => {
            try { es.close(); } catch {}
            connectLogStream();
        }, 3000);
    };
}

function appendLogLine(kind, text) {
    const terminal = document.getElementById('logTerminal');
    if (!terminal) return;
    const line = document.createElement('div');
    line.className = `log-line ${kind}`;
    line.textContent = text;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function updateLogProgress() {
    const el = document.getElementById('logProgress');
    if (!el) return;
    const processed = LOG_SUCCESS + LOG_FAIL;
    const totalPart = LOG_TOTAL ? ` / ${LOG_TOTAL}` : '';
    el.textContent = `Success: ${LOG_SUCCESS} | Failed: ${LOG_FAIL} | Processed: ${processed}${totalPart}`;
}

async function loadAllData() {
    await loadPlatformData('leetcode');
    await loadPlatformData('codechef');
    await loadPlatformData('geeksforgeeks');
}

// Helper to map platform to correct button IDs used in HTML
function getButtonId(prefix, platform) {
    const properCasing = {
        leetcode: 'LeetCode',
        codechef: 'CodeChef',
        geeksforgeeks: 'GeeksforGeeks'
    };
    const suffix = properCasing[platform] || capitalizeFirst(platform);
    return `${prefix}${suffix}`;
}

async function loadPlatformData(platform) {
    const container = document.getElementById(`${platform}Table`);

    try {
        container.innerHTML = '<div class="loading">Loading data...</div>';

        const response = await fetch(`/api/profiles/${platform}`);
        const data = await response.json();

        if (response.ok) {
            renderPlatformTable(platform, data);
        } else {
            container.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        container.innerHTML = '<div class="error">Network error. Please try again.</div>';
    }
}

async function refreshPlatformData(platform) {
    const button = document.getElementById(getButtonId('refresh', platform));
    if (button) {
        button.disabled = true;
        button.textContent = 'Refreshing...';
    }

    try {
        const response = await fetch(`/api/profiles/${platform}/refresh`, {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok) {
            // Clear search input when refreshing
            const searchInput = document.getElementById(getButtonId('search', platform));
            if (searchInput) {
                searchInput.value = '';
            }

            renderPlatformTable(platform, data);
            showMessage('Data refreshed successfully!', 'success');
        } else {
            showMessage(`Failed to refresh ${platform} data: ${data.error}`, 'error');
        }
    } catch (error) {
        showMessage('Network error during refresh', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Refresh Data';
        }
    }
}

function renderPlatformTable(platform, profiles) {
    // Store profiles for search functionality
    platformProfiles[platform] = profiles;

    const container = document.getElementById(`${platform}Table`);
    const countElement = document.getElementById(`${platform}Count`);

    // Update count in header
    countElement.textContent = profiles.length;

    if (profiles.length === 0) {
        container.innerHTML = `
            <p style="text-align: center; color: #666; padding: 40px;">No ${capitalizeFirst(platform)} profiles found. Add some profiles from the Home tab!</p>
        `;
        return;
    }

    let tableHTML = `
        <table class="data-table" data-platform="${platform}">
            <thead>
                <tr>
                    <th class="sortable" data-column="name">Name</th>
                    <th class="sortable" data-column="regNumber">Registration No.</th>
                    <th class="sortable" data-column="dept">Dept</th>
                    ${getTableHeaders(platform)}
                </tr>
            </thead>
            <tbody>
    `;

    profiles.forEach(profile => {
        tableHTML += `
            <tr>
                <td>${profile.name}</td>
                <td>${profile.regNumber}</td>
                <td>${profile.dept || '-'}</td>
                ${getTableCells(platform, profile.data)}
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;

    // Add sorting functionality
    addSortingEventListeners(platform, profiles);
}

// Search functionality
function handleSearch(platform, searchTerm) {
    const allProfiles = platformProfiles[platform];

    if (!allProfiles || allProfiles.length === 0) {
        return;
    }

    // If search term is empty, show all profiles
    if (!searchTerm.trim()) {
        renderPlatformTable(platform, allProfiles);
        return;
    }

    // Filter profiles based on name, registration number, or department
    const searchLower = searchTerm.toLowerCase().trim();
    const filteredProfiles = allProfiles.filter(profile => {
        const name = (profile.name || '').toLowerCase();
        const regNumber = (profile.regNumber || '').toLowerCase();
        const dept = (profile.dept || '').toLowerCase();

        return name.includes(searchLower) ||
               regNumber.includes(searchLower) ||
               dept.includes(searchLower);
    });

    // Render filtered results
    renderFilteredTable(platform, filteredProfiles);
}

function renderFilteredTable(platform, profiles) {
    const container = document.getElementById(`${platform}Table`);
    const countElement = document.getElementById(`${platform}Count`);

    // Update count to show filtered results
    countElement.textContent = profiles.length;

    if (profiles.length === 0) {
        container.innerHTML = `
            <p style="text-align: center; color: #666; padding: 40px;">No matching profiles found.</p>
        `;
        return;
    }

    let tableHTML = `
        <table class="data-table" data-platform="${platform}">
            <thead>
                <tr>
                    <th class="sortable" data-column="name">Name</th>
                    <th class="sortable" data-column="regNumber">Registration No.</th>
                    <th class="sortable" data-column="dept">Dept</th>
                    ${getTableHeaders(platform)}
                </tr>
            </thead>
            <tbody>
    `;

    profiles.forEach(profile => {
        tableHTML += `
            <tr>
                <td>${profile.name}</td>
                <td>${profile.regNumber}</td>
                <td>${profile.dept || '-'}</td>
                ${getTableCells(platform, profile.data)}
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;

    // Add sorting functionality for filtered results
    addSortingEventListeners(platform, profiles);
}

function getTableHeaders(platform) {
    switch (platform) {
        case 'leetcode':
            return '<th class="sortable" data-column="easy">Easy</th><th class="sortable" data-column="medium">Medium</th><th class="sortable" data-column="hard">Hard</th><th class="sortable" data-column="total">Total</th>';
        case 'codechef':
            return '<th class="sortable" data-column="division">Division</th><th class="sortable" data-column="provisionalRating">Rating</th><th class="sortable" data-column="globalRank">Global Rank</th><th class="sortable" data-column="countryRank">Country Rank</th><th class="sortable" data-column="totalProblemsSolved">Problems</th><th class="sortable" data-column="contestsParticipated">Contests</th>';
        case 'geeksforgeeks':
            return '<th class="sortable" data-column="school">School</th><th class="sortable" data-column="basic">Basic</th><th class="sortable" data-column="easy">Easy</th><th class="sortable" data-column="medium">Medium</th><th class="sortable" data-column="hard">Hard</th><th class="sortable" data-column="totalProblemsSolved">Total</th><th class="sortable" data-column="streak">Streak</th><th class="sortable" data-column="codingScore">Score</th><th class="sortable" data-column="contestRating">Rank</th>';
        default:
            return '';
    }
}

function getTableCells(platform, data) {
    if (data.error) {
        const colspan = platform === 'leetcode' ? 4 : platform === 'codechef' ? 6 : 9;
        return `<td colspan="${colspan}" class="error-cell">Error loading data</td>`;
    }

    switch (platform) {
        case 'leetcode':
            return `
                <td>${data.easy}</td>
                <td>${data.medium}</td>
                <td>${data.hard}</td>
                <td><strong>${data.total}</strong></td>
            `;
        case 'codechef':
            return `
                <td>${data.division}</td>
                <td>${data.provisionalRating}</td>
                <td>${data.globalRank}</td>
                <td>${data.countryRank}</td>
                <td>${data.totalProblemsSolved}</td>
                <td>${data.contestsParticipated}</td>
            `;
        case 'geeksforgeeks':
            return `
                <td>${data.school}</td>
                <td>${data.basic}</td>
                <td>${data.easy}</td>
                <td>${data.medium}</td>
                <td>${data.hard}</td>
                <td><strong>${data.totalProblemsSolved}</strong></td>
                <td>${data.streak}</td>
                <td>${data.codingScore}</td>
                <td>${data.contestRating}</td>
            `;
        default:
            return '';
    }
}


function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Sorting functionality
let currentSort = {
    platform: null,
    column: null,
    direction: 'asc' // 'asc' or 'desc'
};

function addSortingEventListeners(platform, profiles) {
    const table = document.querySelector(`.data-table[data-platform="${platform}"]`);
    const headers = table.querySelectorAll('th.sortable');

    headers.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.column;
            sortTable(platform, profiles, column);
        });
    });
}

function sortTable(platform, profiles, column) {
    // Determine sort direction
    let direction = 'asc';
    if (currentSort.platform === platform && currentSort.column === column && currentSort.direction === 'asc') {
        direction = 'desc';
    }

    // Update current sort state
    currentSort = { platform, column, direction };

    // Sort the profiles
    const sortedProfiles = [...profiles].sort((a, b) => {
        let aVal, bVal;

        // Get values based on column
        if (column === 'name') {
            aVal = a.name;
            bVal = b.name;
        } else if (column === 'regNumber') {
            aVal = a.regNumber;
            bVal = b.regNumber;
        } else if (column === 'dept') {
            aVal = a.dept || '';
            bVal = b.dept || '';
        } else {
            // Data columns
            aVal = a.data[column];
            bVal = b.data[column];
        }

        // Handle error cases
        if (a.data.error && !b.data.error) return 1;
        if (!a.data.error && b.data.error) return -1;
        if (a.data.error && b.data.error) return 0;

        // Handle special values
        if (aVal === 'N/A' || aVal === '--' || aVal === 'Error') aVal = direction === 'asc' ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
        if (bVal === 'N/A' || bVal === '--' || bVal === 'Error') bVal = direction === 'asc' ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;

        // Convert to numbers if possible
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);

        let result;
        if (!isNaN(aNum) && !isNaN(bNum)) {
            // Numeric comparison
            result = aNum - bNum;
        } else {
            // String comparison
            result = String(aVal).localeCompare(String(bVal));
        }

        return direction === 'desc' ? -result : result;
    });

    // Re-render the table
    renderSortedTable(platform, sortedProfiles, column, direction);
}

function renderSortedTable(platform, profiles, sortColumn, sortDirection) {
    const container = document.getElementById(`${platform}Table`);
    const countElement = document.getElementById(`${platform}Count`);

    // Update count in header
    countElement.textContent = profiles.length;

    let tableHTML = `
        <table class="data-table" data-platform="${platform}">
            <thead>
                <tr>
                    <th class="sortable ${sortColumn === 'name' ? `sort-${sortDirection}` : ''}" data-column="name">Name</th>
                    <th class="sortable ${sortColumn === 'regNumber' ? `sort-${sortDirection}` : ''}" data-column="regNumber">Registration No.</th>
                    <th class="sortable ${sortColumn === 'dept' ? `sort-${sortDirection}` : ''}" data-column="dept">Dept</th>
                    ${getSortableTableHeaders(platform, sortColumn, sortDirection)}
                </tr>
            </thead>
            <tbody>
    `;

    profiles.forEach(profile => {
        tableHTML += `
            <tr>
                <td>${profile.name}</td>
                <td>${profile.regNumber}</td>
                <td>${profile.dept || '-'}</td>
                ${getTableCells(platform, profile.data)}
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;

    // Re-add event listeners
    addSortingEventListeners(platform, profiles);
}

function getSortableTableHeaders(platform, sortColumn, sortDirection) {
    switch (platform) {
        case 'leetcode':
            return `
                <th class="sortable ${sortColumn === 'easy' ? `sort-${sortDirection}` : ''}" data-column="easy">Easy</th>
                <th class="sortable ${sortColumn === 'medium' ? `sort-${sortDirection}` : ''}" data-column="medium">Medium</th>
                <th class="sortable ${sortColumn === 'hard' ? `sort-${sortDirection}` : ''}" data-column="hard">Hard</th>
                <th class="sortable ${sortColumn === 'total' ? `sort-${sortDirection}` : ''}" data-column="total">Total</th>
            `;
        case 'codechef':
            return `
                <th class="sortable ${sortColumn === 'division' ? `sort-${sortDirection}` : ''}" data-column="division">Division</th>
                <th class="sortable ${sortColumn === 'provisionalRating' ? `sort-${sortDirection}` : ''}" data-column="provisionalRating">Rating</th>
                <th class="sortable ${sortColumn === 'globalRank' ? `sort-${sortDirection}` : ''}" data-column="globalRank">Global Rank</th>
                <th class="sortable ${sortColumn === 'countryRank' ? `sort-${sortDirection}` : ''}" data-column="countryRank">Country Rank</th>
                <th class="sortable ${sortColumn === 'totalProblemsSolved' ? `sort-${sortDirection}` : ''}" data-column="totalProblemsSolved">Problems</th>
                <th class="sortable ${sortColumn === 'contestsParticipated' ? `sort-${sortDirection}` : ''}" data-column="contestsParticipated">Contests</th>
            `;
        case 'geeksforgeeks':
            return `
                <th class="sortable ${sortColumn === 'school' ? `sort-${sortDirection}` : ''}" data-column="school">School</th>
                <th class="sortable ${sortColumn === 'basic' ? `sort-${sortDirection}` : ''}" data-column="basic">Basic</th>
                <th class="sortable ${sortColumn === 'easy' ? `sort-${sortDirection}` : ''}" data-column="easy">Easy</th>
                <th class="sortable ${sortColumn === 'medium' ? `sort-${sortDirection}` : ''}" data-column="medium">Medium</th>
                <th class="sortable ${sortColumn === 'hard' ? `sort-${sortDirection}` : ''}" data-column="hard">Hard</th>
                <th class="sortable ${sortColumn === 'totalProblemsSolved' ? `sort-${sortDirection}` : ''}" data-column="totalProblemsSolved">Total</th>
                <th class="sortable ${sortColumn === 'streak' ? `sort-${sortDirection}` : ''}" data-column="streak">Streak</th>
                <th class="sortable ${sortColumn === 'codingScore' ? `sort-${sortDirection}` : ''}" data-column="codingScore">Score</th>
                <th class="sortable ${sortColumn === 'contestRating' ? `sort-${sortDirection}` : ''}" data-column="contestRating">Rank</th>
            `;
        default:
            return '';
    }
}

async function handleRemoveStudent(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const regNumber = formData.get('removeRegNumber');

    // Validate registration number
    if (!/^\d{12}$/.test(regNumber)) {
        showRemoveMessage('Registration number must be exactly 12 digits', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to remove the student with registration number ${regNumber}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/profiles/student/${regNumber}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
            // Support new multi-platform removal response shape
            if (result.removed && Array.isArray(result.removed.platforms)) {
                const plats = result.removed.platforms.join(', ');
                showRemoveMessage(`Student ${result.removed.name} (${result.removed.regNumber}) removed successfully from: ${plats}`, 'success');
            } else if (result.removedProfile) {
                // Backward compatibility with older response shape
                showRemoveMessage(`Student ${result.removedProfile.name} (${result.removedProfile.regNumber}) removed successfully from ${result.removedProfile.platform}!`, 'success');
            } else {
                showRemoveMessage('Student removed successfully', 'success');
            }
            e.target.reset();
            // Refresh all platform data
            await loadAllData();
        } else {
            showRemoveMessage(result.error || 'Failed to remove student', 'error');
        }
    } catch (error) {
        showRemoveMessage('Network error. Please try again.', 'error');
    }
}

function exportPlatformData(platform) {
    const button = document.getElementById(getButtonId('export', platform));
    const originalText = button ? button.textContent : '';
    if (button) {
        button.disabled = true;
        button.textContent = 'Exporting...';
    }

    try {
        // Create the export URL
        const exportUrl = `/api/export/${platform}`;
        console.log(`Starting export for ${platform} using URL: ${exportUrl}`);

        // Trigger download via temporary anchor
        const link = document.createElement('a');
        link.href = exportUrl;
        link.target = '_blank';
        link.download = `${platform}_profiles_${new Date().toISOString().split('T')[0]}.xlsx`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showMessage(`${capitalizeFirst(platform)} data export started!`, 'success');

        // Reset button after a short delay
        setTimeout(() => {
            if (button) {
                button.disabled = false;
                button.textContent = originalText || 'Export to Excel';
            }
        }, 2000);

    } catch (error) {
        console.error('Export error:', error);
        showMessage(`Failed to export ${platform} data: ${error.message}`, 'error');
        if (button) {
            button.disabled = false;
            button.textContent = originalText || 'Export to Excel';
        }
    }
}
