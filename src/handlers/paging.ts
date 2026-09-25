/**
 * MSM paging. Tools expose `offset`/`limit`; MSM list endpoints take a
 * `from`/`to` window. Every MSM list tool goes through these two helpers so
 * the mapping and the paging metadata stay identical across tools.
 */
import type { MsmPage } from "@wyre-ai/node-kpn";
import { optionalNumber, ToolInputError } from "./results.js";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Validated `offset` (default 0) and `limit` (default 20, 1–100) from tool args. */
export function readPaging(args: Record<string, unknown>): { offset: number; limit: number } {
  const offset = optionalNumber(args, "offset") ?? 0;
  const limit = optionalNumber(args, "limit") ?? DEFAULT_LIMIT;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ToolInputError('Argument "offset" must be an integer >= 0.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ToolInputError(`Argument "limit" must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  return { offset, limit };
}

/** Map tool `offset`/`limit` to the MSM `{ from, to }` window. */
export function toMsmPage(args: Record<string, unknown>): { from: number; to: number } {
  const { offset, limit } = readPaging(args);
  return { from: offset, to: offset + limit };
}

/** Paging metadata to return next to a page of results. */
export function pageMeta(
  page: MsmPage<unknown>,
  offset: number,
  limit: number
): { total: number; offset: number; limit: number; returned: number; hasMore: boolean } {
  const returned = page.result.length;
  return { total: page.total, offset, limit, returned, hasMore: offset + returned < page.total };
}
