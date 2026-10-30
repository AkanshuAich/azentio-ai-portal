import { createDb, type Db } from "./client";

// One pool per server process, surviving dev hot reloads.
const g = globalThis as unknown as { __azDb?: Db };

export function getDb(): Db {
  return (g.__azDb ??= createDb());
}
