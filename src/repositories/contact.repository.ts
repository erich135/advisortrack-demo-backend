import { getPool } from '../config/database';
import { env } from '../config/env';
import { Contact } from '../types';
import { CreateContactInput } from '../validators/schemas';
import {
  buildContactFingerprint,
  decryptField,
  encryptField,
  hashPii,
  isPiiEncryptionEnabled,
} from '../utils/piiCrypto';

interface ContactRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
  priority: string;
  rating: string;
  notes: string | null;
  email_encrypted: string | null;
  phone_encrypted: string | null;
  notes_encrypted: string | null;
  last_contacted_at: Date | null;
  created_at: Date;
  consent_recorded_at: Date | null;
  import_source: string | null;
  popia_notice_version: string | null;
  is_practice: boolean;
  activation_status: string;
}

export interface ContactImportOptions {
  importSource: 'manual' | 'device_import';
  consentAccepted: boolean;
  popiaNoticeVersion?: string;
  isPractice?: boolean;
}

export interface ContactImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  total: number;
}

const CONTACT_LIST_COLUMNS = `
  id,
  user_id,
  first_name,
  last_name,
  email,
  phone,
  company,
  status,
  priority,
  rating,
  notes,
  email_encrypted,
  phone_encrypted,
  notes_encrypted,
  last_contacted_at,
  created_at,
  consent_recorded_at,
  import_source,
  popia_notice_version,
  is_practice,
  activation_status
`;

/**
 * Resolves plaintext PII from encrypted columns or legacy plaintext columns.
 */
const resolvePii = (
  plaintext: string | null,
  encrypted: string | null
): string => {
  if (encrypted) {
    return decryptField(encrypted);
  }
  return plaintext?.trim() ?? '';
};

/**
 * Maps a PostgreSQL contacts row to the public API Contact DTO.
 */
const mapContactRow = (row: ContactRow): Contact => ({
  id: row.id,
  userId: row.user_id,
  firstName: row.first_name,
  lastName: row.last_name ?? '',
  email: resolvePii(row.email, row.email_encrypted),
  phone: resolvePii(row.phone, row.phone_encrypted),
  company: row.company ?? undefined,
  status: row.status as Contact['status'],
  priority: row.priority as Contact['priority'],
  rating: Number(row.rating),
  notes: row.notes_encrypted ? decryptField(row.notes_encrypted) : row.notes ?? undefined,
  lastContactedAt: row.last_contacted_at?.toISOString(),
  consentRecordedAt: row.consent_recorded_at?.toISOString(),
  importSource: row.import_source ?? undefined,
  popiaNoticeVersion: row.popia_notice_version ?? undefined,
  isPractice: row.is_practice,
  activationStatus: row.activation_status as Contact['activationStatus'],
  createdAt: row.created_at.toISOString(),
});

/**
 * Prepares PII storage fields — encrypts when configured, always computes hashes.
 */
const preparePiiStorage = (input: {
  email?: string;
  phone?: string;
  notes?: string;
}) => {
  const email = input.email?.trim() ?? '';
  const phone = input.phone?.trim() ?? '';
  const notes = input.notes?.trim() ?? '';
  const encrypted = isPiiEncryptionEnabled();

  return {
    emailPlain: encrypted ? null : email || null,
    phonePlain: encrypted ? null : phone || null,
    notesPlain: encrypted ? null : notes || null,
    emailEncrypted: encrypted ? encryptField(email) : null,
    phoneEncrypted: encrypted ? encryptField(phone) : null,
    notesEncrypted: encrypted ? encryptField(notes) : null,
    emailHash: email ? hashPii(email, 'email') : null,
    phoneHash: phone ? hashPii(phone, 'phone') : null,
    fingerprint: buildContactFingerprint(email, phone),
  };
};

/**
 * PostgreSQL persistence for contacts — tenant-scoped, POPIA-aware encryption.
 */
