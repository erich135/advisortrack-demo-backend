/**
 * Task 10 demo backend: isolated bulk import validation / preview / confirm.
 * Run: npm run test:bulk-user-import
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BULK_IMPORT_MAX_ROWS,
  type BulkImportCatalog,
  type BulkImportInputRow,
  validateBulkImportRows,
} from '../src/features/bulkUserImport';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${message}`);
}

function catalog(overrides?: Partial<BulkImportCatalog>): BulkImportCatalog {
  return {
    roles: [
      { id: 'role-fa', name: 'Financial Advisor', rank: 'financial_advisor' },
      { id: 'role-tl', name: 'Team Leader', rank: 'team_leader' },
      { id: 'role-rm', name: 'Regional Manager', rank: 'regional_manager' },
      { id: 'role-ex', name: 'Executive', rank: 'executive' },
    ],
    regions: [{ id: 'reg-gauteng', name: 'Gauteng', isActive: true, managerUserId: 'rm-1' }],
    teams: [
      {
        id: 'team-sandton',
        name: 'Sandton A',
        regionId: 'reg-gauteng',
        regionName: 'Gauteng',
        isActive: true,
        leaderUserId: 'tl-1',
      },
    ],
    existingEmailsInCompany: new Set(),
    existingEmailsElsewhere: new Set(),
    existingMobilesInCompany: new Set(),
    licencePool: { purchased: 125, assigned: 0, available: 125 },
    actorCanGrantOrgAdmin: true,
    ...overrides,
  };
}

function row(partial: Partial<BulkImportInputRow> & { rowNumber: number }): BulkImportInputRow {
  return {
    first_name: 'John',
    last_name: 'Smith',
    email: `user${partial.rowNumber}@example.com`,
    mobile: `08212345${String(partial.rowNumber).padStart(2, '0')}`.slice(0, 10),
    role: 'Financial Advisor',
    region: 'Gauteng',
    team: 'Sandton A',
    organisation_admin: 'NO',
    assign_licence: 'NO',
    send_invitation: 'YES',
    ...partial,
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isolationFiles = [
  'src/services/bulkUserImport.service.ts',
  'src/features/bulkUserImport.ts',
  'src/app.ts',
  'AGENTS.md',
].map((relative) => fs.readFileSync(path.join(root, relative), 'utf8'));

for (const contents of isolationFiles) {
  assert(!/advisor_track(?!_backend|_local)/.test(contents) || contents.includes('advisortrack_demo'), 'Isolation text present');
}
assert(
  !isolationFiles.some((contents) => contents.includes('https://api.advisortrack.co.za')),
  'Demo bulk import must not call production API'
);
assert(
  isolationFiles.every((contents) => !contents.includes('advisortrack-api') || contents.includes('demo')),
  'Demo bulk import does not target production PM2'
);

const one = validateBulkImportRows([row({ rowNumber: 7 })], catalog());
assert(one.wrote === false, 'Preview never writes');
assert(one.canConfirm, 'Valid 1-row import can confirm');
assert(one.summary.invitations.mobile === 1, 'FA invitation is mobile');

const mixed = validateBulkImportRows(
  [
    row({ rowNumber: 7 }),
    row({ rowNumber: 8, first_name: 'Leah', email: 'tl@example.com', mobile: '0831234567', role: 'Team Leader' }),
    row({
      rowNumber: 9,
      first_name: 'Rita',
      email: 'rm@example.com',
      mobile: '0841234567',
      role: 'Regional Manager',
      team: '',
    }),
    row({
      rowNumber: 10,
      first_name: 'Eve',
      email: 'ex@example.com',
      mobile: '0851234567',
      role: 'Executive',
      region: '',
      team: '',
      organisation_admin: 'YES',
    }),
  ],
  catalog()
);
assert(mixed.canConfirm, 'Valid mixed-role workbook can confirm');
assert(mixed.summary.organisationAdmins === 1, 'Org Admin overlay counted');
assert(mixed.summary.invitations.portal === 3, 'Leadership invitations are portal');

const fiveThousand = validateBulkImportRows(
  Array.from({ length: 5000 }, (_, index) =>
    row({
      rowNumber: 7 + index,
      email: `user${index}@example.com`,
      mobile: `08${String(10000000 + index).slice(0, 8)}`,
      send_invitation: 'NO',
    })
  ),
  catalog()
);
assert(fiveThousand.summary.totalRows === BULK_IMPORT_MAX_ROWS, '5,000-row workbook is accepted');

assert(
  validateBulkImportRows([row({ rowNumber: 7, email: 'dup@example.com' }), row({ rowNumber: 8, email: 'dup@example.com', mobile: '0829999999' })], catalog())
    .rows[1].errors.some((message) => message.includes('Duplicate email')),
  'Duplicate email is reported'
);
assert(
  validateBulkImportRows([row({ rowNumber: 7, role: 'Wizard' })], catalog()).rows[0].errors.includes('Invalid role: Wizard'),
  'Invalid role is reported'
);
assert(
  validateBulkImportRows([row({ rowNumber: 7, team: 'N/A' })], catalog()).rows[0].errors.some((message) =>
    message.includes('N/A')
  ),
  'Placeholder N/A is rejected'
);
assert(
  validateBulkImportRows([row({ rowNumber: 18, team: 'Sandtn A' })], catalog()).rows[0].errors.includes(
    'Unknown Team: Sandtn A'
  ),
  'Unknown Team is reported'
);
assert(
  validateBulkImportRows([row({ rowNumber: 42, team: '' })], catalog()).rows[0].errors.includes(
    'Financial Advisor requires a Team'
  ),
  'FA without Team is reported'
);
assert(
  !validateBulkImportRows(
    [row({ rowNumber: 7, assign_licence: 'YES' }), row({ rowNumber: 8, assign_licence: 'YES', email: 'b@example.com', mobile: '0821111112' })],
    catalog({ licencePool: { purchased: 1, assigned: 0, available: 1 } })
  ).canConfirm,
  'Insufficient licences block confirmation'
);

const service = fs.readFileSync(path.join(root, 'src/services/bulkUserImport.service.ts'), 'utf8');
assert(service.includes('createMyMember'), 'Confirm reuses createMyMember');
assert(service.includes('wrote: false'), 'Preview reports wrote=false');
const org = fs.readFileSync(path.join(root, 'src/services/organisation.service.ts'), 'utf8');
assert(org.includes('demoOutboxService'), 'Demo invitations stay simulated');
assert(org.includes("isActive: false"), 'Failed creates deactivate rather than delete');
assert(!org.includes('DELETE FROM users'), 'createMyMember does not hard-delete');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
