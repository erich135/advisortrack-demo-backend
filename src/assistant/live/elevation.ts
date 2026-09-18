/**
 * Future exceptional support access — design hook only.
 * The Assistant must never grant elevation itself. No DB tables in A7.4.
 *
 * Later flow:
 *   explicit request → defined support purpose → permitted scope →
 *   limited duration → audit → expiry
 */
export const SUPPORT_ELEVATION_POLICY = {
  assistantMayGrant: false,
  grantedBy: 'out_of_band_ops',
  requires: [
    'explicit_request',
    'defined_support_purpose',
    'permitted_scope',
    'limited_duration',
    'audit',
    'expiry',
  ],
} as const;

export type SupportElevationRequest = {
  purpose: string;
  companyId: string;
  kinds: Array<'directory' | 'reporting' | 'diagnostics'>;
  durationMs: number;
};

export function assistantMayGrantSupportElevation(): false {
  return SUPPORT_ELEVATION_POLICY.assistantMayGrant;
}
