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

    // Refresh buttons
    document.getElementById('refreshLeetCode').addEventListener('click', () => refreshPlatformData('leetcode'));
    document.getElementById('refreshCodeChef').addEventListener('click', () => refreshPlatformData('codechef'));
    document.getElementById('refreshGeeksforGeeks').addEventListener('click', () => refreshPlatformData('geeksforgeeks'));

    // Load initial data
    loadAllData();
});

async function handleFormSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const profileData = {
        name: formData.get('name'),
        regNumber: formData.get('regNumber'),
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

async function loadAllData() {
    await loadPlatformData('leetcode');
    await loadPlatformData('codechef');
    await loadPlatformData('geeksforgeeks');
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
    const button = document.getElementById(`refresh${capitalizeFirst(platform)}`);
    button.disabled = true;
    button.textContent = 'Refreshing...';

    try {
        const response = await fetch(`/api/profiles/${platform}/refresh`, {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok) {
            renderPlatformTable(platform, data);
            showMessage('Data refreshed successfully!', 'success');
        } else {
            showMessage(`Failed to refresh ${platform} data: ${data.error}`, 'error');
        }
    } catch (error) {
        showMessage('Network error during refresh', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Refresh Data';
    }
}

function renderPlatformTable(platform, profiles) {
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
                ${getTableCells(platform, profile.data)}
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;

    // Add sorting functionality
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