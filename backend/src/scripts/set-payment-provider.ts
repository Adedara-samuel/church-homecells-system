/**
 * Switches the active payment provider.
 *
 * The provider is *database* state, not environment state: `PAYMENT_PROVIDER` only
 * seeds it the first time the settings document is created, so changing the variable
 * on an existing deployment does nothing. That is why a system already running on the
 * mock provider keeps issuing `/payments/mock/...` checkout links however the
 * environment is configured.
 *
 *   npm run set-provider -- PAYSTACK
 *   npm run set-provider            # prints the current state and exits
 *
 * The same change can be made in the UI under Settings → Integrations; this exists for
 * production databases, where there may be no browser session to hand.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { PaymentProviderName } from '../types/enums';
import { SystemSettings } from '../modules/settings/settings.model';
import { invalidateSettingsCache } from '../modules/settings/settings.service';
import { providerStatuses } from '../modules/payments/providers';

async function main(): Promise<void> {
  const requested = process.argv[2]?.toUpperCase();

  await connectDatabase();

  const settings = await SystemSettings.findOne({ key: 'SYSTEM' });
  if (!settings) {
    throw new Error(
      'No settings document exists yet. Start the API once so it can be created, then run this again.',
    );
  }

  const statuses = providerStatuses();

  console.log('\n  Payment providers');
  console.log('  ─────────────────────────────────────────────');
  for (const status of statuses) {
    const active = status.name === settings.activePaymentProvider ? ' ← active' : '';
    console.log(
      `   ${status.name.padEnd(12)} ${status.isConfigured ? 'configured    ' : 'no credentials'}${active}`,
    );
  }
  console.log(`\n   Database setting : ${settings.activePaymentProvider}`);
  console.log(`   PAYMENT_PROVIDER : ${env.PAYMENT_PROVIDER}  (seeds first boot only)`);
  console.log(`   NODE_ENV         : ${env.NODE_ENV}\n`);

  if (!requested) {
    console.log('  Pass a provider name to change it, e.g.  npm run set-provider -- PAYSTACK\n');
    return;
  }

  if (!(Object.values(PaymentProviderName) as string[]).includes(requested)) {
    throw new Error(
      `Unknown provider "${requested}". Choose one of: ${Object.values(PaymentProviderName).join(', ')}`,
    );
  }

  const target = statuses.find((status) => status.name === requested);
  if (!target?.isConfigured) {
    throw new Error(
      `${requested} has no credentials configured. Set its keys in the environment first — ` +
        'switching to a provider that cannot authenticate would break every payment.',
    );
  }
  if (requested === PaymentProviderName.MOCK && env.isProduction) {
    throw new Error(
      'The mock provider fabricates successful payments and cannot be used in production.',
    );
  }

  const previous = settings.activePaymentProvider;
  settings.activePaymentProvider = requested as PaymentProviderName;
  await settings.save();
  invalidateSettingsCache();

  console.log(`  Active payment provider changed: ${previous} → ${requested}\n`);
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
