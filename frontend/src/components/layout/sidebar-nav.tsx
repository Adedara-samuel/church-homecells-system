'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavItem, NavSection } from './navigation';

/**
 * The sidebar navigation.
 *
 * Groups are disclosures rather than always-open lists, because Finance alone is ten
 * destinations and a coordinator works in one area at a time.
 *
 * The visual system is deliberately narrow — three levels of emphasis and one accent
 * colour — because a navigation that competes with the page it frames is a navigation
 * that gets ignored:
 *
 *   level 1  group headers    icon chip, white when open, medium weight
 *   level 2  destinations     13px, muted until hovered or current
 *   accent   gold             used *only* to answer "where am I", never decoratively
 *
 * Three behaviours worth knowing about:
 *
 *  1. **The open group follows you.** Navigating into a group opens it, and the group
 *     holding the current page is never collapsed out from under you. A closed group
 *     containing the current page still says so, so the sidebar always answers "where
 *     am I" even with everything shut.
 *
 *  2. **Height animates with `grid-template-rows`, not `max-height`.** A max-height
 *     animation has to guess a height above the content, which makes short groups feel
 *     sluggish and clips long ones. Animating `0fr → 1fr` uses the real height, so a
 *     three-item group and a ten-item group open at exactly the same speed.
 *
 *  3. **Items stagger in.** Each row is offset by 18ms, which reads as unfolding
 *     rather than a block appearing. Collapsing is uniform — staggering on the way out
 *     looks like unravelling. All of it is dropped under `prefers-reduced-motion`.
 */

