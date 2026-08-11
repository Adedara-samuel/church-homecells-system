import type { FilterQuery, Model, PopulateOptions } from 'mongoose';
import { buildPagination, type Paginated } from './http';

export interface PaginateOptions<T> {
  filter: FilterQuery<T>;
  page: number;
  limit: number;
  sort?: Record<string, 1 | -1>;
  select?: string;
  populate?: PopulateOptions | (PopulateOptions | string)[] | string;
  /** Extra pipeline-free post-processing applied to each lean document. */
  transform?: (doc: unknown) => unknown;
}

/**
 * Server-side pagination used by every list endpoint.
 * Count and page fetch run concurrently; documents come back lean.
 */
export async function paginate<T>(
  model: Model<T>,
  options: PaginateOptions<T>,
): Promise<Paginated<unknown>> {
  const { filter, page, limit, sort, select, populate, transform } = options;
  const skip = (page - 1) * limit;

  let query = model.find(filter).sort(sort ?? { createdAt: -1 }).skip(skip).limit(limit);
  if (select) query = query.select(select);
  if (populate) query = query.populate(populate as never);

  const [items, total] = await Promise.all([
    query.lean().exec(),
    model.countDocuments(filter).exec(),
  ]);

  return {
    items: transform ? items.map(transform) : items,
    pagination: buildPagination(page, limit, total),
  };
}

/**
 * Builds a case-insensitive "contains" filter across several fields.
 * Preferred over `$text` for short prefixes typed into a search box, where users
 * expect partial matches; `$text` indexes remain available for whole-word queries.
 */
export function searchFilter(search: string | undefined, fields: string[]): FilterQuery<unknown> {
  const term = search?.trim();
  if (!term) return {};
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'i');
  return { $or: fields.map((field) => ({ [field]: rx })) };
}

/** Merges filter fragments, combining any `$or` clauses under a single `$and`. */
export function mergeFilters<T>(...filters: (FilterQuery<T> | undefined)[]): FilterQuery<T> {
  const present = filters.filter(Boolean) as FilterQuery<T>[];
  const withOr = present.filter((f) => '$or' in f);
  const plain = present.filter((f) => !('$or' in f));

  const merged = Object.assign({}, ...plain) as FilterQuery<T>;
  if (withOr.length === 0) return merged;
  if (withOr.length === 1 && Object.keys(withOr[0]).length === 1) {
    return { ...merged, ...withOr[0] };
  }
  return { ...merged, $and: withOr } as FilterQuery<T>;
}
