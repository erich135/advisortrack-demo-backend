const MAX_IDENTITY_CHARS = 80;

/**
 * Projection-level sanitisation for stored identity/directory strings.
 * Neutralises prompt-breaking structure without destroying legitimate
 * South African names such as O'Connor, Van der Merwe, Anne-Marie.
 */
export function sanitizeIdentityText(value: string): string {
  const stripped = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/https?:\/\//gi, '')
    .replace(/mailto:/gi, '')
    .replace(/[\{\}\[\]<>\\"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= MAX_IDENTITY_CHARS) return stripped;
  return stripped.slice(0, MAX_IDENTITY_CHARS).trim();
}
