/**
 * A8.3 Maya Contacts demo checks.
 * Run: npm run test:a83-maya-contacts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

assert.equal(fs.existsSync(path.join(root, 'database/local')), false);
assert.doesNotMatch(read('src/features/demoNorthstar.ts'), /advisor_track(?!_demo)/);
assert.match(read('src/repositories/demoWorkspaceClone.ts'), /'contacts'/);
assert.match(read('src/repositories/demoWorkspaceClone.ts'), /UPDATE contacts/);
assert.match(read('scripts/seed-northstar-master.ts'), /contacts/);
assert.match(read('src/assistant/model/compose.ts'), /adding or editing a contact/);
assert.match(read('src/assistant/routes.ts'), /advisor-contact-detail/);
assert.match(read('src/assistant/conversation.ts'), /live preview/);
assert.doesNotMatch(read('src/assistant/live/registry.ts'), /MY_CONTACT|MY_CONTACTS/);

console.log('A8.3 Maya contacts demo checks passed');
