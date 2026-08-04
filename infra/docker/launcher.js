const fs = require('node:fs');
const path = require('node:path');
const app = process.env.APP;
if (!app || !/^[a-z-]+$/.test(app)) {
  console.error('APP env var is required and must name a service (e.g. APP=catalog)');
  process.exit(1);
}
const entry = path.join('/app/dist/apps', app, 'main.js');
if (!fs.existsSync(entry)) {
  console.error(`Unknown service APP=${app} — no bundle at ${entry}`);
  process.exit(1);
}
require(entry);
