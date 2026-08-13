'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavItem, NavSection } from './navigation';

/**
 * The sidebar navigation.
 *
 * Groups are disclosures rather than always-open lists, because the Finance group
 * alone is ten destinations and a coordinator only ever works in one area at a time.
 *
 * Three decisions worth knowing about:
 *
 *  1. **The open group follows you.** Navigating into a group opens it; the group
 *     holding the current page is never collapsed out from under you. A closed group
 *     that contains the current page still says so, with a marker on its header, so
 *     the sidebar always answers "where am I" even when everything is shut.
 *
 *  2. **Height animates with `grid-template-rows`, not `max-height`.** A max-height
 *     animation has to guess a height larger than the content, which makes the timing
 *     wrong for short groups and clips long ones. Animating `0fr → 1fr` uses the real
 *     height, so every group opens at the same speed whatever it contains.
 *
 *  3. **Items stagger in.** Each row is offset by 20ms, which reads as the group
 *     unfolding rather than a block appearing. It is skipped entirely under
 *     `prefers-reduced-motion`.
 */

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
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
  const pinned = sections.filter((section) => section.pinned);
  const groups = sections.filter((section) => !section.pinned);

  // The group holding the current page, which always wins over a stored preference.
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
        // Ignore — the preference is a convenience, not state we depend on.
      }
      return next;
    });
  };

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {pinned.map((section) => (
        <ul key={section.label} className="mb-3 space-y-0.5">
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
      ))}

      {pinned.length > 0 && groups.length > 0 && (
        <div className="mx-3 mb-3 h-px bg-sidebar-border" aria-hidden />
      )}

      <div className="space-y-1">
        {groups.map((section) => (
          <NavGroup
            key={section.label}
            section={section}
            pathname={pathname}
            open={open === section.label}
            onToggle={() => toggle(section.label)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
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

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
          // The sidebar has no ring token of its own; white reads on its dark ground.
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
          open || holdsCurrentPage
            ? 'text-white'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-white',
        )}
      >
        {SectionIcon && <SectionIcon className="h-4 w-4 shrink-0" />}
        <span className="flex-1 truncate text-left font-medium">{section.label}</span>

        {/* Says "your page is in here" while the group is shut. */}
        {holdsCurrentPage && !open && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#E3BE55]" aria-hidden />
        )}

        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-sidebar-foreground/50 transition-transform duration-300 motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          style={{ transitionTimingFunction: EASE }}
          aria-hidden
        />
      </button>

      {/*
        The grid collapses to a zero-height row while the inner element keeps its real
        height, so the transition is driven by actual content rather than a guessed
        maximum.
      */}
      <div
        id={panelId}
        role="region"
        aria-label={section.label}
        className="grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          transitionTimingFunction: EASE,
        }}
      >
        <div className="overflow-hidden">
          {/* The spine ties the group's items together and reads as one unit. */}
          <ul className="ml-[1.4rem] space-y-0.5 border-l border-sidebar-border pl-3 pt-1">
            {section.items.map((item, index) => (
              <li
                key={item.href}
                className={cn(
                  'transition-all duration-300 motion-reduce:transition-none motion-reduce:translate-x-0 motion-reduce:opacity-100',
                  open ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
                )}
                style={{
                  transitionTimingFunction: EASE,
                  // Staggered on the way in; collapsing is uniform so the group does
                  // not appear to unravel.
                  transitionDelay: open ? `${index * 20}ms` : '0ms',
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
        'relative flex items-center gap-3 rounded-md py-2.5 text-sm transition-colors',
        nested ? 'px-3' : 'px-3',
        active
          ? 'bg-sidebar-accent font-medium text-white'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white',
      )}
    >
      {/* Marks the active row against the group spine. */}
      {nested && active && (
        <span
          className="absolute -left-[13px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#E3BE55]"
          aria-hidden
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
