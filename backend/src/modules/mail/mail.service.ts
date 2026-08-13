import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { MailLog } from './mail.model';

/**
 * Outbound email.
 *
 * Mirrors the shape of the SMS and payment layers: a real transport when credentials
 * exist, a logging one when they do not, so the whole flow — template, log, dedupe —
 * is exercisable in development without an SMTP account.
 *
 * The log row is written *before* the send, so a crash mid-send still leaves a trace,
 * and its unique `dedupeKey` is what stops a daily job greeting anyone twice.
 */

let transporter: Transporter | null = null;

export function mailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

export function mailTransportName(): string {
  return mailConfigured() ? 'SMTP' : 'LOG';
}

function getTransporter(): Transporter | null {
  if (!mailConfigured()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Port 465 is implicit TLS; 587 upgrades with STARTTLS after connecting.
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    pool: true,
    maxConnections: 3,
    // A celebration run is a burst of similar messages; pacing them keeps providers
    // from treating the batch as a spam spike.
    maxMessages: 50,
    rateDelta: 1000,
    rateLimit: 5,
  });

  return transporter;
}

/** Verifies the SMTP credentials without sending anything. */
export async function verifyMailTransport(): Promise<{ ok: boolean; detail: string }> {
  const transport = getTransporter();
  if (!transport) {
    return { ok: false, detail: 'No SMTP credentials configured — email is logged, not sent.' };
  }
  try {
    await transport.verify();
    return { ok: true, detail: `Connected to ${env.SMTP_HOST}:${env.SMTP_PORT}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Categorises the log row, e.g. `BIRTHDAY`. */
  type: string;
  member?: { id: string; name: string } | null;
  /** Makes a repeated send for the same occasion a no-op. */
  dedupeKey?: string;
}

export async function sendMail(options: SendMailOptions): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
  const transport = getTransporter();
  const transportName = mailTransportName();

  let log;
  try {
    log = await MailLog.create({
      to: options.to,
      subject: options.subject,
      type: options.type,
      member: options.member?.id ?? null,
      recipientName: options.member?.name ?? null,
      transport: transportName,
      status: 'QUEUED',
      dedupeKey: options.dedupeKey ?? null,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.debug({ dedupeKey: options.dedupeKey }, 'Email already sent for this occasion — skipping');
      return 'SKIPPED';
    }
    throw err;
  }

  const from = `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`;

  try {
    if (!transport) {
      /**
       * Recorded as SKIPPED, never SENT. The message is fully rendered and logged so
       * the flow is exercisable without an SMTP account, but reporting it as sent
       * would mean a production deployment with missing credentials shows a run of
       * successful greetings that nobody ever received.
       */
      log.status = 'SKIPPED';
      log.error = 'No SMTP credentials configured';
      await log.save();

      const message = 'Email not sent — no SMTP credentials configured';
      if (env.isProduction) logger.error({ to: options.to, subject: options.subject }, message);
      else logger.info({ to: options.to, subject: options.subject, from }, `${message} (logged only)`);

      return 'SKIPPED';
    }

    const info = await transport.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: env.MAIL_REPLY_TO || undefined,
    });

    log.status = 'SENT';
    log.messageId = info.messageId ?? null;
    log.sentAt = new Date();
    await log.save();
    return 'SENT';
  } catch (err) {
    log.status = 'FAILED';
    log.error = (err as Error).message;
    await log.save();
    logger.error({ err, to: options.to }, 'Email dispatch failed');
    return 'FAILED';
  }
}
