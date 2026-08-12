'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * HomecellMS brand mark.
 *
 * Drawn as inline SVG rather than shipped as a raster so it stays crisp at every size,
 * needs no network request, and can pick up theme colours. The composition mirrors the
 * supplied artwork: a pointed-arch shield, an open book at its centre, and a cross
 * rising above the pages.
 */
export function LogoMark({
  className,
  navy = 'currentColor',
  gold = '#C9A227',
  title = 'HomecellMS',
}: {
  className?: string;
  navy?: string;
  gold?: string;
  title?: string;
}) {
  const id = React.useId();

  return (
    <svg
      viewBox="0 0 128 128"
      role="img"
      aria-label={title}
      className={cn('shrink-0', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${id}-navy`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={navy} stopOpacity="0.95" />
          <stop offset="100%" stopColor={navy} stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gold} />
          <stop offset="100%" stopColor={gold} stopOpacity="0.75" />
        </linearGradient>
      </defs>

      {/* Outer shield: pointed arch above, tapering to a point below. */}
      <path
        d="M64 8c14 0 26 5 34 13v56c0 20-14 33-34 43-20-10-34-23-34-43V21C38 13 50 8 64 8Z"
        stroke={`url(#${id}-navy)`}
        strokeWidth="5.5"
        strokeLinejoin="round"
      />

      {/* Inner arch, echoing the outer silhouette. */}
      <path
        d="M64 22c9 0 17 3 22 8v42c0 13-9 22-22 29-13-7-22-16-22-29V30c5-5 13-8 22-8Z"
        stroke={`url(#${id}-gold)`}
        strokeWidth="3.5"
        strokeLinejoin="round"
        opacity="0.9"
      />

      {/* Cross, seated above the open book. */}
      <path
        d="M64 26v26M54 35h20"
        stroke={`url(#${id}-gold)`}
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* Open book: two pages meeting at a central spine. */}
      <path
        d="M64 62c-6-4-13-6-20-6v30c7 0 14 2 20 6 6-4 13-6 20-6V56c-7 0-14 2-20 6Z"
        stroke={navy}
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <path d="M64 62v30" stroke={navy} strokeWidth="3.5" strokeLinecap="round" />

      {/* Text lines suggested on each page. */}
      <path
        d="M50 68h8M50 76h8M70 68h8M70 76h8"
        stroke={gold}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

/**
 * Full lockup: mark plus wordmark. `compact` drops the descriptor line for tight
 * spaces such as the sidebar header.
 */
export function Logo({
  className,
  markClassName,
  compact = false,
  inverted = false,
}: {
  className?: string;
  markClassName?: string;
  compact?: boolean;
  inverted?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <LogoMark
        className={cn('h-9 w-9', markClassName)}
        navy={inverted ? '#FFFFFF' : 'hsl(var(--primary))'}
        gold={inverted ? '#E3BE55' : '#C9A227'}
      />
      <div className="min-w-0 leading-tight">
        <p
          className={cn(
            'truncate font-semibold tracking-tight',
            inverted ? 'text-white' : 'text-foreground',
            compact ? 'text-sm' : 'text-base',
          )}
        >
          Homecell<span className="text-[#C9A227]">MS</span>
        </p>
        {!compact && (
          <p
            className={cn(
              'truncate text-[10px] uppercase tracking-[0.14em]',
              inverted ? 'text-white/60' : 'text-muted-foreground',
            )}
          >
            Church Homecell Management
          </p>
        )}
      </div>
    </div>
  );
}

/** Large centred lockup for the login and splash screens. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <LogoMark className="h-20 w-20" navy="hsl(var(--primary))" gold="#C9A227" />
      <p className="mt-4 text-2xl font-semibold tracking-tight">
        Homecell<span className="text-[#C9A227]">MS</span>
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Church Homecell Management System
      </p>
      <p className="mt-2 text-xs italic text-muted-foreground/80">
        Connecting &amp; equipping the body
      </p>
    </div>
  );
}
