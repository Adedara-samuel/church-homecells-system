'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
  UserCircle,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, initials } from '@/lib/utils';
import { notificationsService } from '@/services';
import { queryKeys } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { NAVIGATION, ROLE_LABELS } from './navigation';

function useVisibleNavigation() {
  const { canAny } = useAuth();
  return React.useMemo(
    () =>
      NAVIGATION.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => !item.permissions || canAny(...item.permissions),
        ),
      })).filter((section) => section.items.length > 0),
    [canAny],
  );
}

function isActivePath(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = useVisibleNavigation();
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          HC
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Homecell Management</p>
          <p className="truncate text-xs text-sidebar-foreground/70">
            {user ? ROLE_LABELS[user.role] : ''}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Main navigation">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActivePath(pathname, item.href, item.exact);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                        active
                          ? 'bg-sidebar-accent font-medium text-white'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function NotificationBell() {
  const { data: unreadCount } = useQuery({
    queryKey: [...queryKeys.notifications, 'unread-count'],
    queryFn: notificationsService.unreadCount,
    // Keeps the badge current without a socket connection.
    refetchInterval: 60_000,
  });

  return (
    <Button variant="ghost" size="icon" asChild className="relative">
      <Link href="/notifications" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
        <Bell className="h-5 w-5" />
        {unreadCount ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-10 w-10" />;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[140px] truncate text-left font-medium sm:block">
            {user.fullName}
          </span>
          <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
        <div className="px-2 pb-2">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <Badge variant="secondary" className="mt-2">
            {ROLE_LABELS[user.role]}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/account')}>
          <UserCircle />
          My account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();

  // The drawer should not survive a navigation.
  React.useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Persistent sidebar from lg upward */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-64">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Link
            href="/members"
            className="ml-auto hidden items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent sm:flex"
          >
            <Search className="h-4 w-4" />
            Search members
          </Link>

          <div className="ml-auto flex items-center gap-1 sm:ml-2">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px] space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function AppShellSkeleton() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-64 bg-sidebar lg:block" />
      <div className="flex-1 space-y-6 p-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
