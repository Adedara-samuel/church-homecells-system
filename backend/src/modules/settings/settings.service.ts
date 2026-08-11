import { env } from '../../config/env';
import {
  SystemSettings,
  type SystemSettingsDoc,
  type SystemSettingsDocument,
} from './settings.model';

/**
 * Settings are read on nearly every finance request, so they are cached in-process
 * with a short TTL and invalidated eagerly on write.
 */
const CACHE_TTL_MS = 30_000;
let cache: { value: SystemSettingsDocument; at: number } | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function getSettings(force = false): Promise<SystemSettingsDocument> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let doc = await SystemSettings.findOne({ key: 'SYSTEM' });
  if (!doc) {
    doc = await SystemSettings.create({
      key: 'SYSTEM',
      currency: env.PAYMENT_CURRENCY,
      activePaymentProvider: env.PAYMENT_PROVIDER,
      activeSmsProvider: env.SMS_PROVIDER,
      smsSenderId: env.SMS_SENDER_ID,
      maxUploadSizeMb: env.UPLOAD_MAX_FILE_SIZE_MB,
    });
  }
  cache = { value: doc, at: Date.now() };
  return doc;
}

export async function updateSettings(
  patch: Partial<SystemSettingsDoc>,
  userId?: string,
): Promise<SystemSettingsDocument> {
  const current = await getSettings(true);
  Object.assign(current, patch, { updatedBy: userId ?? current.updatedBy, key: 'SYSTEM' });
  await current.save();
  invalidateSettingsCache();
  return current;
}

/** The currency every new financial record is denominated in. */
export async function currentCurrency(): Promise<string> {
  return (await getSettings()).currency;
}