export const contactRepository = {
  /**
   * Counts contacts belonging to an advisor (setup completion checklist).
   */
  async countByUserId(userId: string): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM contacts WHERE user_id = $1',
      [userId]
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  /**
   * Counts real (non-practice) contacts for setup completion.
   */
  async countNonPracticeByUserId(userId: string): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM contacts
       WHERE user_id = $1 AND is_practice = FALSE`,
      [userId]
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  /**
   * Lists contacts for a user with optional name/company search.
   */
  async listByUserId(userId: string, search?: string): Promise<Contact[]> {
    const params: unknown[] = [userId];
    let searchClause = '';

    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      searchClause = `
        AND (
          LOWER(first_name) LIKE $2
          OR LOWER(last_name) LIKE $2
          OR LOWER(COALESCE(company, '')) LIKE $2
        )
      `;
    }

    const result = await getPool().query<ContactRow>(
      `SELECT ${CONTACT_LIST_COLUMNS}
       FROM contacts
       WHERE user_id = $1
       ${searchClause}
       ORDER BY last_name, first_name`,
      params
    );

    return result.rows.map(mapContactRow);
  },

  /**
   * Finds a single contact by ID scoped to the owning advisor.
   */
  async findById(userId: string, contactId: string): Promise<Contact | null> {
    const result = await getPool().query<ContactRow>(
      `SELECT ${CONTACT_LIST_COLUMNS}
       FROM contacts
       WHERE user_id = $1 AND id = $2
       LIMIT 1`,
      [userId, contactId]
    );

    return result.rows[0] ? mapContactRow(result.rows[0]) : null;
  },

  /**
   * Inserts a single contact with encrypted PII and consent metadata.
   */
  async create(
    userId: string,
    input: CreateContactInput,
    options: ContactImportOptions = {
      importSource: 'manual',
      consentAccepted: false,
    }
  ): Promise<Contact> {
    const pii = preparePiiStorage(input);
    const consentAt = options.consentAccepted ? new Date() : null;
    const noticeVersion = options.consentAccepted
      ? (options.popiaNoticeVersion ?? env.popiaNoticeVersion)
      : null;

    const result = await getPool().query<ContactRow>(
      `INSERT INTO contacts (
         user_id,
         first_name,
         last_name,
         email,
         phone,
         company,
         status,
         priority,
         rating,
         notes,
         email_hash,
         phone_hash,
         contact_fingerprint,
         email_encrypted,
         phone_encrypted,
         notes_encrypted,
         consent_recorded_at,
         import_source,
         popia_notice_version,
         is_practice,
         activation_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING ${CONTACT_LIST_COLUMNS}`,
      [
        userId,
        input.firstName.trim(),
        input.lastName?.trim() ?? '',
        pii.emailPlain,
        pii.phonePlain,
        input.company?.trim() || null,
        input.status,
        input.priority,
        input.rating,
        pii.notesPlain,
        pii.emailHash,
        pii.phoneHash,
        pii.fingerprint || null,
        pii.emailEncrypted,
        pii.phoneEncrypted,
        pii.notesEncrypted,
        consentAt,
        options.importSource,
        noticeVersion,
        options.isPractice ?? false,
        'active',
      ]
    );

    return mapContactRow(result.rows[0]);
  },

  /**
   * Promotes a contact to Client status when a policy is issued.
   */
  async markAsClient(userId: string, contactId: string): Promise<void> {
    await getPool().query(
      `UPDATE contacts
       SET status = 'client'
       WHERE user_id = $1 AND id = $2 AND status IS DISTINCT FROM 'client'`,
      [userId, contactId]
    );
  },
  /**
   * Updates an existing contact scoped to the owning advisor.
   */
  async update(
    userId: string,
    contactId: string,
    input: Partial<CreateContactInput>
  ): Promise<Contact | null> {
    const existing = await contactRepository.findById(userId, contactId);
    if (!existing) {
      return null;
    }

    const merged = {
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      email: input.email ?? existing.email,
      phone: input.phone ?? existing.phone,
      company: input.company ?? existing.company,
      status: input.status ?? existing.status,
      priority: input.priority ?? existing.priority,
      rating: input.rating ?? existing.rating,
      notes: input.notes !== undefined ? input.notes : existing.notes,
    };

    const pii = preparePiiStorage({
      email: merged.email,
      phone: merged.phone,
      notes: merged.notes,
    });

    const result = await getPool().query<ContactRow>(
      `UPDATE contacts
       SET first_name = $3,
           last_name = $4,
           email = $5,
           phone = $6,
           company = $7,
           status = $8,
           priority = $9,
           rating = $10,
           notes = $11,
           email_hash = $12,
           phone_hash = $13,
           contact_fingerprint = $14,
           email_encrypted = $15,
           phone_encrypted = $16,
           notes_encrypted = $17
       WHERE user_id = $1 AND id = $2
       RETURNING ${CONTACT_LIST_COLUMNS}`,
      [
        userId,
        contactId,
        merged.firstName.trim(),
        merged.lastName?.trim() ?? '',
        pii.emailPlain,
        pii.phonePlain,
        merged.company?.trim() || null,
        merged.status,
        merged.priority,
        merged.rating,
        pii.notesPlain,
        pii.emailHash,
        pii.phoneHash,
        pii.fingerprint || null,
        pii.emailEncrypted,
        pii.phoneEncrypted,
        pii.notesEncrypted,
      ]
    );

    return result.rows[0] ? mapContactRow(result.rows[0]) : null;
  },

  /**
   * Deletes a contact scoped to the owning advisor.
   */
  async deleteById(userId: string, contactId: string): Promise<boolean> {
    const result = await getPool().query(
      'DELETE FROM contacts WHERE user_id = $1 AND id = $2',
      [userId, contactId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Bulk-imports contacts in a transaction — skips duplicates by fingerprint.
   */
  async batchImport(
    userId: string,
    inputs: CreateContactInput[],
    options: ContactImportOptions
  ): Promise<ContactImportResult> {
    const pool = getPool();
    const client = await pool.connect();
    let imported = 0;
    let duplicates = 0;
    let skipped = 0;
    const seenFingerprints = new Set<string>();

    try {
      await client.query('BEGIN');

      for (const input of inputs) {
        const pii = preparePiiStorage(input);

        if (!pii.fingerprint) {
          skipped += 1;
          continue;
        }

        if (seenFingerprints.has(pii.fingerprint)) {
          duplicates += 1;
          continue;
        }
        seenFingerprints.add(pii.fingerprint);

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM contacts
           WHERE user_id = $1 AND contact_fingerprint = $2
           LIMIT 1`,
          [userId, pii.fingerprint]
        );

        if (existing.rows.length > 0) {
          duplicates += 1;
          continue;
        }

        const consentAt = options.consentAccepted ? new Date() : null;
        const noticeVersion = options.consentAccepted
          ? (options.popiaNoticeVersion ?? env.popiaNoticeVersion)
          : null;

        await client.query(
          `INSERT INTO contacts (
             user_id,
             first_name,
             last_name,
             email,
             phone,
             company,
             status,
             priority,
             rating,
             notes,
             email_hash,
             phone_hash,
             contact_fingerprint,
             email_encrypted,
             phone_encrypted,
             notes_encrypted,
             consent_recorded_at,
             import_source,
             popia_notice_version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            userId,
            input.firstName.trim(),
            input.lastName?.trim() ?? '',
            pii.emailPlain,
            pii.phonePlain,
            input.company?.trim() || null,
            input.status,
            input.priority,
            input.rating,
            pii.notesPlain,
            pii.emailHash,
            pii.phoneHash,
            pii.fingerprint,
            pii.emailEncrypted,
            pii.phoneEncrypted,
            pii.notesEncrypted,
            consentAt,
            options.importSource,
            noticeVersion,
          ]
        );

        imported += 1;
      }

      await client.query(
        `INSERT INTO popia_audit_log (user_id, action, resource_type, resource_count, metadata)
         VALUES ($1, 'contact_import', 'contact', $2, $3)`,
        [
          userId,
          imported,
          JSON.stringify({
            source: options.importSource,
            popiaNoticeVersion: options.popiaNoticeVersion ?? env.popiaNoticeVersion,
            batchSize: inputs.length,
            imported,
            duplicates,
            skipped,
            encryptionEnabled: isPiiEncryptionEnabled(),
          }),
        ]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      imported,
      duplicates,
      skipped,
      total: inputs.length,
    };
  },

  /**
   * Lists POPIA audit log entries for an advisor (no PII in metadata).
   */
  async listPopiaAudit(userId: string, limit = 20) {
    const result = await getPool().query<{
      id: string;
      action: string;
      resource_type: string;
      resource_count: number | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, action, resource_type, resource_count, metadata, created_at
       FROM popia_audit_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      resourceCount: row.resource_count,
      metadata: row.metadata,
      createdAt: row.created_at.toISOString(),
    }));
  },
};
