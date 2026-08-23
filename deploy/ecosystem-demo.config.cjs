/**
 * PM2 process for the isolated public demo API.
 * Does not replace advisortrack-api. Start separately:
 *   pm2 start deploy/ecosystem-demo.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'advisortrack-demo-api',
      cwd: '/home/ubuntu/advisortrack_demo_backend',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ADVISORTRACK_MODE: 'demo',
        ADVISORTRACK_ENV_FILE: '/home/ubuntu/advisortrack_demo_backend/.env.demo',
      },
      max_memory_restart: '400M',
      error_file: '/var/log/advisortrack/demo-api-error.log',
      out_file: '/var/log/advisortrack/demo-api-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
