# POPIA Consent & Audit Trail — AdvisorTrack

This document confirms what the platform records when advisors import contacts from a device, and how that supports POPIA accountability. **It is not legal advice** — your compliance officer should review it against your processing agreement and PAIA/POPIA policies.

## What is recorded on device import

When an advisor imports contacts and checks the POPIA consent box, the system stores:

### Per contact (`contacts` table)

| Field | Purpose |
|-------|---------|
| `consent_recorded_at` | Timestamp when consent was recorded at import |
| `popia_notice_version` | Version of the in-app POPIA notice shown (e.g. `2026-06`) |
| `import_source` | `device_import` (vs `manual` for hand-entered contacts) |
| `email_hash` / `phone_hash` / `contact_fingerprint` | One-way fingerprints for deduplication — not reversible |
| `email_encrypted` / `phone_encrypted` / `notes_encrypted` | AES-256-GCM at rest when `PII_ENCRYPTION_KEY` is configured |

No contact names, emails, or phone numbers are written to the audit log.

### Per import batch (`popia_audit_log` table)

One row per successful import batch:

| Field | Example |
|-------|---------|
| `action` | `contact_import` |
| `resource_type` | `contact` |
| `resource_count` | Number of contacts actually imported |
| `metadata` | `{ source, popiaNoticeVersion, batchSize, imported, duplicates, skipped, encryptionEnabled }` |
| `created_at` | Server timestamp |

Metadata contains **counts and versions only** — no subject PII.

## API access

- `GET /api/v1/contacts/popia-audit` — returns recent audit log entries for the authenticated advisor (for internal review).
- Contact detail responses include `consentRecordedAt`, `popiaNoticeVersion`, and `importSource` when set.

## What this demonstrates

1. **Consent before processing** — import is blocked until the advisor checks the POPIA checkbox (`ContactImportModal`).
2. **Versioned notice** — `popia_notice_version` ties consent to a specific notice text.
3. **Accountability** — batch-level audit log proves when imports occurred and how many records were processed.
4. **Data minimisation in logs** — audit metadata excludes names, emails, and ID numbers.
5. **Duplicate prevention** — fingerprint hashing avoids re-importing the same device contact.

## Gaps to discuss with legal / product (not blockers for import audit)

| Gap | Recommendation |
|-----|----------------|
| Manual contact create has no consent checkbox | Add consent capture on manual create if required by your policy |
| No audit log on update/delete/export | Extend `popia_audit_log` for other processing activities if your IA requires it |
| ID number stored in `notes` text on mobile | Migrate to `id_number_encrypted` column when dedicated field is wired |

## Conclusion for client protection

For **device contact import**, the combination of:

- explicit in-app consent,
- per-contact `consent_recorded_at` + `popia_notice_version`,
- batch `popia_audit_log` without PII,
- optional field-level encryption,

provides a **defensible technical audit trail** for demonstrating that consent was obtained and imports were logged. Final sufficiency depends on your privacy policy, operator agreement with advisors, and whether notice text matches `popia_notice_version`.
