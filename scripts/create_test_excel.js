const XLSX = require('xlsx');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'All links - 2027.xlsx');
const destPath = path.join(__dirname, '..', 'Test_5_Profiles.xlsx');

// Read the source Excel file
const workbook = XLSX.readFile(sourcePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

// Get header row and first 5 data rows
const headerRow = rows[0];
const first5Rows = rows.slice(1, 6); // rows 1-5 (indices 1-5)

// Create new data array
const newData = [headerRow, ...first5Rows];

// Create a new workbook
const newWorkbook = XLSX.utils.book_new();
const newSheet = XLSX.utils.aoa_to_sheet(newData);

// Add the sheet to workbook
XLSX.utils.book_append_sheet(newWorkbook, newSheet, 'Test Profiles');

// Write the file
XLSX.writeFile(newWorkbook, destPath);

console.log('Test Excel file created successfully!');
console.log(`Location: ${destPath}`);
console.log(`Headers: ${headerRow.join(' | ')}`);
console.log(`\nFirst 5 profiles:`);
first5Rows.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row[2]} - ${row[1]}`); // Name and Reg Number
});
