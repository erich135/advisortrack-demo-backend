#!/usr/bin/env node
require('./load-dotenv');
const { spawnSync } = require('child_process');
const path = require('path');

const result = spawnSync('npx', ['tsx', 'scripts/seed-northstar-master.ts'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
process.exit(result.status === null ? 1 : result.status);
