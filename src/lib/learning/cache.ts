import type { Db } from "@/lib/db/client";
import { readEpoch } from "./core";

/**
 * A process-local cache for derived feed aggregates, keyed by the database's feed epoch. Every publish,
 * unpublish and withdrawal bumps the epoch in the same transaction, so a cached value can never outlive the
 * change that invalidates it, even across several server processes.
 */
const store = new Map<string, { epoch: number; value: unknown }>();

export async function cachedByEpoch<T>(db: Db, key: string, compute: () => Promise<T>): Promise<T> {
  const epoch = await readEpoch(db);
  const hit = store.get(key);
  if (hit && hit.epoch === epoch) return hit.value as T;
  const value = await compute();
  store.set(key, { epoch, value });
  return value;
}

/** For tests: whether a value is currently cached under this key. */
export const cacheHas = (key: string) => store.has(key);
export const cacheClear = () => store.clear();