/** Decelerating curve: quick to start, settles rather than stopping dead. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const GOLD = '#E3BE55';
const STORAGE_KEY = 'chms.sidebar.openGroup';

export function isActivePath(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function sectionContainsPath(section: NavSection, pathname: string): boolean {
  return section.items.some((item) => isActivePath(pathname, item.href, item.exact));
}

export function SidebarNav({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const groups = React.useMemo(
    () => sections.filter((section) => !section.pinned),
    [sections],
  );

  const activeGroup = React.useMemo(
    () => groups.find((section) => sectionContainsPath(section, pathname))?.label ?? null,
    [groups, pathname],
  );

  const [open, setOpen] = React.useState<string | null>(activeGroup);

  // Restore the last opened group, but only when the current page does not dictate one.
  React.useEffect(() => {
    if (activeGroup) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setOpen(stored);
    } catch {
      // A blocked localStorage is not worth failing navigation over.
    }
  }, [activeGroup]);

  React.useEffect(() => {
    if (activeGroup) setOpen(activeGroup);
  }, [activeGroup]);

  const toggle = (label: string) => {
    setOpen((current) => {
      const next = current === label ? null : label;
      try {
        if (next) window.localStorage.setItem(STORAGE_KEY, next);
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // The preference is a convenience, not state anything depends on.
      }
      return next;
    });
  };

  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        'flex-1 overflow-y-auto px-2.5 py-3',
        // A hairline scrollbar: present when needed, never a visual element.
        '[scrollbar-width:thin] [scrollbar-color:hsl(var(--sidebar-border))_transparent]',
        '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full',
        '[&::-webkit-scrollbar-thumb]:bg-sidebar-border [&::-webkit-scrollbar-track]:bg-transparent',
      )}
    >
      {/*
        Rendered in declaration order rather than pinned-then-grouped, so where a flat
        link sits in the file is where it sits on screen — Reports last, below the
        groups, because it reads across all of them and belongs to none.
      */}
      {sections.map((section, index) => {
        // A rule appears wherever the list changes between flat links and groups.
        const previous = sections[index - 1];
        const needsDivider = previous !== undefined && Boolean(previous.pinned) !== Boolean(section.pinned);

        return (
          <React.Fragment key={section.label}>
            {needsDivider && (
              // Fades out at both ends: separates without drawing a hard line.
              <div
                className="mx-3 my-3 h-px"
                style={{
                  background:
                    'linear-gradient(to right, transparent, hsl(var(--sidebar-border)), transparent)',
                }}
                aria-hidden
              />
            )}

            {section.pinned ? (
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      active={isActivePath(pathname, item.href, item.exact)}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-0.5">
                <NavGroup
                  section={section}
                  pathname={pathname}
                  open={open === section.label}
                  onToggle={() => toggle(section.label)}
                  onNavigate={onNavigate}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function NavGroup({
  section,
  pathname,
  open,
  onToggle,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const holdsCurrentPage = sectionContainsPath(section, pathname);
  const SectionIcon = section.icon;
  const panelId = `nav-${section.label.replace(/\s+/g, '-').toLowerCase()}`;
  const lit = open || holdsCurrentPage;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg py-2 pl-2 pr-2.5 text-left transition-colors duration-200',
          // The sidebar has no ring token of its own; white reads on its dark ground.
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
          lit ? 'text-white' : 'text-sidebar-foreground/75 hover:bg-white/[0.04] hover:text-white',
        )}
      >
        {/*
          The icon chip is what gives the group its weight. Filling it on open is a
          quieter way to show state than tinting the whole row, which would compete
          with the active destination inside.
        */}
        {SectionIcon && (
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-200',
              lit
                ? 'bg-sidebar-accent text-white'
                : 'bg-white/[0.04] text-sidebar-foreground/70 group-hover:text-white',
            )}
          >
            <SectionIcon className="h-4 w-4" />
          </span>
        )}

        <span className="flex-1 truncate text-[13px] font-medium tracking-[-0.01em]">
          {section.label}
        </span>

        {/* Says "your page is in here" while the group is shut. */}
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-200',
            holdsCurrentPage && !open ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          )}
          style={{ backgroundColor: GOLD }}
          aria-hidden
        />

        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-300 motion-reduce:transition-none',
            lit ? 'text-sidebar-foreground/70' : 'text-sidebar-foreground/40',
            open && 'rotate-90',
          )}
          style={{ transitionTimingFunction: EASE }}
          aria-hidden
        />
      </button>

      {/*
        The grid row collapses to zero height while the inner element keeps its real
        height, so the transition is driven by actual content rather than a guess.
      */}
      <div
        id={panelId}
        role="region"
        aria-label={section.label}
        className="grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr', transitionTimingFunction: EASE }}
      >
        <div className="overflow-hidden">
          <ul className="relative ml-[1.35rem] mt-0.5 space-y-px pb-1 pl-3.5">
            {/* The spine ties the group into one unit and fades out at its end. */}
            <span
              className="absolute inset-y-0 left-0 w-px"
              style={{
                background:
                  'linear-gradient(to bottom, hsl(var(--sidebar-border)), hsl(var(--sidebar-border)) 70%, transparent)',
              }}
              aria-hidden
            />
            {section.items.map((item, index) => (
              <li
                key={item.href}
                className={cn(
                  'transition-all duration-300 motion-reduce:!translate-x-0 motion-reduce:!opacity-100 motion-reduce:transition-none',
                  open ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
                )}
                style={{
                  transitionTimingFunction: EASE,
                  transitionDelay: open ? `${index * 18}ms` : '0ms',
                }}
              >
                <NavLink
                  item={item}
                  active={isActivePath(pathname, item.href, item.exact)}
                  onNavigate={onNavigate}
                  // A closed group must not be reachable by keyboard.
                  tabIndex={open ? undefined : -1}
                  nested
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
  nested,
  tabIndex,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  nested?: boolean;
  tabIndex?: number;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      tabIndex={tabIndex}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/link relative flex items-center gap-2.5 rounded-lg transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
        nested ? 'py-1.5 pl-2.5 pr-2.5 text-[13px]' : 'py-2 pl-2 pr-2.5 text-[13px]',
        active
          ? 'bg-sidebar-accent font-medium text-white'
          : cn(
              'text-sidebar-foreground/70 hover:bg-white/[0.05] hover:text-white',
              // A hair of movement on hover, so the row feels responsive to the cursor.
              'hover:translate-x-0.5 motion-reduce:hover:translate-x-0',
            ),
      )}
    >
      {/* Marks the active row against the group spine. */}
      {nested && active && (
        <span
          className="absolute -left-[14px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full"
          style={{ backgroundColor: GOLD }}
          aria-hidden
        />
      )}

      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors duration-200',
          nested && !active && 'text-sidebar-foreground/55 group-hover/link:text-white',
        )}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
