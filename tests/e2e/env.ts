export const E2E_PORT = 3101;
export const E2E_DB_NAME = "azentio_e2e";

/** Derived from the same server as DATABASE_URL (.env.local), pointing at the isolated e2e database. */
export function e2eDatabaseUrl(base = process.env.DATABASE_URL): string {
  const u = new URL(base ?? "postgres://azentio:azentio_dev_only@localhost:5433/azentio_ai");
  u.pathname = `/${E2E_DB_NAME}`;
  return u.toString();
}

export const E2E_DATABASE_URL = e2eDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://azentio:azentio_dev_only@localhost:5433/azentio_ai",
);
