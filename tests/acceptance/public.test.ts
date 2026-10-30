import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connect, makeClientOrg, makeUser, uniq } from "../helpers/db";
import type { Db } from "../../src/lib/db/client";
import * as s from "../../src/lib/db/schema";
import { getPublicProduct, listPublicProducts } from "../../src/lib/public/products";
import { answerPublicQuestion } from "../../src/lib/aira/public";
import {
  MAX_ENQUIRIES_PER_EMAIL_PER_HOUR, createEnquiry, registerForHackathon,
} from "../../src/lib/public/submissions";
import { demoEnquirySchema, hackathonSchema } from "../../src/lib/validation/forms";
import { POST as enquiryRoute } from "../../src/app/api/enquiries/route";
import { POST as airaRoute } from "../../src/app/api/aira/public/route";

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", ...headers }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) };

const validEnquiry = (email = `v-${uniq()}@example.com`) =>
  demoEnquirySchema.parse({
    name: "Visitor One", email, organisation: "Example Bank", message: "We would like to see the credit simulator.",
    contactConsent: true,
  });

describe("§03 public resources are explicitly public", () => {
  it("lists only products whose audience is public", async () => {
    const tag = uniq();
    await db.insert(s.products).values([
      { slug: `pub-${tag}`, name: `Public Thing ${tag}`, category: "Test", summary: "A public product.", audience: "public" },
      { slug: `emp-${tag}`, name: `Internal Roadmap ${tag}`, category: "Test", summary: "Employee only.", audience: "employee" },
      { slug: `ten-${tag}`, name: `Tenant Thing ${tag}`, category: "Test", summary: "Tenant only.", audience: "tenant" },
    ]);
    const names = (await listPublicProducts(db)).map((p) => p.name);
    expect(names).toContain(`Public Thing ${tag}`);
    expect(names).not.toContain(`Internal Roadmap ${tag}`);
    expect(names).not.toContain(`Tenant Thing ${tag}`);
  });

  it("a non-public product is indistinguishable from one that does not exist", async () => {
    const tag = uniq();
    await db.insert(s.products).values({ slug: `emp-${tag}`, name: "Hidden", category: "Test", summary: "x", audience: "employee" });
    expect(await getPublicProduct(db, `emp-${tag}`)).toBeNull();
    expect(await getPublicProduct(db, `does-not-exist-${tag}`)).toBeNull();
  });

  it("a row cannot be stored without audience metadata, so absence can never read as public", async () => {
    await expect(
      db.insert(s.products).values({ slug: `none-${uniq()}`, name: "n", category: "c", summary: "s", audience: null as never }),
    ).rejects.toThrow();
  });
});

describe("§05/§09 public AIRA reads public content only", () => {
  it("answers from public products with citations", async () => {
    const tag = uniq();
    await db.insert(s.products).values({
      slug: `sim-${tag}`, name: `Quokkafinder ${tag}`, category: "Test",
      summary: "Quokkafinder simulates policy scenarios.", audience: "public",
    });
    const a = await answerPublicQuestion(db, `Tell me about Quokkafinder ${tag}`);
    expect(a.scope).toBe("public");
    expect(a.citations.map((c) => c.href)).toContain(`/products/sim-${tag}`);
  });

  it("never surfaces employee-only products", async () => {
    const tag = uniq();
    const secret = `Zebraproject${tag}`;
    await db.insert(s.products).values({
      slug: `z-${tag}`, name: secret, category: "Test", summary: `${secret} internal prototype notes.`, audience: "employee",
    });
    const a = await answerPublicQuestion(db, secret);
    expect(JSON.stringify(a)).not.toContain(secret);
    expect(a.citations.map((c) => c.href)).not.toContain(`/products/z-${tag}`);
  });

  it("never surfaces employee knowledge or approved shared client contributions", async () => {
    const tag = uniq();
    const kb = `Narwhalkb${tag}`;
    const shared = `Wombatshared${tag}`;
    await db.insert(s.knowledgeArticles).values({
      title: kb, body: `${kb} internal engineering note`, ownerName: "Eng", reviewDate: "2027-01-01", audience: "employee",
    });
    const org = await makeClientOrg(db);
    const u = await makeUser(db, `a-${tag}@c.example`);
    const [c] = await db.insert(s.contributions).values({
      orgId: org.id, authorId: u.id, kind: "market_observation", title: "t", body: shared, offering: "riva", status: "published",
    }).returning();
    const [p] = await db.insert(s.sharedPublications).values({
      contributionId: c.id, title: shared, body: `${shared} approved shared text`, offering: "riva",
    }).returning();
    await db.insert(s.searchDocuments).values({ publicationId: p.id, text: shared });

    for (const q of [kb, shared, `${kb} ${shared}`]) {
      const a = await answerPublicQuestion(db, q);
      const out = JSON.stringify(a);
      expect(out).not.toContain(kb);
      expect(out).not.toContain(shared);
    }
  });

  it("says plainly when it has nothing public to answer with", async () => {
    const a = await answerPublicQuestion(db, "xylophonequartz zzzqqq");
    expect(a.citations).toEqual([{ title: "Start a conversation", href: "/connect" }]);
    expect(a.answer).toMatch(/public azentio\.ai pages/);
  });

  it("the route rejects empty, oversized and cross-origin questions", async () => {
    expect((await airaRoute(post("http://localhost:3000/api/aira/public", { question: "" }, { origin: "http://localhost:3000" }), ctx)).status).toBe(400);
    expect((await airaRoute(post("http://localhost:3000/api/aira/public", { question: "x".repeat(301) }, { origin: "http://localhost:3000" }), ctx)).status).toBe(400);
    expect((await airaRoute(post("http://localhost:3000/api/aira/public", { question: "hello there" }, { origin: "http://evil.example" }), ctx)).status).toBe(403);
  });
});

