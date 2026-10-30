import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { clientPrincipal, connect, employeePrincipal, makeClientOrg } from "../helpers/db";
import { testDatabaseUrl } from "../global-setup";
import { createSession } from "../../src/lib/auth/session";
import type { Db } from "../../src/lib/db/client";
import { and, eq } from "drizzle-orm";
import { auditEvents } from "../../src/lib/db/schema";

// The route handlers read the session cookie through next/headers. Outside a Next request there is none, so
// the cookie is stubbed with a token this test controls.
const cookie = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "az_session" && cookie.token ? { name: n, value: cookie.token } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
}));

process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";

const ROOT = path.resolve(__dirname, "../..");
const API = path.join(ROOT, "src/app/api");
const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function walk(dir: string, match: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(p)) out.push(p);
  }
  return out;
}

const routeFiles = walk(API, (f) => f.endsWith(`${path.sep}route.ts`));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const urlOf = (f: string) => "/" + rel(f).replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");

interface Handler { file: string; verb: (typeof VERBS)[number]; kind: "authedRoute" | "publicRoute" | "policyRoute" }

/** Every exported HTTP handler and the wrapper it is built with. A bare function export is a failure. */
function handlers(): { found: Handler[]; bare: string[] } {
  const found: Handler[] = [];
  const bare: string[] = [];
  for (const file of routeFiles) {
    const src = readFileSync(file, "utf8");
    for (const verb of VERBS) {
      const wrapped = src.match(new RegExp(`export const ${verb}\\s*=\\s*(authedRoute|publicRoute|policyRoute)\\(`));
      if (wrapped) found.push({ file, verb, kind: wrapped[1] as Handler["kind"] });
      else if (new RegExp(`export (async )?function ${verb}\\b|export const ${verb}\\b`).test(src)) bare.push(`${rel(file)} ${verb}`);
    }
  }
  return { found, bare };
}

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const paramsOf = (file: string) => Object.fromEntries([...file.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1], PLACEHOLDER]));

async function call(h: Handler, token: string | undefined) {
  cookie.token = token;
  const mod = await import(/* @vite-ignore */ h.file);
  const url = `http://localhost:3000${urlOf(h.file).replace(/\[([^\]]+)\]/g, PLACEHOLDER)}`;
  const mutating = h.verb !== "GET";
  const req = new Request(url, {
    method: h.verb,
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: mutating ? "{}" : undefined,
  });
  const res: Response = await mod[h.verb](req, { params: Promise.resolve(paramsOf(h.file)) });
  return res.status;
}

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

