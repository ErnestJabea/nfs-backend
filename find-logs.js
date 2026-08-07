const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'debug_logs.txt');
const lines = fs.readFileSync(logFile, 'utf8').split('\n');

console.log("Searching logs for 'users' or 'GET USER BY ID' or 'getUserById'...");
const matches = lines.filter(line => 
  line.includes('users') || 
  line.includes('USER BY ID') || 
  line.includes('user') ||
  line.includes('profile') ||
  line.includes('PROFILE')
);

console.log(`Found ${matches.length} matches. Last 30 matches:`);
matches.slice(-30).forEach(m => console.log(m));
