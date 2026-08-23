#!/usr/bin/env node
/**
 * Prints a bcrypt hash for the demo password — use in SQL seed scripts.
 * Usage: npm run db:hash-password
 */
const bcrypt = require('bcryptjs');

const password = process.argv[2] || 'password';

bcrypt.hash(password, 10).then((hash) => {
  console.log('\nBcrypt hash (paste into SQL):\n');
  console.log(hash);
  console.log('\nExample UPDATE:');
  console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'john.mitchell@advisortrack.com';\n`);
});
