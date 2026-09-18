import { createHash } from 'node:crypto';
import {
  HierarchyRank,
  RANK_LABELS,
  invitationChannelForMember,
  rankFromRoleName,
} from './customerHierarchy';
import { LicencePool } from './licencePool';
import { inspectMemberPhone, memberPhoneDigits } from './memberPhone';

export const BULK_IMPORT_MAX_ROWS = 5000;
export const BULK_IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const BULK_IMPORT_JSON_LIMIT = '6mb';

export const BULK_IMPORT_HEADERS = [
  'first_name',
  'last_name',
  'email',
  'mobile',
  'role',
  'region',
  'team',
  'organisation_admin',
  'assign_licence',
  'send_invitation',
] as const;

export type BulkImportHeader = (typeof BULK_IMPORT_HEADERS)[number];

const PLACEHOLDERS = new Set([
  '-',
  '--',
  '—',
  'n/a',
  'na',
  'n.a.',
  'n.a',
  'none',
  'nil',
  'null',
  'unknown',
  'tbd',
  'blank',
  'not applicable',
  'not available',
  'placeholder',
  '???',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BulkImportInputRow = {
  rowNumber: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  mobile?: string;
  role?: string;
  region?: string;
  team?: string;
  organisation_admin?: string;
  assign_licence?: string;
  send_invitation?: string;
  hasFormula?: boolean;
};

export type BulkImportCatalogRole = {
  id: string;
  name: string;
  rank: HierarchyRank;
};

export type BulkImportCatalog = {
  roles: BulkImportCatalogRole[];
  regions: Array<{ id: string; name: string; isActive: boolean; managerUserId?: string | null }>;
  teams: Array<{
    id: string;
    name: string;
    regionId: string;
    regionName: string;
    isActive: boolean;
    leaderUserId?: string | null;
  }>;
  existingEmailsInCompany: Set<string>;
  existingEmailsElsewhere: Set<string>;
  existingMobilesInCompany: Set<string>;
  licencePool: LicencePool;
  actorCanGrantOrgAdmin: boolean;
};

export type ValidatedBulkImportRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  roleLabel: string;
  rank: HierarchyRank;
  roleId: string;
  regionName: string;
  teamName: string;
  regionId: string | null;
  teamId: string | null;
  organisationAdmin: boolean;
  assignLicence: boolean;
  sendInvitation: boolean;
  invitationChannel: 'mobile' | 'portal' | null;
  status: 'valid' | 'error';
  errors: string[];
};

export type BulkImportSummary = {
  totalRows: number;
  valid: number;
  errors: number;
  financialAdvisors: number;
  teamLeaders: number;
  regionalManagers: number;
  executives: number;
  organisationAdmins: number;
  licences: {
    purchased: number | null;
    assigned: number;
    available: number | null;
    requested: number;
    remaining: number | null;
    shortfall: number;
  };
  invitations: {
    mobile: number;
    portal: number;
    none: number;
  };
};

export type BulkImportPreview = {
  fingerprint: string;
  wrote: false;
  canConfirm: boolean;
  blockReasons: string[];
  summary: BulkImportSummary;
  rows: ValidatedBulkImportRow[];
};

export const trimCell = (value: unknown): string => String(value ?? '').replace(/\u00a0/g, ' ').trim();

export const isPlaceholder = (value: string): boolean => PLACEHOLDERS.has(value.trim().toLowerCase());

export const looksLikeFormula = (value: string): boolean => {
  const text = value.trim();
  if (!text || PLACEHOLDERS.has(text.toLowerCase())) return false;
  return /^[=+\-@\t\r]/.test(text);
};

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const parseYesNo = (
  raw: string,
  field: string,
  options?: { blankMeans?: boolean }
): { ok: true; value: boolean } | { ok: false; message: string } => {
  const value = trimCell(raw);
  if (!value) {
    if (options?.blankMeans === undefined) {
      return { ok: false, message: `${field} must be YES or NO` };
    }
    return { ok: true, value: options.blankMeans };
  }
  if (isPlaceholder(value)) {
    return { ok: false, message: `${field} cannot be “${value}”. Choose YES or NO.` };
  }
  const upper = value.toUpperCase();
  if (upper === 'YES') return { ok: true, value: true };
  if (upper === 'NO') return { ok: true, value: false };
  return { ok: false, message: `${field} must be YES or NO` };
};

const requiredText = (raw: string, label: string, max = 100): string | null => {
  const value = trimCell(raw);
  if (!value) return `${label} is required`;
  if (looksLikeFormula(value)) return `${label} cannot contain a spreadsheet formula`;
  if (isPlaceholder(value)) return `${label} cannot be “${value}”`;
  if (value.length > max) return `${label} must be ${max} characters or fewer`;
  return null;
};

export const fingerprintBulkImportRows = (rows: BulkImportInputRow[]): string => {
  const canonical = rows.map((row) => ({
    rowNumber: row.rowNumber,
    first_name: trimCell(row.first_name),
    last_name: trimCell(row.last_name),
    email: normalizeEmail(trimCell(row.email)),
    mobile: trimCell(row.mobile),
    role: trimCell(row.role),
    region: trimCell(row.region),
    team: trimCell(row.team),
    organisation_admin: trimCell(row.organisation_admin).toUpperCase(),
    assign_licence: trimCell(row.assign_licence).toUpperCase(),
    send_invitation: trimCell(row.send_invitation).toUpperCase(),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const emptyValidated = (rowNumber: number, partial: Partial<ValidatedBulkImportRow>, errors: string[]): ValidatedBulkImportRow => ({
  rowNumber,
  firstName: partial.firstName ?? '',
  lastName: partial.lastName ?? '',
  email: partial.email ?? '',
  mobile: partial.mobile ?? '',
  roleLabel: partial.roleLabel ?? '',
  rank: partial.rank ?? 'financial_advisor',
  roleId: partial.roleId ?? '',
  regionName: partial.regionName ?? '',
  teamName: partial.teamName ?? '',
  regionId: partial.regionId ?? null,
  teamId: partial.teamId ?? null,
  organisationAdmin: partial.organisationAdmin ?? false,
  assignLicence: partial.assignLicence ?? false,
  sendInvitation: partial.sendInvitation ?? false,
  invitationChannel: partial.invitationChannel ?? null,
  status: errors.length ? 'error' : 'valid',
  errors,
});

function matchName<T extends { name: string; isActive: boolean }>(items: T[], raw: string): T[] {
  const key = trimCell(raw).toLowerCase();
  return items.filter((item) => item.name.trim().toLowerCase() === key);
}

export function validateBulkImportRows(
  inputRows: BulkImportInputRow[],
  catalog: BulkImportCatalog
): BulkImportPreview {
  const rows = inputRows.slice(0, BULK_IMPORT_MAX_ROWS + 1);
  const fingerprint = fingerprintBulkImportRows(inputRows);
  const validated: ValidatedBulkImportRow[] = [];
  const emailFirstRow = new Map<string, number>();
  const mobileFirstRow = new Map<string, number>();
  const rowSignatureFirst = new Map<string, number>();

  for (const input of rows) {
    const errors: string[] = [];
    const firstName = trimCell(input.first_name);
    const lastName = trimCell(input.last_name);
    const emailRaw = trimCell(input.email);
    const mobileRaw = trimCell(input.mobile);
    const roleRaw = trimCell(input.role);
    const regionRaw = trimCell(input.region);
    const teamRaw = trimCell(input.team);

    if (input.hasFormula) {
      errors.push('Formula cells are not accepted');
    }

    const firstNameError = requiredText(firstName, 'First name');
    if (firstNameError) errors.push(firstNameError);
    const lastNameError = requiredText(lastName, 'Last name');
    if (lastNameError) errors.push(lastNameError);

    let email = '';
    if (!emailRaw) {
      errors.push('Email is required');
    } else if (looksLikeFormula(emailRaw)) {
      errors.push('Email cannot contain a spreadsheet formula');
    } else if (isPlaceholder(emailRaw)) {
      errors.push(`Email cannot be “${emailRaw}”`);
    } else if (!EMAIL_PATTERN.test(emailRaw)) {
      errors.push('Enter a valid email address');
    } else {
      email = normalizeEmail(emailRaw);
    }

    const phone = inspectMemberPhone(mobileRaw, { required: true });
    if (!phone.ok) {
      if (isPlaceholder(mobileRaw)) errors.push(`Mobile cannot be “${mobileRaw}”`);
      else if (looksLikeFormula(mobileRaw)) errors.push('Mobile cannot contain a spreadsheet formula');
      else errors.push(phone.message);
    }

    if (roleRaw && looksLikeFormula(roleRaw)) {
      errors.push('Role cannot contain a spreadsheet formula');
    } else if (roleRaw && isPlaceholder(roleRaw)) {
      errors.push(`Role cannot be “${roleRaw}”`);
    } else if (roleRaw && /organisation administrator|organization administrator/i.test(roleRaw)) {
      errors.push(
        'Organisation Administrator is not a reporting role. Choose Financial Advisor, Team Leader, Regional Manager, or Executive, and set Organisation Administrator to YES.'
      );
    }

    const rank = rankFromRoleName(roleRaw);
    const role = rank ? catalog.roles.find((item) => item.rank === rank) : undefined;
    if (!roleRaw) {
      errors.push('Role is required');
    } else if (!rank || rank === 'platform_admin') {
      if (!errors.some((message) => message.startsWith('Role cannot') || message.startsWith('Organisation Administrator'))) {
        errors.push(`Invalid role: ${roleRaw}`);
      }
    } else if (!role) {
      errors.push(`You cannot assign the role ${RANK_LABELS[rank]}`);
    }

    const orgAdminParsed = parseYesNo(input.organisation_admin ?? '', 'Organisation Administrator', {
      blankMeans: false,
    });
    if (!orgAdminParsed.ok) errors.push(orgAdminParsed.message);
    const organisationAdmin = orgAdminParsed.ok ? orgAdminParsed.value : false;
    if (organisationAdmin && !catalog.actorCanGrantOrgAdmin) {
      errors.push('You cannot grant Organisation Administrator');
    }

    const licenceParsed = parseYesNo(input.assign_licence ?? '', 'Assign Licence', { blankMeans: false });
    if (!licenceParsed.ok) errors.push(licenceParsed.message);
    const assignLicence = licenceParsed.ok ? licenceParsed.value : false;

    const inviteParsed = parseYesNo(input.send_invitation ?? '', 'Send Invitation', { blankMeans: true });
    if (!inviteParsed.ok) errors.push(inviteParsed.message);
    const sendInvitation = inviteParsed.ok ? inviteParsed.value : false;

    if (regionRaw && looksLikeFormula(regionRaw)) errors.push('Region cannot contain a spreadsheet formula');
    else if (regionRaw && isPlaceholder(regionRaw)) errors.push(`Region cannot be “${regionRaw}”`);

    if (teamRaw && looksLikeFormula(teamRaw)) errors.push('Team cannot contain a spreadsheet formula');
    else if (teamRaw && isPlaceholder(teamRaw)) errors.push(`Team cannot be “${teamRaw}”`);

    let regionId: string | null = null;
    let teamId: string | null = null;
    let regionName = regionRaw;
    let teamName = teamRaw;

    const regionMatches = regionRaw && !isPlaceholder(regionRaw) && !looksLikeFormula(regionRaw) ? matchName(catalog.regions, regionRaw) : [];
    if (regionRaw && !isPlaceholder(regionRaw) && !looksLikeFormula(regionRaw)) {
      if (regionMatches.length === 0) {
        errors.push(`Unknown Region: ${regionRaw}`);
      } else if (!regionMatches.some((item) => item.isActive)) {
        errors.push(`Region is archived: ${regionRaw}`);
      } else {
        regionId = regionMatches.find((item) => item.isActive)?.id ?? null;
        regionName = regionMatches.find((item) => item.isActive)?.name ?? regionRaw;
      }
    }

    const teamMatches =
      teamRaw && !isPlaceholder(teamRaw) && !looksLikeFormula(teamRaw) ? matchName(catalog.teams, teamRaw) : [];
    if (teamRaw && !isPlaceholder(teamRaw) && !looksLikeFormula(teamRaw)) {
      const activeTeams = teamMatches.filter((item) => item.isActive);
      const scopedTeams = regionId ? activeTeams.filter((item) => item.regionId === regionId) : activeTeams;
      if (teamMatches.length === 0) {
        errors.push(`Unknown Team: ${teamRaw}`);
      } else if (activeTeams.length === 0) {
        errors.push(`Team is archived: ${teamRaw}`);
      } else if (!regionId && scopedTeams.length > 1) {
        errors.push('Team is ambiguous; choose the matching Region');
      } else if (regionId && scopedTeams.length === 0) {
        errors.push('Region does not match selected Team');
      } else {
        const team = scopedTeams[0];
        teamId = team.id;
        teamName = team.name;
        if (regionId && team.regionId !== regionId) {
          errors.push('Region does not match selected Team');
        } else if (!regionId) {
          regionId = team.regionId;
          regionName = team.regionName;
        }
      }
    }

    if (rank === 'financial_advisor' || rank === 'team_leader') {
      if (!teamId) errors.push(`${RANK_LABELS[rank]} requires a Team`);
    }
    if (rank === 'financial_advisor' && teamId) {
      const team = catalog.teams.find((item) => item.id === teamId);
      if (team && !team.leaderUserId) {
        errors.push('Assign a Team Leader to this team before adding advisors');
      }
    }
    if (rank === 'team_leader' && (regionId || teamId)) {
      const region = catalog.regions.find((item) => item.id === (regionId || catalog.teams.find((item) => item.id === teamId)?.regionId));
      if (region && !region.managerUserId) {
        errors.push('Assign a Regional Manager to this region before assigning a Team Leader');
      }
    }
    if (rank === 'regional_manager') {
      if (!regionId) errors.push('Region is required for Regional Manager');
      if (teamRaw) errors.push('Regional Manager must not have a Team');
    }
    if (rank === 'executive') {
      if (regionRaw) errors.push('Executive must not have a Region');
      if (teamRaw) errors.push('Executive must not have a Team');
    }

    if (email) {
      const first = emailFirstRow.get(email);
      if (first) errors.push(`Duplicate email in this workbook (also row ${first})`);
      else emailFirstRow.set(email, input.rowNumber);
      if (catalog.existingEmailsInCompany.has(email)) errors.push('Email already exists');
      else if (catalog.existingEmailsElsewhere.has(email)) {
        errors.push('Email already exists in another company');
      }
    }

    const mobileKey = phone.ok && phone.value ? memberPhoneDigits(phone.value) : '';
    if (mobileKey) {
      const first = mobileFirstRow.get(mobileKey);
      if (first) errors.push(`Duplicate mobile in this workbook (also row ${first})`);
      else mobileFirstRow.set(mobileKey, input.rowNumber);
      if (catalog.existingMobilesInCompany.has(mobileKey)) {
        errors.push('Mobile already exists');
      }
    }

    const signature = [
      firstName.toLowerCase(),
      lastName.toLowerCase(),
      email,
      mobileKey,
      roleRaw.toLowerCase(),
      regionRaw.toLowerCase(),
      teamRaw.toLowerCase(),
    ].join('|');
    const firstSig = rowSignatureFirst.get(signature);
    if (firstSig) errors.push(`Duplicate row (also row ${firstSig})`);
    else rowSignatureFirst.set(signature, input.rowNumber);

    const invitationChannel =
      rank && rank !== 'platform_admin'
        ? sendInvitation
          ? invitationChannelForMember(rank, organisationAdmin)
          : null
        : null;

    validated.push(
      emptyValidated(
        input.rowNumber,
        {
          firstName,
          lastName,
          email,
          mobile: phone.ok && phone.value ? phone.value : mobileRaw,
          roleLabel: rank && rank !== 'platform_admin' ? RANK_LABELS[rank] : roleRaw,
          rank: rank ?? 'financial_advisor',
          roleId: role?.id ?? '',
          regionName,
          teamName,
          regionId,
          teamId,
          organisationAdmin,
          assignLicence,
          sendInvitation,
          invitationChannel,
        },
        [...new Set(errors)]
      )
    );
  }

  const validRows = validated.filter((row) => row.status === 'valid');
  const requested = validRows.filter((row) => row.assignLicence).length;
  const available = catalog.licencePool.available;
  const remaining = available == null ? null : available - requested;
  const shortfall = remaining != null && remaining < 0 ? -remaining : 0;

  const summary: BulkImportSummary = {
    totalRows: validated.length,
    valid: validRows.length,
    errors: validated.length - validRows.length,
    financialAdvisors: validRows.filter((row) => row.rank === 'financial_advisor').length,
    teamLeaders: validRows.filter((row) => row.rank === 'team_leader').length,
    regionalManagers: validRows.filter((row) => row.rank === 'regional_manager').length,
    executives: validRows.filter((row) => row.rank === 'executive').length,
    organisationAdmins: validRows.filter((row) => row.organisationAdmin).length,
    licences: {
      purchased: catalog.licencePool.purchased,
      assigned: catalog.licencePool.assigned,
      available,
      requested,
      remaining: remaining == null ? null : Math.max(0, remaining),
      shortfall,
    },
    invitations: {
      mobile: validRows.filter((row) => row.invitationChannel === 'mobile').length,
      portal: validRows.filter((row) => row.invitationChannel === 'portal').length,
      none: validRows.filter((row) => !row.sendInvitation).length,
    },
  };

  const blockReasons: string[] = [];
  if (validated.length === 0) blockReasons.push('There are no users to import.');
  if (summary.errors > 0) {
    blockReasons.push(`${summary.errors} row${summary.errors === 1 ? '' : 's'} failed validation.`);
  }
  if (shortfall > 0) {
    blockReasons.push(
      `Licences available: ${available ?? 0}. Licences requested: ${requested}. Shortfall: ${shortfall}.`
    );
  }
  if (inputRows.length > BULK_IMPORT_MAX_ROWS) {
    blockReasons.push(`The file has more than ${BULK_IMPORT_MAX_ROWS.toLocaleString('en-ZA')} users.`);
  }

  return {
    fingerprint,
    wrote: false,
    canConfirm: blockReasons.length === 0,
    blockReasons,
    summary,
    rows: validated,
  };
}
