#!/usr/bin/env node
/**
 * Generates a base64-encoded 32-byte key for PII_ENCRYPTION_KEY (AES-256-GCM).
 * Usage: node scripts/generate-pii-key.js
 */
const crypto = require('crypto');

const key = crypto.randomBytes(32).toString('base64');
console.log('Add this to your .env file:\n');
console.log(`PII_ENCRYPTION_KEY=${key}`);
console.log('\nKeep this secret — loss of the key means encrypted contact data cannot be recovered.');
