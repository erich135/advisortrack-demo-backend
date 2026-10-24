/** Strip emails, phones, and SA ID numbers before a provider sees the question. */
export function redactQuestion(question: string): string {
  return question
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:\+?27|0)[\s-]?[1-9](?:[\s-]?\d){8}\b/g, '[phone]')
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]')
    .replace(/\b\d{13}\b/g, '[id]')
    .trim();
}
