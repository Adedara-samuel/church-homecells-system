'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Building2,
  CakeSlice,
  CalendarCheck,
  ClipboardCheck,
  Heart,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatMoney, formatNumber, formatPercent } from '@/lib/utils';
import { dashboardService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { PageHeader, StatCard } from '@/components/common/page';
import { CardSkeleton, ErrorState } from '@/components/common/states';
import {
  AttendanceAreaChart,
  DistributionBarChart,
  MoneyBarChart,
} from '@/components/common/charts';

const ATTENDANCE_SERIES = [
  { key: 'SUNDAY_HOMECELL', label: 'Sunday Homecell' },
  { key: 'TUESDAY_MIRACLE_SERVICE', label: 'Tuesday Miracle Service' },
  { key: 'THURSDAY_HOUR_OF_EMPHASIS', label: 'Thursday Hour of Emphasis' },
];

const FINANCE_SERIES = [
  { key: 'offerings', label: 'Offerings' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'remittances', label: 'Remittances' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const {
    data: dashboard,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery(queryKeys.dashboard, dashboardService.get, {
    // The finance and approval figures should not go stale while someone works.
    refetchInterval: 120_000,
  });

  if (isLoading) {
    return (
      <>
        <PageHeader title="Dashboard" description="Loading your overview…" />
        <CardSkeleton count={4} />
      </>
    );
  }

  if (isError || !dashboard) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  const { currency } = dashboard;
  const greeting = user ? `Good day, ${user.firstName}` : 'Dashboard';

  return (
    <>
      <PageHeader
        title={greeting}
        description={`${dashboard.scope.label} overview · every figure below is calculated live from your records.`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/reports">
                <TrendingUp className="h-4 w-4" />
                Reports
              </Link>
            </Button>
            {user?.role === 'HOMECELL_COORDINATOR' && (
              <Button asChild>
                <Link href="/attendance/record">
                  <CalendarCheck className="h-4 w-4" />
                  Record attendance
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Threshold warning: the most consequential thing a coordinator can be told. */}
      {dashboard.alerts.homecellsRequiringRemittance.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {dashboard.alerts.homecellsRequiringRemittance.length === 1
                  ? '1 Homecell purse has reached its maximum threshold'
                  : `${dashboard.alerts.homecellsRequiringRemittance.length} Homecell purses have reached their maximum threshold`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Please remit the required amount to the General Homecell Purse.
              </p>
              <ul className="mt-3 space-y-1.5">
                {dashboard.alerts.homecellsRequiringRemittance.map((item) => (
                  <li
                    key={item.homecellId}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="tabular text-muted-foreground">
                      {formatMoney(item.balance, currency)} / {formatMoney(item.threshold, currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" className="mt-3" asChild>
                <Link href="/finance/remittances">Record a remittance</Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Primary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active members"
          value={formatNumber(dashboard.membership.active)}
          hint={`${formatNumber(dashboard.membership.newThisMonth)} joined this month`}
          icon={Users}
        />
        <StatCard
          label="Attendance rate"
          value={formatPercent(dashboard.attendance.overallPercentage)}
          hint="Across all services, last 90 days"
          icon={CalendarCheck}
          tone={dashboard.attendance.overallPercentage >= 60 ? 'success' : 'warning'}
        />
        <StatCard
          label="Current purse balance"
          value={formatMoney(dashboard.finance.currentPurseBalance, currency)}
          hint={
            dashboard.finance.homecellsAboveThreshold > 0
              ? `${dashboard.finance.homecellsAboveThreshold} above threshold`
              : 'All purses within threshold'
          }
          icon={Wallet}
          tone={dashboard.finance.homecellsAboveThreshold > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Pending approvals"
          value={formatNumber(dashboard.approvals.total)}
          hint={`${dashboard.approvals.pendingExpenses} expenses · ${dashboard.approvals.pendingTransfers} transfers`}
          icon={ClipboardCheck}
          tone={dashboard.approvals.total > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Structure & finance this month */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Offerings this month"
          value={formatMoney(dashboard.finance.offeringsThisMonth, currency)}
          hint={`${formatMoney(dashboard.finance.totalOfferings, currency)} all time`}
          icon={Banknote}
        />
        <StatCard
          label="Expenses this month"
          value={formatMoney(dashboard.finance.expensesThisMonth, currency)}
          hint="Approved expenses only"
          icon={Receipt}
        />
        <StatCard
          label="Remitted this month"
          value={formatMoney(dashboard.finance.remittancesThisMonth, currency)}
          hint={`${formatMoney(dashboard.finance.totalRemittances, currency)} all time`}
          icon={ArrowLeftRight}
        />
        <StatCard
          label="Structure"
          value={
            dashboard.scope.level === 'HOMECELL'
              ? formatNumber(dashboard.membership.total)
              : `${formatNumber(dashboard.structure.homecells)}`
          }
          hint={
            dashboard.scope.level === 'HOMECELL'
              ? 'Members on the register'
              : `${dashboard.structure.zones} zones · ${dashboard.structure.areas} areas · homecells`
          }
          icon={Building2}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance trend</CardTitle>
            <CardDescription>Members present at each service over the last 12 weeks</CardDescription>
          </CardHeader>
          <CardContent>
            <AttendanceAreaChart
              data={dashboard.charts.attendanceTrend}
              xKey="date"
              series={ATTENDANCE_SERIES}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financial activity</CardTitle>
            <CardDescription>Offerings, expenses and remittances over six months</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyBarChart
              data={dashboard.charts.financeTrend}
              xKey="month"
              series={FINANCE_SERIES}
              currency={currency}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {dashboard.scope.level === 'CHURCH'
                ? 'Members by Zone'
                : dashboard.scope.level === 'ZONE'
                  ? 'Members by Area'
                  : 'Members by Homecell'}
            </CardTitle>
            <CardDescription>Active membership distribution within your scope</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionBarChart
              data={dashboard.charts.membersByUnit}
              xKey="name"
              valueKey="members"
              label="Members"
              height={Math.max(220, dashboard.charts.membersByUnit.length * 34)}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attendance by service</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.attendance.byType.map((service) => (
                <div key={service.type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">{service.label}</span>
                    <span className="tabular font-medium">{formatPercent(service.percentage)}</span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={service.percentage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${service.label} attendance`}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(service.percentage, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(service.present)} of {formatNumber(service.total)} expected
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Celebrations</CardTitle>
              <CardDescription>Coming up in the configured window</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link
                href="/members/celebrations?celebrations=birthdays"
                className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-2 text-sm">
                  <CakeSlice className="h-4 w-4 text-chart-3" />
                  Birthdays
                </span>
                <span className="tabular font-semibold">{dashboard.celebrations.birthdays}</span>
              </Link>
              <Link
                href="/members/celebrations?celebrations=anniversaries"
                className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Heart className="h-4 w-4 text-chart-4" />
                  Wedding anniversaries
                </span>
                <span className="tabular font-semibold">{dashboard.celebrations.anniversaries}</span>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
