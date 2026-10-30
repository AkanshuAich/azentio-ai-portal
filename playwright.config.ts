import { defineConfig } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_PORT } from "./tests/e2e/env";

// Persona journeys run against an isolated database (azentio_e2e), freshly migrated and seeded, and a real dev
// server. The browser is the one already installed (Edge by default, or set E2E_CHANNEL=chrome), so no browser
// binary is downloaded.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    channel: process.env.E2E_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/signin`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
      APP_URL: `http://localhost:${E2E_PORT}`,
      MAIL_TRANSPORT: "dev",
      // AIRA must use its deterministic fallback in e2e: no external calls.
      ANTHROPIC_API_KEY: "",
      PRIVATE_STORAGE_DIR: "./storage-e2e",
    },
  },
});
