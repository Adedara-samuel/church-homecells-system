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

/**
 * A network call that cannot hang.
 *
 * The celebration job sends one message per celebrant in sequence; without a timeout a
 * single unresponsive provider request would stall the whole run.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeNetworkError(provider: string, error: unknown): string {
  if ((error as Error)?.name === 'AbortError') return `${provider} did not respond in time.`;
  return (error as Error)?.message ?? `${provider} request failed.`;
}

class TermiiProvider implements SmsProvider {
  readonly name = SmsProviderName.TERMII;

  get isConfigured(): boolean {
    return Boolean(env.TERMII_API_KEY);
  }

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    if (!this.isConfigured) throw new ProviderError('Termii', 'TERMII_API_KEY is not configured.');

    let response: Response;
    try {
      response = await fetchWithTimeout(`${env.TERMII_BASE_URL}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Termii expects the number without the leading '+'.
          to: normalisePhone(request.to).replace('+', ''),
          from: request.senderId,
          sms: request.message,
          type: 'plain',
          channel: 'generic',
          api_key: env.TERMII_API_KEY,
        }),
      });
    } catch (error) {
      return {
        status: SmsDeliveryStatus.FAILED,
        providerReference: null,
        raw: {},
        error: describeNetworkError('Termii', error),
      };
    }

    const json = (await response.json().catch(() => ({}))) as {
      message_id?: string;
      message?: string;
      code?: string;
      balance?: number;
    };

    if (!response.ok || json.code === 'error') {
      return {
        status: SmsDeliveryStatus.FAILED,
        providerReference: null,
        raw: json as Record<string, unknown>,
        error: json.message ?? `Termii request failed (${response.status})`,
      };
    }

    // Accepted by the provider. The final DELIVERED state arrives on the status webhook.
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

    const body = new URLSearchParams({
      To: normalisePhone(request.to),
      From: env.TWILIO_FROM_NUMBER!,
      Body: request.message,
    });
    // Ask Twilio to call back with the final delivery outcome.
    if (env.SMS_STATUS_CALLBACK_URL) {
      body.set('StatusCallback', env.SMS_STATUS_CALLBACK_URL);
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        },
      );
    } catch (error) {
      return {
        status: SmsDeliveryStatus.FAILED,
        providerReference: null,
        raw: {},
        error: describeNetworkError('Twilio', error),
      };
    }

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
