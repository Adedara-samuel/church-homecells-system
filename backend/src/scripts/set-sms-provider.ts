/**
 * Switches the active SMS provider, and optionally the sender ID.
 *
 * Like the payment provider, this is *database* state: `SMS_PROVIDER` only seeds it
 * when the settings document is first created, so changing the variable on a running
 * deployment does nothing. A system left on MOCK records every message as sent while
 * delivering none of them.
 *
 *   npm run set-sms                          # show the current state
 *   npm run set-sms -- TERMII                # switch provider
 *   npm run set-sms -- TERMII "N-Alert"      # switch provider and sender ID
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { SmsProviderName } from '../types/enums';
import { SystemSettings } from '../modules/settings/settings.model';
import { invalidateSettingsCache } from '../modules/settings/settings.service';
import { smsProviderStatuses } from '../modules/sms/providers';

async function main(): Promise<void> {
  const requested = process.argv[2]?.toUpperCase();
  const senderId = process.argv[3];

  await connectDatabase();

  const settings = await SystemSettings.findOne({ key: 'SYSTEM' });
  if (!settings) {
    throw new Error('No settings document exists yet. Start the API once, then run this again.');
  }

  const statuses = smsProviderStatuses();

  console.log('\n  SMS providers');
  console.log('  ─────────────────────────────────────────────');
  for (const status of statuses) {
    const active = status.name === settings.activeSmsProvider ? ' ← active' : '';
    console.log(
      `   ${status.name.padEnd(8)} ${status.isConfigured ? 'configured    ' : 'no credentials'}${active}`,
    );
  }
  console.log(`\n   Database setting : ${settings.activeSmsProvider}`);
  console.log(`   SMS_PROVIDER     : ${env.SMS_PROVIDER}  (seeds first boot only)`);
  console.log(`   Sender ID        : ${settings.smsSenderId}`);
  console.log(`   NODE_ENV         : ${env.NODE_ENV}\n`);

  if (settings.activeSmsProvider === SmsProviderName.MOCK) {
    console.log('   The mock provider delivers nothing. Messages are logged, never sent.\n');
  }

  if (!requested) {
    console.log('  Pass a provider to change it, e.g.  npm run set-sms -- TERMII "N-Alert"\n');
    return;
  }

  if (!(Object.values(SmsProviderName) as string[]).includes(requested)) {
    throw new Error(
      `Unknown provider "${requested}". Choose one of: ${Object.values(SmsProviderName).join(', ')}`,
    );
  }

  const target = statuses.find((status) => status.name === requested);
  if (!target?.isConfigured) {
    throw new Error(
      `${requested} has no credentials configured. Set its keys in the environment first.`,
    );
  }
  if (requested === SmsProviderName.MOCK && env.isProduction) {
    throw new Error('The mock provider delivers nothing and cannot be used in production.');
  }

  const previous = settings.activeSmsProvider;
  settings.activeSmsProvider = requested as SmsProviderName;
  if (senderId) settings.smsSenderId = senderId;
  await settings.save();
  invalidateSettingsCache();

  console.log(`  Active SMS provider changed: ${previous} → ${requested}`);
  if (senderId) console.log(`  Sender ID set to: ${senderId}`);
  console.log(
    '\n  Note: Termii rejects an unregistered sender ID. "N-Alert" is the generic\n' +
      '  approved sender; a custom one must be registered in the Termii dashboard first.\n',
  );
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n  Failed: ${(err as Error).message}\n`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
