import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { SmsDeliveryStatus, SmsProviderName } from '../../types/enums';
import { ProviderError } from '../../utils/errors';

export interface SendSmsRequest {
  to: string;
  message: string;
  senderId: string;
}

export interface SendSmsResult {
  status: SmsDeliveryStatus;
  providerReference: string | null;
  raw: Record<string, unknown>;
  error: string | null;
}

export interface SmsProvider {
  readonly name: SmsProviderName;
  readonly isConfigured: boolean;
  send(request: SendSmsRequest): Promise<SendSmsResult>;
}

/**
 * Nigerian numbers are stored in whatever form they were entered; providers require
 * E.164. Local `0...` numbers are normalised to `+234...`.
 */
export function normalisePhone(raw: string, defaultCountryCode = '234'): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+${defaultCountryCode}${digits.slice(1)}`;
  if (digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return `+${defaultCountryCode}${digits}`;
}

/** GSM-7 messages are 160 characters; anything longer is billed per 153-char segment. */
export function countSegments(message: string): number {
  // Anything outside printable ASCII forces UCS-2 encoding and shorter segments.
  const unicode = /[^ -~]/.test(message);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return message.length <= single ? 1 : Math.ceil(message.length / multi);
}

class TermiiProvider implements SmsProvider {
  readonly name = SmsProviderName.TERMII;

  get isConfigured(): boolean {
    return Boolean(env.TERMII_API_KEY);
  }

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    if (!this.isConfigured) throw new ProviderError('Termii', 'TERMII_API_KEY is not configured.');

    const response = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: normalisePhone(request.to).replace('+', ''),
        from: request.senderId,
        sms: request.message,
        type: 'plain',
        channel: 'generic',
        api_key: env.TERMII_API_KEY,
      }),
    });

    const json = (await response.json().catch(() => ({}))) as {
      message_id?: string;
      message?: string;
      code?: string;
    };

    if (!response.ok || json.code === 'error') {
      return {
        status: SmsDeliveryStatus.FAILED,
        providerReference: null,
        raw: json as Record<string, unknown>,
        error: json.message ?? `Termii request failed (${response.status})`,
      };
    }

    return {
      status: SmsDeliveryStatus.SENT,
      providerReference: json.message_id ?? null,
      raw: json as Record<string, unknown>,
      error: null,
    };
  }
}

class TwilioProvider implements SmsProvider {
  readonly name = SmsProviderName.TWILIO;

  get isConfigured(): boolean {
    return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
  }

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    if (!this.isConfigured) {
      throw new ProviderError('Twilio', 'Twilio credentials are not configured.');
    }

    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: normalisePhone(request.to),
          From: env.TWILIO_FROM_NUMBER!,
          Body: request.message,
        }),
      },
    );

    const json = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };

    if (!response.ok) {
      return {
        status: SmsDeliveryStatus.FAILED,
        providerReference: null,
        raw: json as Record<string, unknown>,
        error: json.message ?? `Twilio request failed (${response.status})`,
      };
    }

    return {
      status: SmsDeliveryStatus.SENT,
      providerReference: json.sid ?? null,
      raw: json as Record<string, unknown>,
      error: null,
    };
  }
}

/**
 * Development provider: logs the message and reports it as delivered.
 * Every SMS still lands in the SMS log, so the whole celebration workflow is
 * observable without credentials or spend.
 */
class MockSmsProvider implements SmsProvider {
  readonly name = SmsProviderName.MOCK;
  readonly isConfigured = true;

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    logger.info(
      { to: normalisePhone(request.to), senderId: request.senderId, message: request.message },
      'Mock SMS dispatched',
    );
    return {
      status: SmsDeliveryStatus.DELIVERED,
      providerReference: `MOCK-SMS-${Date.now().toString(36).toUpperCase()}`,
      raw: { mock: true },
      error: null,
    };
  }
}

const registry: Record<SmsProviderName, SmsProvider> = {
  [SmsProviderName.TERMII]: new TermiiProvider(),
  [SmsProviderName.TWILIO]: new TwilioProvider(),
  [SmsProviderName.MOCK]: new MockSmsProvider(),
};

export function getSmsProvider(name: SmsProviderName): SmsProvider {
  const provider = registry[name] ?? registry[SmsProviderName.MOCK];
  if (!provider.isConfigured) {
    logger.warn(
      { provider: provider.name },
      'Selected SMS provider has no credentials - falling back to the mock provider',
    );
    return registry[SmsProviderName.MOCK];
  }
  return provider;
}

export function smsProviderStatuses() {
  return Object.values(registry).map((p) => ({ name: p.name, isConfigured: p.isConfigured }));
}
