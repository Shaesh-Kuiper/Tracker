const XLSX = require('xlsx');
const path = require('path');

const excelPath = path.join(__dirname, '..', 'All links - 2027.xlsx');
const workbook = XLSX.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

console.log('=== Excel File Structure ===');
console.log('Sheet name:', sheetName);
console.log('\nHeaders:', rows[0]);
console.log('\nTotal rows:', rows.length);
console.log('\nFirst 5 data rows:');
for (let i = 1; i <= Math.min(5, rows.length - 1); i++) {
    console.log(`\nRow ${i}:`, rows[i]);
}
