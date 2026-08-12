'use client';

import * as React from 'react';
import { BarChart3, Download, FileSpreadsheet, FileText, Play } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatMoney, formatPercent } from '@/lib/utils';
import { reportsService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import type { ReportColumn, ReportDefinition, ReportResult } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DateFilter, FilterSelect, OrgFilters } from '@/components/common/filters';

/** Renders a cell according to the column type declared by the API. */
function formatCell(value: unknown, column: ReportColumn): string {
  if (value === null || value === undefined || value === '') return '—';
  if (column.type === 'money') return formatMoney(Number(value));
  if (column.type === 'percent') return formatPercent(Number(value));
  if (column.type === 'date') return formatDate(String(value));
  if (column.type === 'number') return Number(value).toLocaleString('en-NG');
  return String(value);
}

export default function ReportsPage() {
  const { can } = useAuth();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<Record<string, string | undefined>>({});
  const [ran, setRan] = React.useState(false);

  const definitions = useApiQuery([...queryKeys.reports, 'definitions'], reportsService.definitions);

  const report = useApiQuery(
    [...queryKeys.reports, selected, filters],
    () => reportsService.run(selected!, filters),
    { enabled: Boolean(selected) && ran },
  );

  // Read the array out first so the memo depends on the data, not the query object.
  const reportDefinitions = definitions.data;

  const grouped = React.useMemo(() => {
    const map = new Map<string, ReportDefinition[]>();
    for (const definition of reportDefinitions ?? []) {
      const list = map.get(definition.group) ?? [];
      list.push(definition);
      map.set(definition.group, list);
    }
    return [...map.entries()];
  }, [reportDefinitions]);

  const activeDefinition = definitions.data?.find((d) => d.key === selected);

  const setFilter = (key: string, value: string | undefined) => {
    setFilters((current) => {
      const next = { ...current };
      if (!value) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Operational, financial and demographic reports, scoped to what your role can see."
      />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          {definitions.isLoading ? (
            <TableSkeleton rows={6} columns={1} />
          ) : definitions.isError ? (
            <ErrorState error={definitions.error} onRetry={() => void definitions.refetch()} />
          ) : (
            grouped.map(([group, items]) => (
              <Card key={group}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">{group}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 pb-3">
                  {(items ?? []).map((definition) => (
                    <button
                      key={definition.key}
                      onClick={() => {
                        setSelected(definition.key);
                        setRan(false);
                      }}
                      className={cn(
                        'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                        selected === definition.key
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'hover:bg-muted',
                      )}
                    >
                      {definition.label}
                    </button>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          {!selected ? (
            <EmptyState
              icon={BarChart3}
              title="Select a report"
              description="Choose a report from the list, set your filters, then run it."
            />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{activeDefinition?.label}</CardTitle>
                  <p className="text-sm text-muted-foreground">{activeDefinition?.description}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <OrgFilters
                    zoneId={filters.zoneId}
                    areaId={filters.areaId}
                    homecellId={filters.homecellId}
                    onChange={(key, value) => setFilter(key, value)}
                  />

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <DateFilter
                      label="From"
                      value={filters.from}
                      onChange={(value) => setFilter('from', value)}
                    />
                    <DateFilter
                      label="To"
                      value={filters.to}
                      onChange={(value) => setFilter('to', value)}
                    />
                    {selected === 'attendance' && (
                      <FilterSelect
                        label="Group by"
                        placeholder="Homecell"
                        value={filters.groupBy}
                        onChange={(value) => setFilter('groupBy', value)}
                        options={[
                          { value: 'homecell', label: 'Homecell' },
                          { value: 'area', label: 'Area' },
                          { value: 'zone', label: 'Zone' },
                          { value: 'date', label: 'Date' },
                        ]}
                      />
                    )}
                    {selected === 'demographics-location' && (
                      <FilterSelect
                        label="Group by"
                        placeholder="State"
                        value={filters.groupBy}
                        onChange={(value) => setFilter('groupBy', value)}
                        options={[
                          { value: 'state', label: 'State' },
                          { value: 'lga', label: 'Local Government Area' },
                          { value: 'city', label: 'City / town' },
                          { value: 'community', label: 'Community' },
                        ]}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setRan(true)} loading={report.isFetching && ran}>
                      <Play className="h-4 w-4" />
                      Run report
                    </Button>
                    {can('reports.export') && ran && report.data && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => void reportsService.export(selected, 'csv', filters)}
                        >
                          <Download className="h-4 w-4" />
                          CSV
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void reportsService.export(selected, 'xlsx', filters)}
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                          Excel
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void reportsService.export(selected, 'pdf', filters)}
                        >
                          <FileText className="h-4 w-4" />
                          PDF
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {ran && (
                <Card>
                  <CardContent className="pt-5">
                    {report.isLoading ? (
                      <TableSkeleton rows={8} columns={5} />
                    ) : report.isError ? (
                      <ErrorState error={report.error} onRetry={() => void report.refetch()} />
                    ) : report.data ? (
                      <ReportTable report={report.data} />
                    ) : null}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ReportTable({ report }: { report: ReportResult }) {
  if (report.rows.length === 0) {
    return (
      <EmptyState
        title="No data for these filters"
        description="Adjust the date range or organisational filters and run the report again."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {report.rows.length.toLocaleString()} row{report.rows.length === 1 ? '' : 's'} · generated{' '}
          {formatDate(report.generatedAt, true)}
        </p>
      </div>

      <div className="table-scroll rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {report.columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                    (column.type === 'money' ||
                      column.type === 'number' ||
                      column.type === 'percent') &&
                      'text-right',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.slice(0, 500).map((row, index) => (
              <tr key={index} className="border-b last:border-0">
                {report.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'whitespace-nowrap px-4 py-2.5',
                      (column.type === 'money' ||
                        column.type === 'number' ||
                        column.type === 'percent') &&
                        'text-right tabular',
                    )}
                  >
                    {formatCell(row[column.key], column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.rows.length > 500 && (
        <p className="text-xs text-muted-foreground">
          Showing the first 500 rows on screen. Export to see the full report.
        </p>
      )}

      {report.summary && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-3 text-sm font-medium">Summary</p>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(report.summary).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                </dt>
                <dd className="tabular text-sm font-medium">
                  {typeof value === 'number' ? value.toLocaleString('en-NG') : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
