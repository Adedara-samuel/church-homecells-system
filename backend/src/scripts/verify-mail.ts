/**
 * Checks the SMTP configuration, and optionally sends a real celebration email to an
 * address you choose.
 *
 *   npm run verify:mail                     # connect and authenticate only
 *   npm run verify:mail -- you@example.org  # also send a live birthday email
 *
 * Worth running against production credentials before the first celebration goes out:
 * the job runs at 07:00 and a failure there is discovered by the member not receiving
 * anything, which is the worst way to find out.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { mailConfigured, mailTransportName, sendMail, verifyMailTransport } from '../modules/mail/mail.service';
import {
  celebrationHtml,
  celebrationSubject,
  celebrationText,
} from '../modules/mail/templates/celebration';

async function main(): Promise<void> {
  const recipient = process.argv[2];

  console.log('\n  Email configuration');
  console.log('  ─────────────────────────────────────────────');
  console.log(`   transport : ${mailTransportName()}`);
  console.log(`   host      : ${env.SMTP_HOST || '(not set)'}:${env.SMTP_PORT}`);
  console.log(`   user      : ${env.SMTP_USER || '(not set)'}`);
  console.log(`   from      : ${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`);
  console.log(`   reply-to  : ${env.MAIL_REPLY_TO || '(none)'}`);

  const check = await verifyMailTransport();
  console.log(`\n   ${check.ok ? 'OK      ' : 'PROBLEM '}: ${check.detail}\n`);

  if (!recipient) {
    if (!mailConfigured()) {
      console.log('  Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to send real email.\n');
    }
    console.log('  Pass an address to send a live test:  npm run verify:mail -- you@example.org\n');
    return;
  }

  if (!check.ok) {
    throw new Error('Refusing to send: the transport did not verify.');
  }

  // The log lives in the database, so a connection is needed only for a real send.
  await connectDatabase();

  const input = {
    kind: 'BIRTHDAY' as const,
    name: 'Test Recipient',
    churchName: 'Grace Assembly',
    message:
      'This is a test of the celebration email. If it looks right here, it will look right on the day.',
    homecellName: 'Test Homecell',
    portalUrl: env.FRONTEND_URL,
  };

  const outcome = await sendMail({
    to: recipient,
    subject: celebrationSubject(input),
    html: celebrationHtml(input),
    text: celebrationText(input),
    type: 'TEST',
    // Timestamped so the check can be repeated; the daily job's key is the date.
    dedupeKey: `TEST:${recipient}:${Date.now()}`,
  });

  console.log(`  Send result: ${outcome} → ${recipient}\n`);
  if (outcome !== 'SENT') throw new Error('The test email did not send.');
}

main()
  .then(async () => {
    if (mongoose.connection.readyState === 1) await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n  Failed: ${(err as Error).message}\n`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
