const fs = require('fs');
const lines = fs.readFileSync('onix_db_backup.sql', 'utf8').split('\n');
const cleanLines = lines.filter(line => {
    const trimmed = line.trim();
    // Remove MySQL comments and headers
    if (trimmed.startsWith('/*!') || trimmed.startsWith('--') || trimmed === '') {
        // Keep INSERT INTO lines even if they have weird formatting
        if (trimmed.includes('INSERT INTO')) return true;
        return false;
    }
    return true;
});

fs.writeFileSync('onix_db_backup.sql', cleanLines.join('\n'));
console.log('✅ SQL file cleaned from problematic headers!');
