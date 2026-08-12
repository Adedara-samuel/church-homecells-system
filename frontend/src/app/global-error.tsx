'use client';

import * as React from 'react';

/**
 * Last-resort boundary.
 *
 * Catches a failure in the root layout itself, where the theme, fonts and providers
 * may not have mounted — so this renders its own `<html>` and uses inline styles
 * rather than depending on anything that could be the thing that broke.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Fatal application error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          background: '#f5f6f8',
          color: '#111827',
          padding: '1rem',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto',
              borderRadius: 14,
              background: '#22406E',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
            }}
          >
            HMS
          </div>

          <h1 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>
            The application could not start
          </h1>
          <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.6, margin: 0 }}>
            Something failed before the interface finished loading. Your data has not been
            affected. Reload the page, and if the problem persists contact your administrator.
          </p>

          {error.digest && (
            <p
              style={{
                fontSize: 12,
                color: '#6b7280',
                fontFamily: 'ui-monospace, monospace',
                marginTop: 12,
              }}
            >
              Reference: {error.digest}
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              height: 40,
              padding: '0 20px',
              borderRadius: 8,
              border: 'none',
              background: '#22406E',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload the application
          </button>
        </div>
      </body>
    </html>
  );
}
