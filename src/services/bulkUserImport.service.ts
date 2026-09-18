import { AppError } from '../middleware/errorHandler';
import {
  BulkImportInputRow,
  BulkImportPreview,
  fingerprintBulkImportRows,
  validateBulkImportRows,
} from '../features/bulkUserImport';
import { memberPhoneDigits } from '../features/memberPhone';
import { toLicencePool } from '../features/licencePool';
import { bulkUserImportRepository } from '../repositories/bulkUserImport.repository';
import { organisationRepository } from '../repositories/organisation.repository';
import { organisationService } from './organisation.service';

function toPublicPreview(preview: BulkImportPreview) {
  return {
    fingerprint: preview.fingerprint,
    wrote: false as const,
    canConfirm: preview.canConfirm,
    blockReasons: preview.blockReasons,
    summary: preview.summary,
    rows: preview.rows.map((row) => ({
      rowNumber: row.rowNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      name: `${row.firstName} ${row.lastName}`.trim(),
      email: row.email,
      role: row.roleLabel,
      region: row.regionName,
      team: row.teamName,
      licence: row.assignLicence ? 'YES' : 'NO',
      invite: row.sendInvitation ? 'YES' : 'NO',
      organisationAdmin: row.organisationAdmin ? 'YES' : 'NO',
      invitationChannel: row.invitationChannel,
      status: row.status,
      errors: row.errors,
    })),
  };
}

async function buildCatalog(userId: string, companyId: string | undefined, emails: string[]) {
  await organisationService.assertPermission(userId, 'manage_members');
  const ctx = await organisationService.memberContextFor(userId, companyId);
  if (companyId && companyId !== ctx.scope.company.id) {
    throw new AppError(403, 'You cannot import users into another company', 'FORBIDDEN');
  }

  const [roles, assigned, owners] = await Promise.all([
    organisationService.listAssignableRoles(userId, companyId),
    organisationRepository.countLicensedSeats(ctx.scope.company.id),
    bulkUserImportRepository.findEmailOwners(emails),
  ]);

  const companyMemberIds = new Set(ctx.companyMembers.map((member) => member.id));
  const existingEmailsInCompany = new Set<string>();
  const existingEmailsElsewhere = new Set<string>();
  for (const owner of owners) {
    if (companyMemberIds.has(owner.id) || owner.companyId === ctx.scope.company.id) {
      existingEmailsInCompany.add(owner.email);
    } else {
      existingEmailsElsewhere.add(owner.email);
    }
  }
  for (const member of ctx.companyMembers) {
    existingEmailsInCompany.add(member.email.toLowerCase());
  }

  const existingMobilesInCompany = new Set(
    ctx.companyMembers
      .map((member) => memberPhoneDigits(member.phone))
      .filter((digits) => digits.length >= 8)
  );

  return {
    ctx,
    catalog: {
      roles: roles.map((role) => ({ id: role.id, name: role.name, rank: role.rank })),
      regions: ctx.regions.map((region) => ({
        id: region.id,
        name: region.name,
        isActive: region.is_active,
        managerUserId: region.manager_user_id,
      })),
      teams: ctx.teams.map((team) => ({
        id: team.id,
        name: team.name,
        regionId: team.region_id,
        regionName: team.region_name,
        isActive: team.is_active,
        leaderUserId: team.leader_user_id,
      })),
      existingEmailsInCompany,
      existingEmailsElsewhere,
      existingMobilesInCompany,
      licencePool: toLicencePool(ctx.scope.company.seatLimit, assigned),
      actorCanGrantOrgAdmin: true,
    },
  };
}

export const bulkUserImportService = {
  async preview(
    userId: string,
    input: { rows: BulkImportInputRow[]; fileName?: string | null; companyId?: string }
  ) {
    const emails = input.rows.map((row) => String(row.email ?? '').trim().toLowerCase()).filter(Boolean);
    const { catalog } = await buildCatalog(userId, input.companyId, emails);
    const preview = validateBulkImportRows(input.rows, catalog);
    return toPublicPreview(preview);
  },

  async confirm(
    userId: string,
    input: {
      rows: BulkImportInputRow[];
      fingerprint: string;
      fileName?: string | null;
      companyId?: string;
    }
  ) {
    const emails = input.rows.map((row) => String(row.email ?? '').trim().toLowerCase()).filter(Boolean);
    const { catalog } = await buildCatalog(userId, input.companyId, emails);
    const preview = validateBulkImportRows(input.rows, catalog);
    const expected = fingerprintBulkImportRows(input.rows);
    if (input.fingerprint !== expected || input.fingerprint !== preview.fingerprint) {
      throw new AppError(409, 'Preview is out of date. Upload and review again before confirming.', 'PREVIEW_STALE');
    }
    if (!preview.canConfirm) {
      throw new AppError(
        400,
        preview.blockReasons[0] || 'This import cannot be confirmed until every row is valid.',
        'IMPORT_NOT_CONFIRMABLE',
        { preview: toPublicPreview(preview) }
      );
    }

    const results: Array<{
      rowNumber: number;
      email: string;
      status: 'imported' | 'failed';
      error: string | null;
    }> = [];

    for (const row of preview.rows) {
      try {
        await organisationService.createMyMember(
          userId,
          {
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone: row.mobile,
            roleId: row.roleId,
            regionId: row.regionId,
            teamId: row.teamId,
            organisationAdmin: row.organisationAdmin,
            assignLicence: row.assignLicence,
            sendInvitation: row.sendInvitation,
          },
          { companyId: input.companyId, phoneRequired: true }
        );
        results.push({ rowNumber: row.rowNumber, email: row.email, status: 'imported', error: null });
      } catch (error) {
        results.push({
          rowNumber: row.rowNumber,
          email: row.email,
          status: 'failed',
          error: error instanceof AppError ? error.message : 'Unable to import this row',
        });
      }
    }

    const createdCount = results.filter((row) => row.status === 'imported').length;
    const failedCount = results.filter((row) => row.status === 'failed').length;
    const status =
      failedCount === 0 ? 'completed' : createdCount === 0 ? 'failed' : 'completed_with_row_failures';

    return {
      importId: null,
      wrote: true as const,
      status,
      createdCount,
      failedCount,
      summary: preview.summary,
      rows: results,
    };
  },
};