describe("§07 forms: validation on client and server (shared schema)", () => {
  it.each([
    ["short name", { name: "A" }],
    ["bad email", { email: "nope" }],
    ["short organisation", { organisation: "x" }],
    ["short message", { message: "too short" }],
    ["long message", { message: "x".repeat(2001) }],
    ["no consent", { contactConsent: false }],
    ["filled honeypot", { website: "http://spam.example" }],
  ])("rejects %s", (_label, patch) => {
    const base = { name: "Visitor", email: "v@example.com", organisation: "Example", message: "A perfectly fine message.", contactConsent: true };
    expect(demoEnquirySchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it("the enquiry route enforces the schema and the origin check on the server", async () => {
    const url = "http://localhost:3000/api/enquiries";
    const bad = await enquiryRoute(post(url, { name: "A", email: "x" }, { origin: "http://localhost:3000" }), ctx);
    expect(bad.status).toBe(400);
    expect((await bad.json()).fields).toHaveProperty("email");
    const crossOrigin = await enquiryRoute(post(url, validEnquiry(), { origin: "http://evil.example" }), ctx);
    expect(crossOrigin.status).toBe(403);
    const noOrigin = await enquiryRoute(post(url, validEnquiry()), ctx);
    expect(noOrigin.status).toBe(403);
  });

  it("normalises the email address", () => {
    expect(validEnquiry("  Mixed.Case@Example.COM ").email).toBe("mixed.case@example.com");
  });
});

describe("§02 demo enquiries and hackathon interest", () => {
  it("stores a valid enquiry and records contact consent", async () => {
    const input = validEnquiry();
    expect(await createEnquiry(db, input)).toBe("stored");
    const [row] = await db.select().from(s.demoEnquiries).where(eq(s.demoEnquiries.email, input.email));
    expect(row).toMatchObject({ organisation: "Example Bank", contactConsent: true, status: "new" });
  });

  it("silently drops a honeypot submission without storing it", async () => {
    const input = { ...validEnquiry(), website: "bot" };
    expect(await createEnquiry(db, input)).toBe("ignored");
    expect(await db.select().from(s.demoEnquiries).where(eq(s.demoEnquiries.email, input.email))).toHaveLength(0);
  });

  it("rate-limits repeat enquiries per address", async () => {
    const email = `rl-${uniq()}@example.com`;
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_ENQUIRIES_PER_EMAIL_PER_HOUR + 2; i++) outcomes.push(await createEnquiry(db, validEnquiry(email)));
    expect(outcomes.filter((o) => o === "stored")).toHaveLength(MAX_ENQUIRIES_PER_EMAIL_PER_HOUR);
    expect(outcomes.at(-1)).toBe("rate_limited");
  });

  it("keeps a product reference only if that product is public", async () => {
    const tag = uniq();
    await db.insert(s.products).values([
      { slug: `p-${tag}`, name: "P", category: "T", summary: "s", audience: "public" },
      { slug: `e-${tag}`, name: "E", category: "T", summary: "s", audience: "employee" },
    ]);
    const read = async (slug: string) => {
      const input = { ...validEnquiry(), productSlug: slug };
      await createEnquiry(db, input);
      return (await db.select().from(s.demoEnquiries).where(eq(s.demoEnquiries.email, input.email)))[0].productSlug;
    };
    expect(await read(`p-${tag}`)).toBe(`p-${tag}`);
    expect(await read(`e-${tag}`)).toBeNull();
    expect(await read(`nope-${tag}`)).toBeNull();
  });

  it("registers hackathon interest once per address", async () => {
    const email = `hack-${uniq()}@example.com`;
    const input = hackathonSchema.parse({ name: "Hacker", email, interest: "Build a seasonality explainer.", contactConsent: true });
    expect(await registerForHackathon(db, input)).toBe("stored");
    expect(await registerForHackathon(db, input)).toBe("duplicate");
    expect(await db.select().from(s.hackathonRegistrations).where(eq(s.hackathonRegistrations.email, email))).toHaveLength(1);
  });

  it("requires consent to be contacted about the hackathon", () => {
    expect(hackathonSchema.safeParse({ name: "H", email: "h@example.com", interest: "something long enough", contactConsent: false }).success).toBe(false);
  });
});
