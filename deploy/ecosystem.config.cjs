/**
 * PM2 process config — run from repo root:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'advisortrack-api',
      cwd: __dirname + '/..',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      error_file: '/var/log/advisortrack/api-error.log',
      out_file: '/var/log/advisortrack/api-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
