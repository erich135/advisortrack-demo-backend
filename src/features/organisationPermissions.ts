/**
 * Fixed permission keys companies attach to their custom-named roles.
 * Role names are free text; these keys are not.
 */
export const ORGANISATION_PERMISSIONS = [
  {
    key: 'view_team',
    label: 'View team',
    description: 'See members who report to this user (reportsToUserId).',
  },
  {
    key: 'view_company',
    label: 'View company',
    description: 'See every member in the company.',
  },
  {
    key: 'manage_roles',
    label: 'Manage roles',
    description: 'Create, rename, and set permissions on company roles.',
  },
  {
    key: 'manage_members',
    label: 'Manage members',
    description: 'Assign roles and reporting lines to members.',
  },
  {
    key: 'manage_company',
    label: 'Manage company',
    description: 'Update company name and seat limit (when the UI exists).',
  },
] as const;

export type OrganisationPermissionKey = (typeof ORGANISATION_PERMISSIONS)[number]['key'];

const PERMISSION_KEY_SET = new Set<string>(ORGANISATION_PERMISSIONS.map((item) => item.key));

/**
 * Returns true when the key is a known organisation permission.
 */
export const isOrganisationPermissionKey = (key: string): key is OrganisationPermissionKey =>
  PERMISSION_KEY_SET.has(key);
