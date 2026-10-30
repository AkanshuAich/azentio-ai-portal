import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "./env";

export const sql = postgres(E2E_DATABASE_URL, { max: 2 });

/** A letters-only tag. An 8-digit run would (rightly) be flagged by the sensitive-content scan. */
export const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 8).padEnd(6, "q");

/** The six-digit code the dev outbox "sent" to an address, as the dev mailbox would show it. */
export async function latestCode(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const rows = await sql`select body from outbox_messages where to_email = ${email} and subject like '%sign-in code' order by at desc limit 1`;
    const m = rows[0]?.body?.match(/\b(\d{6})\b/);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sign-in code for ${email}`);
}

/** Signs in through the real UI: email, then the emailed code. */
export async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Work or invited email address").fill(email);
  const before = await sql`select count(*)::int as n from outbox_messages where to_email = ${email}`;
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByLabel("Sign-in code")).toBeVisible();
  // Wait for the new code row, not an older one.
  for (let i = 0; i < 20; i++) {
    const now = await sql`select count(*)::int as n from outbox_messages where to_email = ${email}`;
    if (now[0].n > before[0].n) break;
    await page.waitForTimeout(250);
  }
  await page.getByLabel("Sign-in code").fill(await latestCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

export async function persona(browser: Browser, email: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  return { ctx, page };
}
