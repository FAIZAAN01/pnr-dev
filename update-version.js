const fs = require('fs');
fs.writeFileSync('public/version.txt', Date.now().toString());
console.log("✅ Version file updated.");
