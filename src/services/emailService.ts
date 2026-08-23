import { MailtrapClient } from 'mailtrap';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('EmailService');

let mailtrapClient: MailtrapClient | null = null;

/**
 * Returns a masked preview of the Mailtrap token for safe logging.
 */
const maskToken = (token: string | undefined): string => {
  if (!token) {
    return '(not set)';
  }
  if (token.length <= 8) {
    return '****';
  }
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
};

/**
 * Logs Mailtrap configuration once when the email module is first used.
 */
const logMailtrapConfig = (): void => {
  log.info('Mailtrap configuration', {
    token: maskToken(env.mailtrapApiToken),
    fromEmail: env.mailFromEmail,
    fromName: env.mailFromName,
    deepLinkScheme: env.appDeepLinkScheme,
    configured: Boolean(env.mailtrapApiToken),
  });
};

/**
 * Returns a lazily initialised Mailtrap client when an API token is configured.
 */
const getClient = (): MailtrapClient | null => {
  if (!env.mailtrapApiToken) {
    return null;
  }
  if (!mailtrapClient) {
    mailtrapClient = new MailtrapClient({ token: env.mailtrapApiToken });
    logMailtrapConfig();
  }
  return mailtrapClient;
};

export type MailAttachment = {
  filename: string;
  content: Buffer;
  type?: string;
};

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  category: string;
  /** Dev/testing fallback when delivery fails (PIN or deep link). */
  actionCode?: string;
  actionLink?: string;
  attachments?: MailAttachment[];
};

export type SendMailResult = {
  ok: boolean;
  messageId?: string | null;
  error?: string | null;
};

export type TestMailer = {
  send: (input: SendMailInput) => Promise<SendMailResult>;
};

let testMailer: TestMailer | null = null;

/** Test-only mailer. Does not send to real customers. */
export const setTestMailer = (mailer: TestMailer | null): void => {
  testMailer = mailer;
};

const TOKEN_MISSING_MESSAGE =
  'Outgoing email is not configured (MAILTRAP_API_TOKEN not set). No message was sent. No external delivery was attempted.';

export const DEMO_EMAIL_BLOCKED_MESSAGE =
  'The public demo does not send email. No external delivery was attempted.';

/**
 * Sends via Mailtrap when configured. Without a token, returns a failed result and does not deliver.
 * Demo mode never delivers, even if a token or test mailer is present.
 */
export const sendMail = async (input: SendMailInput): Promise<SendMailResult> => {
  if (env.isDemoMode) {
    log.warn(DEMO_EMAIL_BLOCKED_MESSAGE, {
      to: input.to,
      subject: input.subject,
      category: input.category,
    });
    return { ok: false, error: DEMO_EMAIL_BLOCKED_MESSAGE };
  }

  if (testMailer) {
    return testMailer.send(input);
  }

  const client = getClient();
  const from = {
    email: env.mailFromEmail,
    name: env.mailFromName,
  };

  log.info('Preparing email', {
    to: input.to,
    subject: input.subject,
    category: input.category,
    from: from.email,
    actionCode: input.actionCode,
    actionLink: input.actionLink,
    attachmentCount: input.attachments?.length ?? 0,
  });

  if (!client) {
    log.warn(TOKEN_MISSING_MESSAGE, {
      to: input.to,
      subject: input.subject,
      category: input.category,
      actionCode: input.actionCode,
      actionLink: input.actionLink,
      textPreview: input.text.slice(0, 400),
    });
    return { ok: false, error: TOKEN_MISSING_MESSAGE };
  }

  try {
    const response = await client.send({
      from,
      to: [{ email: input.to }],
      subject: input.subject,
      text: input.text,
      html: input.html,
      category: input.category,
      attachments: input.attachments?.map((file) => ({
        filename: file.filename,
        content: file.content,
        type: file.type ?? 'application/octet-stream',
        disposition: 'attachment',
      })),
    });

    log.info('Mailtrap send succeeded', {
      to: input.to,
      subject: input.subject,
      category: input.category,
      response,
    });
    const messageId = response.message_ids?.[0] ?? null;
    return { ok: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Mailtrap send failed', {
      to: input.to,
      subject: input.subject,
      category: input.category,
      actionCode: input.actionCode,
      actionLink: input.actionLink,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (input.actionCode || input.actionLink) {
      log.warn('Email not delivered — use this code/link to continue testing', {
        actionCode: input.actionCode,
        actionLink: input.actionLink,
        hint: 'Fix Mailtrap domain DNS, or enter the PIN shown in actionCode.',
      });
    }

    return { ok: false, error: message };
  }
};

/**
 * Sends a transactional email via Mailtrap, or logs the content in development when unconfigured.
 * Returns false when delivery failed — callers should not treat email failure as a hard error.
 */
const sendEmail = async (input: SendMailInput): Promise<boolean> => {
  const result = await sendMail(input);
  return result.ok;
};

/**
 * Sends a signup verification email containing a 6-digit PIN for the mobile app.
 */
export const sendVerificationEmail = async (
  email: string,
  firstName: string,
  pin: string
): Promise<boolean> => {
  const greeting = firstName.trim() || 'there';

  log.info('Sending verification PIN email', {
    to: email,
    pin,
  });

  return sendEmail({
    to: email,
    subject: `${pin} is your AdvisorTrack verification code`,
    category: 'Email Verification',
    actionCode: pin,
    text: [
      `Hi ${greeting},`,
      '',
      'Thanks for signing up for AdvisorTrack.',
      '',
      `Your verification code is: ${pin}`,
      '',
      'Enter this code in the AdvisorTrack app to activate your account.',
      'This code expires in 30 minutes.',
      '',
      'If you did not create an account, you can ignore this email.',
      '',
      '— The AdvisorTrack Team',
    ].join('\n'),
    html: `
      <p>Hi ${greeting},</p>
      <p>Thanks for signing up for AdvisorTrack.</p>
      <p style="font-size:16px;margin:24px 0 8px;">Your verification code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 24px;">${pin}</p>
      <p>Enter this code in the AdvisorTrack app to activate your account.</p>
      <p>This code expires in 30 minutes. If you did not create an account, you can ignore this email.</p>
      <p>— The AdvisorTrack Team</p>
    `,
  });
};

/**
 * Sends a password reset email containing a 6-digit PIN for the mobile app.
 */
export const sendPasswordResetEmail = async (
  email: string,
  firstName: string,
  pin: string
): Promise<boolean> => {
  const greeting = firstName.trim() || 'there';

  log.info('Sending password reset PIN email', {
    to: email,
    pin,
  });

  return sendEmail({
    to: email,
    subject: `${pin} is your AdvisorTrack password reset code`,
    category: 'Password Reset',
    actionCode: pin,
    text: [
      `Hi ${greeting},`,
      '',
      'We received a request to reset your AdvisorTrack password.',
      '',
      `Your reset code is: ${pin}`,
      '',
      'Enter this code in the AdvisorTrack app, then choose a new password.',
      'This code expires in 1 hour.',
      '',
      'If you did not request a reset, you can ignore this email.',
      '',
      '— The AdvisorTrack Team',
    ].join('\n'),
    html: `
      <p>Hi ${greeting},</p>
      <p>We received a request to reset your AdvisorTrack password.</p>
      <p style="font-size:16px;margin:24px 0 8px;">Your reset code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 24px;">${pin}</p>
      <p>Enter this code in the AdvisorTrack app, then choose a new password.</p>
      <p>This code expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
      <p>— The AdvisorTrack Team</p>
    `,
  });
};
