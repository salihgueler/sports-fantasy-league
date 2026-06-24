/**
 * Shared helpers for the scoring pipeline Lambda handlers.
 */

import { FantasyRepository } from '@fantasy/shared';

export type ScoringMode = 'live' | 'reconcile';

/** Normalize an incoming mode value, defaulting to 'live'. */
export function normalizeMode(mode: unknown): ScoringMode {
  return mode === 'reconcile' ? 'reconcile' : 'live';
}

/** Construct a repository from the TABLE_NAME environment variable. */
export function getScoringRepository(): FantasyRepository {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return new FantasyRepository({ tableName });
}

/** Query helper that transparently follows pagination to completion. */
export async function queryAll<T extends Record<string, unknown>>(
  repo: FantasyRepository,
  options: Parameters<FantasyRepository['query']>[0],
): Promise<T[]> {
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await repo.query<T>({ ...options, exclusiveStartKey: startKey });
    items.push(...(result.items as T[]));
    startKey = result.lastEvaluatedKey;
  } while (startKey);
  return items;
}
