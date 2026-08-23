import { centsToRand } from '../features/invoiceMoney';
import { sendMail, type SendMailResult } from './emailService';

const formatZar = (cents: number): string => `R${centsToRand(cents)}`;

/**
 * Sends an AdvisorTrack invoice using the existing Mailtrap transactional mailer.
 */
export const sendInvoiceEmail = async (input: {
  to: string;
  contactName: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalCents: number;
  pdf: Buffer;
  filename: string;
}): Promise<SendMailResult> => {
  const greeting = input.contactName?.trim() || 'there';
  const total = formatZar(input.totalCents);
  const text = [
    `Hi ${greeting},`,
    '',
    `Please find AdvisorTrack invoice ${input.invoiceNumber} attached.`,
    '',
    `Invoice date: ${input.invoiceDate}`,
    `Due date: ${input.dueDate}`,
    `Total: ${total}`,
    '',
    'If you have questions about this invoice, reply to this email.',
    '',
    '— The AdvisorTrack Team',
  ].join('\n');

  return sendMail({
    to: input.to,
    subject: `AdvisorTrack invoice ${input.invoiceNumber}`,
    category: 'Invoice',
    text,
    html: `
      <p>Hi ${greeting},</p>
      <p>Please find AdvisorTrack invoice <strong>${input.invoiceNumber}</strong> attached.</p>
      <p>
        Invoice date: ${input.invoiceDate}<br />
        Due date: ${input.dueDate}<br />
        Total: ${total}
      </p>
      <p>If you have questions about this invoice, reply to this email.</p>
      <p>— The AdvisorTrack Team</p>
    `,
    attachments: [
      {
        filename: input.filename,
        content: input.pdf,
        type: 'application/pdf',
      },
    ],
  });
};
