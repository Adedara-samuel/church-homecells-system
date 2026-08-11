import { logger } from '../../../config/logger';
import { PaymentProviderName } from '../../../types/enums';
import { getSettings } from '../../settings/settings.service';
import { FlutterwaveProvider } from './flutterwave.provider';
import { MockPaymentProvider } from './mock.provider';
import { PaystackProvider } from './paystack.provider';
import type { PaymentProvider } from './types';

const registry: Record<PaymentProviderName, PaymentProvider> = {
  [PaymentProviderName.PAYSTACK]: new PaystackProvider(),
  [PaymentProviderName.FLUTTERWAVE]: new FlutterwaveProvider(),
  [PaymentProviderName.MOCK]: new MockPaymentProvider(),
};

export function getProvider(name: PaymentProviderName): PaymentProvider {
  return registry[name] ?? registry[PaymentProviderName.MOCK];
}

/**
 * The provider an administrator has selected in system settings.
 *
 * If that provider has no credentials configured — the normal state in development —
 * the mock provider is used instead, so the application is always fully operable.
 */
export async function getActiveProvider(): Promise<PaymentProvider> {
  const settings = await getSettings();
  const selected = getProvider(settings.activePaymentProvider);

  if (!selected.isConfigured) {
    logger.warn(
      { provider: selected.name },
      'Selected payment provider has no credentials configured — falling back to the mock provider',
    );
    return registry[PaymentProviderName.MOCK];
  }
  return selected;
}

/** Configuration status of every provider, for the settings screen. */
export function providerStatuses() {
  return Object.values(registry).map((provider) => ({
    name: provider.name,
    isConfigured: provider.isConfigured,
    supportsPayouts: provider.supportsPayouts,
  }));
}

export { MockPaymentProvider };
export type { PaymentProvider } from './types';
