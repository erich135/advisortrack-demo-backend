#!/usr/bin/env node
/**
 * Starts the local public-demo API from .env.demo on 127.0.0.1:3001.
 * Does not load the live .env and does not change `npm run dev`.
 */
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
process.env.ADVISORTRACK_ENV_FILE = path.join(root, '.env.demo');

const tsxCli = require.resolve('tsx/cli');
const child = spawn(process.execPath, [tsxCli, 'watch', 'src/index.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
