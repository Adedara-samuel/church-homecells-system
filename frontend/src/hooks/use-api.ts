'use client';

import * as React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import type { Query } from '@/services';

/** Query key roots, so an invalidation can target one module precisely. */
export const queryKeys = {
  dashboard: ['dashboard'] as const,
  zones: ['zones'] as const,
  areas: ['areas'] as const,
  homecells: ['homecells'] as const,
  members: ['members'] as const,
  users: ['users'] as const,
  transfers: ['transfers'] as const,
  attendance: ['attendance'] as const,
  finance: ['finance'] as const,
  remittances: ['remittances'] as const,
  payments: ['payments'] as const,
  notifications: ['notifications'] as const,
  reports: ['reports'] as const,
  sms: ['sms'] as const,
  audit: ['audit'] as const,
  settings: ['settings'] as const,
};

export function useApiQuery<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T, ApiError>({ queryKey: key, queryFn: fetcher, ...options });
}

export interface ApiMutationOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'> {
  /** Toast shown on success; omit for silent mutations. */
  successMessage?: string | ((data: TData) => string);
  /** Query key roots to invalidate once the mutation settles. */
  invalidates?: readonly (readonly unknown[])[];
}

/**
 * Mutation wrapper that handles the three things every mutation in this app needs:
 * a success toast, a readable error toast built from the API's own message, and
 * cache invalidation.
 */
export function useApiMutation<TData, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  { successMessage, invalidates, onSuccess, onError, ...options }: ApiMutationOptions<TData, TVariables> = {},
) {
  const queryClient = useQueryClient();

  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    onSuccess: (data, variables, context, mutation) => {
      if (successMessage) {
        toast.success(typeof successMessage === 'function' ? successMessage(data) : successMessage);
      }
      for (const key of invalidates ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      onSuccess?.(data, variables, context, mutation);
    },
    onError: (error, variables, context, mutation) => {
      toast.error(error.message || 'The request failed. Please try again.', {
        description:
          Array.isArray(error.details) && error.details.length > 0
            ? (error.details as { message?: string }[])
                .map((d) => d.message)
                .filter(Boolean)
                .join(' · ')
            : undefined,
      });
      onError?.(error, variables, context, mutation);
    },
    ...options,
  });
}

/**
 * List-screen state: page, page size, sort, debounced search and filters, plus the
 * query object to hand straight to a service call.
 */
export function useListQuery(initial: Query = {}) {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(20);
  const [sort, setSort] = React.useState<{ field?: string; order: 'asc' | 'desc' }>({
    order: 'desc',
  });
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [filters, setFilters] = React.useState<Query>(initial);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const setFilter = React.useCallback((key: string, value: string | number | undefined) => {
    setFilters((current) => {
      const next = { ...current };
      // Sentinel used by Select components, which cannot hold an empty value.
      if (value === undefined || value === '' || value === 'ALL') delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(1);
  }, []);

  const resetFilters = React.useCallback(() => {
    setFilters(initial);
    setSearch('');
    setPage(1);
    // `initial` is a literal at every call site, so this is intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = React.useMemo<Query>(
    () => ({
      page,
      limit,
      ...(sort.field ? { sort: sort.field, order: sort.order } : { order: sort.order }),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...filters,
    }),
    [page, limit, sort, debouncedSearch, filters],
  );

  const activeFilterCount = React.useMemo(
    () => Object.keys(filters).filter((key) => filters[key] !== undefined).length,
    [filters],
  );

  return {
    query,
    page,
    setPage,
    limit,
    setLimit: (value: number) => {
      setLimit(value);
      setPage(1);
    },
    sort,
    setSort: (field: string, order: 'asc' | 'desc') => setSort({ field, order }),
    search,
    setSearch,
    filters,
    setFilter,
    resetFilters,
    activeFilterCount,
  };
}
