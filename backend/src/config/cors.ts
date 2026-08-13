import type { Request } from 'express';
import { env } from './env';

/**
 * An entry in `CORS_ORIGINS` matches literally, or as a wildcard when it contains
 * `*` — `https://*.vercel.app` covers the preview deployments Vercel creates per
 * branch, whose hostnames are not known ahead of time. A bare `*` allows any
 * origin (credentialed requests still get the reflected origin, never `*`).
 */
export function isOriginAllowed(origin: string): boolean {
  const normalized = origin.replace(/\/+$/, '');
  return env.corsOrigins.some((allowed) => {
    if (allowed === '*') return true;
    if (!allowed.includes('*')) return allowed === normalized;
    const pattern = new RegExp(
      `^${allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*')}$`,
      'i',
    );
    return pattern.test(normalized);
  });
}

/**
 * Where to send the browser back to after a hosted checkout.
 *
 * The origin that started the payment is the one that should receive it, so a
 * coordinator paying from the production site is never returned to localhost — and a
 * developer paying from localhost is never returned to production. `FRONTEND_URL` is
 * the fallback for requests that carry no Origin header, such as a server-to-server
 * call or a redirect-initiated POST.
 *
 * The header is only honoured when it is already permitted by the CORS allow-list.
 * An unchecked Origin here would let anyone who can reach the API mint a Paystack
 * checkout that returns the payer to a site of their choosing.
 */
export function resolveFrontendOrigin(req?: Request): string {
  const origin = req?.get('origin');
  if (origin && isOriginAllowed(origin)) return origin.replace(/\/+$/, '');
  return env.FRONTEND_URL.replace(/\/+$/, '');
}
