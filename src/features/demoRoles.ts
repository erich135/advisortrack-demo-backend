export const DEMO_PUBLIC_ROLES = [
  'executive',
  'regional_manager',
  'team_leader',
  'financial_advisor',
] as const;

export type DemoPublicRole = (typeof DEMO_PUBLIC_ROLES)[number];
export type DemoSelectedRole = DemoPublicRole;

const ROLE_LABELS: Record<DemoPublicRole, string> = {
  executive: 'Executive',
  regional_manager: 'Regional Manager',
  team_leader: 'Team Leader',
  financial_advisor: 'Financial Advisor',
};

const REJECTED_ROLE_ALIASES = new Set([
  'founder/admin',
  'founder admin',
  'founder',
  'app admin',
  'app manager',
  'platform admin',
  'platform_admin',
]);

export const isDemoPublicRole = (value: string): value is DemoPublicRole =>
  (DEMO_PUBLIC_ROLES as readonly string[]).includes(value);

export const demoRoleLabel = (role: DemoPublicRole): string => ROLE_LABELS[role];

/**
 * Returns a permitted public demo role, or null when the value is missing/invalid.
 */
export const parseDemoPublicRole = (value: unknown): DemoSelectedRole | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isDemoPublicRole(normalized)) return normalized;
  return null;
};

export const isRejectedDemoRole = (value: unknown): boolean => {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, ' ');
  const underscored = normalized.replace(/ /g, '_');
  return REJECTED_ROLE_ALIASES.has(normalized) || REJECTED_ROLE_ALIASES.has(underscored);
};
