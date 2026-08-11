'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import type { PaginationMeta } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';

export interface Column<T> {
  key: string;
  header: string;
  /** Enables the header sort control; the value is sent to the API as `sort`. */
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hidden below `md` — used for secondary columns on phones. */
  hideOnMobile?: boolean;
  render: (row: T) => React.ReactNode;
  /** Shown under the primary cell in the mobile card layout. */
  mobileLabel?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  sort?: { field?: string; order: 'asc' | 'desc' };
  onSortChange?: (field: string, order: 'asc' | 'desc') => void;
  /** Rendered instead of the table body when there are no rows. */
  emptyState?: React.ReactNode;
  className?: string;
}

/**
 * Server-paginated table.
 *
 * Two presentations from one column definition: a real table from `md` upward, and a
 * stacked card list on phones — the Homecell Coordinator's primary device. Nothing is
 * sorted or paged client-side; every control calls back to the query.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  pagination,
  onPageChange,
  onLimitChange,
  sort,
  onSortChange,
  emptyState,
  className,
}: DataTableProps<T>) {
  const handleSort = (column: Column<T>) => {
    if (!column.sortable || !onSortChange) return;
    const nextOrder = sort?.field === column.key && sort.order === 'desc' ? 'asc' : 'desc';
    onSortChange(column.key, nextOrder);
  };

  if (rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  const [primary, ...rest] = columns;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Desktop / tablet */}
      <div className="table-scroll hidden rounded-lg border md:block">
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.className,
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      aria-label={`Sort by ${column.header}`}
                    >
                      {column.header}
                      <ChevronsUpDown
                        className={cn(
                          'h-3 w-3',
                          sort?.field === column.key ? 'text-foreground' : 'opacity-40',
                        )}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter') onRowClick(row);
                      }
                    : undefined
                }
                className={cn(
                  'border-b transition-colors last:border-0 hover:bg-muted/40',
                  onRowClick && 'cursor-pointer focus:bg-muted/60 focus:outline-none',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 align-middle',
                      column.align === 'right' && 'text-right tabular',
                      column.align === 'center' && 'text-center',
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per row, primary column as the heading */}
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (event) => {
                    if (event.key === 'Enter') onRowClick(row);
                  }
                : undefined
            }
            className={cn(
              'rounded-lg border p-4',
              onRowClick && 'cursor-pointer active:bg-muted/50',
            )}
          >
            {primary && <div className="font-medium">{primary.render(row)}</div>}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {rest
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {column.mobileLabel ?? column.header}
                    </dt>
                    <dd className="truncate">{column.render(row)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Showing{' '}
            <span className="font-medium text-foreground">
              {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)}
            </span>{' '}
            of <span className="font-medium text-foreground">{pagination.total.toLocaleString()}</span>
          </p>

          <div className="flex items-center gap-2">
            {onLimitChange && (
              <Select
                value={String(pagination.limit)}
                onValueChange={(value) => onLimitChange(Number(value))}
              >
                <SelectTrigger className="h-9 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasPreviousPage}
              onClick={() => onPageChange?.(pagination.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <span className="px-2 text-sm text-muted-foreground">
              {pagination.page} / {Math.max(pagination.totalPages, 1)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNextPage}
              onClick={() => onPageChange?.(pagination.page + 1)}
              aria-label="Next page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