describe("IAM-01 route coverage: every API handler is built with a reviewed wrapper", () => {
  const { found, bare } = handlers();

  it("finds the routes (guards against the scan silently matching nothing)", () => {
    expect(routeFiles.length).toBeGreaterThan(70);
    expect(found.length).toBeGreaterThan(85);
  });

  it("no handler is a bare function: each is authedRoute, publicRoute or policyRoute", () => {
    expect(bare).toEqual([]);
  });

  it("the set of unauthenticated routes is exactly the reviewed list, each with a stated reason", () => {
    const publics = found.filter((h) => h.kind === "publicRoute").map((h) => `${rel(h.file)} ${h.verb}`).sort();
    expect(publics).toEqual([
      "src/app/api/aira/public/route.ts POST",
      "src/app/api/auth/request-code/route.ts POST",
      "src/app/api/auth/signout/route.ts POST",
      "src/app/api/auth/verify-code/route.ts POST",
      "src/app/api/enquiries/route.ts POST",
      "src/app/api/hackathon/register/route.ts POST",
      "src/app/api/invitations/[token]/route.ts GET",
    ]);
    for (const h of found.filter((x) => x.kind === "publicRoute")) {
      const m = readFileSync(h.file, "utf8").match(/publicRoute\(\s*"([^"]{15,})"/);
      expect(m, `${rel(h.file)} needs a reason string`).not.toBeNull();
    }
  });

  it("policyRoute (anonymous allowed, per-resource policy) is used only where each resource carries its own audience", () => {
    const policies = found.filter((h) => h.kind === "policyRoute").map((h) => `${rel(h.file)} ${h.verb}`).sort();
    expect(policies).toEqual([
      "src/app/api/live-sessions/[id]/route.ts GET",
      "src/app/api/live-sessions/route.ts GET",
      "src/app/api/media/[id]/route.ts GET",
    ]);
    // Each of them must actually run the policy engine on the resource.
    expect(readFileSync(path.join(API, "media/[id]/route.ts"), "utf8")).toMatch(/readMedia\(/);
    expect(readFileSync(path.join(API, "live-sessions/route.ts"), "utf8")).toMatch(/listLiveSessions\(/);
    expect(readFileSync(path.join(API, "live-sessions/[id]/route.ts"), "utf8")).toMatch(/getLiveSession\(/);
  });

  it("every state-changing handler refuses a cross-origin request before doing anything else", async () => {
    const mutating = found.filter((x) => x.verb !== "GET");
    const bad: string[] = [];
    for (const h of mutating) {
      cookie.token = undefined;
      const mod = await import(/* @vite-ignore */ h.file);
      const res: Response = await mod[h.verb](new Request(`http://localhost:3000${urlOf(h.file).replace(/\[([^\]]+)\]/g, PLACEHOLDER)}`, {
        method: h.verb, headers: { host: "localhost:3000", origin: "http://evil.example", "content-type": "application/json" }, body: "{}",
      }), { params: Promise.resolve(paramsOf(h.file)) });
      if (res.status !== 403) bad.push(`${rel(h.file)} ${h.verb} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
    expect(mutating.length).toBeGreaterThan(55);
  });
});

describe("IAM-01 every protected API refuses an anonymous caller", () => {
  it("authedRoute handlers return 401 with no session", async () => {
    const authed = handlers().found.filter((h) => h.kind === "authedRoute");
    const bad: string[] = [];
    for (const h of authed) { const status = await call(h, undefined); if (status !== 401) bad.push(`${rel(h.file)} ${h.verb} -> ${status}`); }
    expect(bad).toEqual([]);
    expect(authed.length).toBeGreaterThan(70);
  });

  it("a forged or garbage session cookie is no better than none", async () => {
    const authed = handlers().found.filter((h) => h.kind === "authedRoute");
    const bad: string[] = [];
    for (const h of authed) { const status = await call(h, "not-a-real-session-token"); if (status !== 401) bad.push(`${rel(h.file)} ${h.verb} -> ${status}`); }
    expect(bad).toEqual([]);
  });

  it("cross-origin state changes are refused before anything runs, even with a valid session", async () => {
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    const { token } = await createSession(db, c.user.id);
    cookie.token = token;
    const mod = await import(/* @vite-ignore */ path.join(API, "contributions/route.ts"));
    const res: Response = await mod.POST(new Request("http://localhost:3000/api/contributions", {
      method: "POST", headers: { host: "localhost:3000", origin: "http://evil.example", "content-type": "application/json" }, body: "{}",
    }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });
});

describe("IAM-01/02 a signed-in user of the wrong kind never succeeds on the other persona's APIs", () => {
  const EMPLOYEE_ONLY = ["moderation", "ideas", "publishing", "experiments", "teams", "knowledge", "release-notes", "playground"];
  const CLIENT_ONLY = ["client", "contributions", "bookmarks", "comments"];
  const topOf = (f: string) => rel(f).split("/")[3];

  async function sweep(token: string, prefixes: string[]) {
    const targets = handlers().found.filter((h) => h.kind === "authedRoute" && prefixes.includes(topOf(h.file)));
    const unexpected: string[] = [];
    for (const h of targets) {
      const status = await call(h, token);
      // Refused (401/403) or nothing to act on (404). Never a success, never a server error.
      if (![401, 403, 404, 400].includes(status)) unexpected.push(`${rel(h.file)} ${h.verb} -> ${status}`);
    }
    return { count: targets.length, unexpected };
  }

  it("a client member cannot use any employee-only API (moderation, ideas, publishing, experiments, teams, knowledge, release notes, playground)", async () => {
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id, "client_admin");
    const { token } = await createSession(db, c.user.id);
    const r = await sweep(token, EMPLOYEE_ONLY);
    expect(r.count).toBeGreaterThan(30);
    expect(r.unexpected).toEqual([]);
  });

  it("an ordinary employee (no grants) cannot use privileged APIs, and gets no access to any client workspace API", async () => {
    const e = await employeePrincipal(db);
    const { token } = await createSession(db, e.user.id);
    const priv = await sweep(token, ["moderation", "ideas", "publishing"]);
    expect(priv.unexpected).toEqual([]);
    const client = await sweep(token, CLIENT_ONLY);
    expect(client.count).toBeGreaterThan(25);
    expect(client.unexpected).toEqual([]);
  });

  it("holding ONE grant never opens another grant's APIs (grants are separate)", async () => {
    const publisher = await employeePrincipal(db, ["media.publish"]);
    const moderator = await employeePrincipal(db, ["learning.moderate"]);
    const owner = await employeePrincipal(db, ["ideas.manage"]);
    const t = async (p: { user: { id: string } }) => (await createSession(db, p.user.id)).token;
    expect((await sweep(await t(publisher), ["moderation", "ideas"])).unexpected).toEqual([]);
    expect((await sweep(await t(moderator), ["publishing", "ideas"])).unexpected).toEqual([]);
    expect((await sweep(await t(owner), ["publishing", "moderation"])).unexpected).toEqual([]);
  });
});

describe("IAM-02 authorisation comes before body handling", () => {
  it("a non-publisher gets 403 for a malformed upload, while a publisher gets 400: the grant is checked before the body is read", async () => {
    const upload = (await import(/* @vite-ignore */ path.join(API, "publishing/media/route.ts"))).POST;
    const malformed = () => new Request("http://localhost:3000/api/publishing/media", {
      method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" }, body: "{}",
    });
    const ordinary = await employeePrincipal(db);
    const publisher = await employeePrincipal(db, ["media.publish"]);
    cookie.token = (await createSession(db, ordinary.user.id)).token;
    expect((await upload(malformed(), { params: Promise.resolve({}) }) as Response).status).toBe(403);
    cookie.token = (await createSession(db, publisher.user.id)).token;
    expect((await upload(malformed(), { params: Promise.resolve({}) }) as Response).status).toBe(400);
  });
});

describe("§03 refused access decisions are audited", () => {
  it("a forged workspace switch is refused with 403 and leaves an audit record naming the actor and the target", async () => {
    const mine = await makeClientOrg(db);
    const theirs = await makeClientOrg(db);
    const c = await clientPrincipal(db, mine.id);
    cookie.token = (await createSession(db, c.user.id)).token;
    const route = (await import(/* @vite-ignore */ path.join(API, "auth/switch-workspace/route.ts"))).POST;
    const res: Response = await route(new Request("http://localhost:3000/api/auth/switch-workspace", {
      method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ orgId: theirs.id }),
    }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    const rows = await db.select().from(auditEvents).where(and(eq(auditEvents.actorId, c.user.id), eq(auditEvents.subjectType, "workspace_switch")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ allowed: false, subjectId: theirs.id });
  });
});

describe("IAM-01 page coverage: every protected page checks the server-side session itself", () => {
  // Layouts are not re-run on client-side navigation, so each page must carry its own check.
  const pages = (dir: string) => walk(path.join(ROOT, "src/app", dir), (f) => f.endsWith(`${path.sep}page.tsx`));

  it("every employee page calls guardEmployee", () => {
    const bad = pages("employee").filter((f) => !/guardEmployee\(/.test(readFileSync(f, "utf8"))).map(rel);
    expect(bad).toEqual([]);
    expect(pages("employee").length).toBeGreaterThan(10);
  });

  it("every client workspace page calls guardClient", () => {
    const bad = pages("workspace").filter((f) => !/guardClient\(/.test(readFileSync(f, "utf8"))).map(rel);
    expect(bad).toEqual([]);
    expect(pages("workspace").length).toBeGreaterThan(10);
  });

  it("grant-specific pages ask for their grant", () => {
    const need: Record<string, string> = {
      "employee/publishing/page.tsx": "media.publish", "employee/moderation/page.tsx": "learning.moderate",
      "employee/moderation/[id]/page.tsx": "learning.moderate", "employee/themes/page.tsx": "learning.moderate",
      "employee/ideas/page.tsx": "ideas.manage", "employee/ideas/[id]/page.tsx": "ideas.manage",
    };
    for (const [p, grant] of Object.entries(need)) expect(readFileSync(path.join(ROOT, "src/app", p), "utf8"), p).toContain(`guardEmployee("${grant}")`);
  });

  it("the development mailbox does not exist in production", () => {
    expect(readFileSync(path.join(ROOT, "src/app/dev/mailbox/page.tsx"), "utf8")).toMatch(/NODE_ENV === "production"\) notFound\(\)/);
  });

  it("no page or route reads a tenant id from the request: the active organisation always comes from the session", () => {
    const bad: string[] = [];
    for (const f of [...routeFiles, ...pages("workspace")]) {
      const src = readFileSync(f, "utf8");
      if (/searchParams\.get\(["'](org|orgId|tenant|tenantId)["']\)/.test(src)) bad.push(rel(f));
      if (/params\.(orgId|tenantId)\b/.test(src)) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
});
