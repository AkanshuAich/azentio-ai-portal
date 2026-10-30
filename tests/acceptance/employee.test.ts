import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import {
  auditCollector, clientPrincipal, connect, employeePrincipal, makeClientOrg, uniq,
} from "../helpers/db";
import type { Db } from "../../src/lib/db/client";
import * as s from "../../src/lib/db/schema";
import { ForbiddenError } from "../../src/lib/authz/guard";
import {
  NotFoundError, UploadRejected, activePublicBanner, assertEmployee, createArticle, createExperiment, createLiveSession,
  createReleaseNote, createTeam, getLiveSession, giveArticleFeedback, listArticles, listExperiments,
  listLiveSessions, listReleaseNotes, listTeams, runScenario, saveRunFeedback, setBanner,
  setExperimentStatus, setMediaAudience, setTeamMembership, uploadMedia,
} from "../../src/lib/employee/service";
import { SCENARIOS, getScenario } from "../../src/lib/playground/scenarios";
import { readMedia } from "../../src/lib/media/access";
import { MAX_UPLOAD_BYTES, getObject, putObject } from "../../src/lib/storage/private";

process.env.PRIVATE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "azentio-storage-"));

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("§05 playground: guided, synthetic, clearly labelled", () => {
  it("is deterministic: the same inputs always give the same output", () => {
    const sc = getScenario("credit-strategy-simulator")!;
    const p = sc.parse({ scoreCutoff: 620, segment: 0 });
    expect(JSON.stringify(sc.run(p as never))).toBe(JSON.stringify(sc.run(p as never)));
  });

  it("every scenario labels sample data and simulated output, and disclaims a real decision", () => {
    for (const sc of SCENARIOS) {
      const defaults = Object.fromEntries(sc.meta.fields.map((f) => [f.name, f.default]));
      const out = sc.run(sc.parse(defaults) as never) as { label: string; disclaimer: string; headline: string };
      expect(out.label).toBe("SAMPLE DATA · SIMULATED OUTPUT");
      expect(out.disclaimer).toMatch(/not an approved credit or business decision/);
    }
  });

  it("never presents a sandbox recommendation as an approval or decline", () => {
    const sc = getScenario("sme-credit-decisioning")!;
    for (const margin of [-5, 5, 20]) {
      const out = sc.run(sc.parse({ revenue: 2_000_000, ebitdaMarginPct: margin, debt: 500_000, currentRatioX100: 150 }) as never) as { headline: string };
      expect(out.headline).toMatch(/human review/);
      expect(out.headline).not.toMatch(/\b(approved|declined|rejected)\b/i);
    }
  });

  it("shows the seasonality trap: quarter-on-quarter looks like decline while year-on-year does not", () => {
    const sc = getScenario("financial-analysis-intelligence")!;
    const out = sc.run(sc.parse({ baseRevenue: 1_000_000, seasonalityPct: 40, annualGrowthPct: 6 }) as never) as { headline: string };
    expect(out.headline).toMatch(/reads as deterioration/);
    const flat = sc.run(sc.parse({ baseRevenue: 1_000_000, seasonalityPct: 0, annualGrowthPct: 6 }) as never) as { headline: string };
    expect(flat.headline).not.toMatch(/reads as deterioration/);
  });

  it("a lower score cutoff approves more synthetic applicants", () => {
    const sc = getScenario("credit-strategy-simulator")!;
    const rate = (c: number) => (sc.run(sc.parse({ scoreCutoff: c, segment: 0 }) as never) as { metrics: { value: string }[] }).metrics[0].value;
    expect(parseFloat(rate(550))).toBeGreaterThan(parseFloat(rate(750)));
  });

  it("rejects out-of-range and malformed parameters", () => {
    const sc = getScenario("credit-strategy-simulator")!;
    expect(() => sc.parse({ scoreCutoff: 9999, segment: 0 })).toThrow(ZodError);
    expect(() => sc.parse({ scoreCutoff: "high", segment: 0 })).toThrow(ZodError);
    expect(() => sc.parse({})).toThrow(ZodError);
  });

  it("an employee's run is stored for them with no organisation attached", async () => {
    const { user, principal } = await employeePrincipal(db);
    const { id } = await runScenario(db, principal, auditCollector().sink, "credit-strategy-simulator", { scoreCutoff: 620, segment: 0 });
    const [row] = await db.select().from(s.playgroundRuns).where(eq(s.playgroundRuns.id, id));
    expect(row).toMatchObject({ userId: user.id, orgId: null, scenarioId: "credit-strategy-simulator" });
  });

  it("is closed to clients: the employee Playground is employee-only", async () => {
    const { principal } = await clientPrincipal(db, (await makeClientOrg(db)).id);
    await expect(runScenario(db, principal, auditCollector().sink, "credit-strategy-simulator", { scoreCutoff: 620, segment: 0 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an unknown scenario is not found, and bad parameters are refused before anything is stored", async () => {
    const { user, principal } = await employeePrincipal(db);
    await expect(runScenario(db, principal, auditCollector().sink, "nope", {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(runScenario(db, principal, auditCollector().sink, "credit-strategy-simulator", { scoreCutoff: 1 })).rejects.toBeInstanceOf(ZodError);
    expect(await db.select().from(s.playgroundRuns).where(eq(s.playgroundRuns.userId, user.id))).toHaveLength(0);
  });

  it("feedback is structured, validated, and accepted only from the run's author", async () => {
    const a = await employeePrincipal(db);
    const b = await employeePrincipal(db);
    const { id } = await runScenario(db, a.principal, auditCollector().sink, "credit-strategy-simulator", { scoreCutoff: 620, segment: 0 });

    await expect(saveRunFeedback(db, b.principal, auditCollector().sink, id, { helpful: true, accuracy: 4 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveRunFeedback(db, a.principal, auditCollector().sink, id, { helpful: true, accuracy: 9 })).rejects.toBeInstanceOf(ZodError);
    await saveRunFeedback(db, a.principal, auditCollector().sink, id, { helpful: true, accuracy: 4, comment: "Clear evidence table." });
    const [row] = await db.select().from(s.playgroundRuns).where(eq(s.playgroundRuns.id, id));
    expect(row.feedback).toMatchObject({ helpful: true, accuracy: 4 });
  });
});

describe("§05 experiments, teams and the knowledge library", () => {
  it("employees submit experiments; the audience is always employee, never client-chosen", async () => {
    const { principal } = await employeePrincipal(db);
    const id = await createExperiment(db, principal, auditCollector().sink, {
      title: "Seasonality explainer", hypothesis: "A same-quarter comparison reduces false referrals.", audience: "public",
    });
    const [row] = await db.select().from(s.experiments).where(eq(s.experiments.id, id));
    expect(row.audience).toBe("employee");
  });

  it("clients can neither read nor write experiments", async () => {
    const e = await employeePrincipal(db);
    await createExperiment(db, e.principal, auditCollector().sink, { title: "Internal only", hypothesis: "Something internal to test." });
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    expect(await listExperiments(db, c.principal)).toEqual([]);
    await expect(createExperiment(db, c.principal, auditCollector().sink, { title: "Sneaky", hypothesis: "A client trying to write." })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only the owner can change an experiment's status", async () => {
    const owner = await employeePrincipal(db);
    const other = await employeePrincipal(db);
    const id = await createExperiment(db, owner.principal, auditCollector().sink, { title: "Owned experiment", hypothesis: "Owner moves this along." });
    await expect(setExperimentStatus(db, other.principal, auditCollector().sink, id, "running")).rejects.toBeInstanceOf(NotFoundError);
    await setExperimentStatus(db, owner.principal, auditCollector().sink, id, "running");
    await expect(setExperimentStatus(db, owner.principal, auditCollector().sink, id, "shipped")).rejects.toBeInstanceOf(ZodError);
  });

  it("hackathon teams: creator joins automatically, join is idempotent, leave works, clients are refused", async () => {
    const a = await employeePrincipal(db);
    const b = await employeePrincipal(db);
    const id = await createTeam(db, a.principal, auditCollector().sink, { name: `Team ${uniq()}`, description: "Building a seasonality explainer." });
    await setTeamMembership(db, b.principal, auditCollector().sink, id, "join");
    await setTeamMembership(db, b.principal, auditCollector().sink, id, "join");
    let team = (await listTeams(db, a.principal)).find((t) => t.id === id)!;
    expect(team.members).toHaveLength(2);
    await setTeamMembership(db, b.principal, auditCollector().sink, id, "leave");
    team = (await listTeams(db, a.principal)).find((t) => t.id === id)!;
    expect(team.members).toHaveLength(1);

    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    expect(await listTeams(db, c.principal)).toEqual([]);
    await expect(setTeamMembership(db, c.principal, auditCollector().sink, id, "join")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("knowledge articles carry an owner and review date, flag overdue reviews, and collect feedback", async () => {
    const { user, principal } = await employeePrincipal(db);
    const tag = uniq();
    const old = await createArticle(db, principal, auditCollector().sink, { title: `Old guide ${tag}`, body: "A guide that was reviewed a while ago and needs another look.", reviewDate: "2020-01-01" });
    const fresh = await createArticle(db, principal, auditCollector().sink, { title: `Fresh guide ${tag}`, body: "A guide with a review date comfortably in the future.", reviewDate: "2099-01-01" });

    const list = await listArticles(db, principal);
    expect(list.find((a) => a.id === old)).toMatchObject({ reviewOverdue: true, ownerName: user.displayName });
    expect(list.find((a) => a.id === fresh)!.reviewOverdue).toBe(false);

    await giveArticleFeedback(db, principal, auditCollector().sink, fresh, { useful: false });
    await giveArticleFeedback(db, principal, auditCollector().sink, fresh, { useful: true, comment: "Better now." });
    const after = (await listArticles(db, principal)).find((a) => a.id === fresh)!;
    expect(after).toMatchObject({ useful: 1, notUseful: 0 }); // second submission replaced the first
  });

  it("rejects malformed knowledge input and hides the library from clients", async () => {
    const { principal } = await employeePrincipal(db);
    await expect(createArticle(db, principal, auditCollector().sink, { title: "x", body: "short", reviewDate: "tomorrow" })).rejects.toBeInstanceOf(ZodError);
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    expect(await listArticles(db, c.principal)).toEqual([]);
    await expect(createArticle(db, c.principal, auditCollector().sink, { title: "Client doc", body: "A client trying to author an employee doc.", reviewDate: "2030-01-01" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("§06 direct API reads of employee-only collections are refused, not emptied", () => {
  it("assertEmployee: 403 for a client and an anonymous caller, allowed for an employee, and the refusal is audited", async () => {
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    const e = await employeePrincipal(db);
    const audit = auditCollector();
    await expect(assertEmployee(c.principal, audit.sink)).rejects.toMatchObject({ status: 403 });
    expect(audit.log.at(-1)).toMatchObject({ action: "read", allowed: false });
    await expect(assertEmployee(e.principal, auditCollector().sink)).resolves.toBeUndefined();
  });
});

describe("§05/§06 live sessions: employee audience enforced per record", () => {
  async function seedSessions() {
    const tag = uniq();
    const [emp] = await db.insert(s.liveSessions).values({ title: `Internal ${tag}`, streamRef: "https://stream.example/internal", audience: "employee" }).returning();
    const [pub] = await db.insert(s.liveSessions).values({ title: `Public ${tag}`, streamRef: "https://stream.example/public", audience: "public" }).returning();
    return { emp, pub };
  }

  it("lists an employee session to employees only; clients and anonymous see just public ones", async () => {
    const { emp, pub } = await seedSessions();
    const e = await employeePrincipal(db);
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    const ids = async (p: typeof e.principal | null) => (await listLiveSessions(db, p)).map((r) => r.id);
    expect(await ids(e.principal)).toEqual(expect.arrayContaining([emp.id, pub.id]));
    for (const p of [c.principal, null]) {
      const got = await ids(p);
      expect(got).toContain(pub.id);
      expect(got).not.toContain(emp.id);
    }
  });

  it("knowing an employee session's id is not enough: its stream reference is withheld", async () => {
    const { emp } = await seedSessions();
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    expect(await getLiveSession(db, c.principal, emp.id)).toBe("forbidden");
    expect(await getLiveSession(db, null, emp.id)).toBe("forbidden");
    const e = await employeePrincipal(db);
    expect(await getLiveSession(db, e.principal, emp.id)).toMatchObject({ streamRef: "https://stream.example/internal" });
    expect(await getLiveSession(db, e.principal, "not-a-uuid")).toBeNull();
  });
});

describe("IAM-02 publishing is its own grant", () => {
  it("ordinary employees, and employees holding other grants, cannot create broadcasts or release notes", async () => {
    const ordinary = await employeePrincipal(db);
    const moderator = await employeePrincipal(db, ["learning.moderate", "ideas.manage", "members.invite"]);
    for (const { principal } of [ordinary, moderator]) {
      await expect(createLiveSession(db, principal, auditCollector().sink, { title: "Town hall", audience: "employee" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createReleaseNote(db, principal, auditCollector().sink, { title: "Release 2.1", body: "Internal release notes." })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("a publisher can, and the action is audited", async () => {
    const { principal } = await employeePrincipal(db, ["media.publish"]);
    const audit = auditCollector();
    const id = await createLiveSession(db, principal, audit.sink, { title: "Quarterly town hall", audience: "employee", streamRef: "https://stream.example/qth" });
    expect(id).toBeTruthy();
    expect(audit.log.at(-1)).toMatchObject({ action: "publish_media", allowed: true, subjectType: "live_session" });
    const noteId = await createReleaseNote(db, principal, audit.sink, { title: "Release 2.1", body: "Internal release notes for the team." });
    expect((await listReleaseNotes(db, principal)).map((n) => n.id)).toContain(noteId);
  });

  it("release notes written for employees are invisible to clients", async () => {
    const pub = await employeePrincipal(db, ["media.publish"]);
    const id = await createReleaseNote(db, pub.principal, auditCollector().sink, { title: `Internal ${uniq()}`, body: "Not for clients to read." });
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);
    expect((await listReleaseNotes(db, c.principal)).map((n) => n.id)).not.toContain(id);
  });

  it("validates the broadcast: audience restricted to the console's two, stream must be a URL", async () => {
    const { principal } = await employeePrincipal(db, ["media.publish"]);
    await expect(createLiveSession(db, principal, auditCollector().sink, { title: "Bad audience", audience: "tenant" })).rejects.toBeInstanceOf(ZodError);
    await expect(createLiveSession(db, principal, auditCollector().sink, { title: "Bad stream", audience: "employee", streamRef: "javascript:alert(1)" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("§05/§03 media: private storage and gated delivery", () => {
  it("uploads need the publish grant", async () => {
    const { principal } = await employeePrincipal(db);
    await expect(uploadMedia(db, principal, auditCollector().sink, { title: "Slide", kind: "image", audience: "employee" }, "image/png", PNG)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks type, size and content, and never trusts the declared type alone", async () => {
    const { principal } = await employeePrincipal(db, ["media.publish"]);
    const meta = { title: "Slide", kind: "image", audience: "employee" };
    const up = (type: string, bytes: Uint8Array) => uploadMedia(db, principal, auditCollector().sink, meta, type, bytes);
    await expect(up("image/svg+xml", new TextEncoder().encode("<svg onload=alert(1)/>"))).rejects.toBeInstanceOf(UploadRejected);
    await expect(up("text/html", new TextEncoder().encode("<script>x</script>"))).rejects.toBeInstanceOf(UploadRejected);
    await expect(up("image/png", new TextEncoder().encode("<html>not a png</html>"))).rejects.toBeInstanceOf(UploadRejected);
    await expect(up("image/png", new Uint8Array(0))).rejects.toBeInstanceOf(UploadRejected);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PNG);
    await expect(up("image/png", big)).rejects.toBeInstanceOf(UploadRejected);
    await expect(up("image/png", PNG)).resolves.toBeTruthy();
  });

  it("stores under a server-generated key, not the client's filename", async () => {
    const { principal } = await employeePrincipal(db, ["media.publish"]);
    const id = await uploadMedia(db, principal, auditCollector().sink, { title: "../../etc/passwd", kind: "image", audience: "employee" }, "image/png", PNG);
    const [row] = await db.select().from(s.mediaAssets).where(eq(s.mediaAssets.id, id));
    expect(row.storageKey).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
  });

  it("storage refuses keys that escape its root", async () => {
    await expect(putObject("../escape.txt", PNG)).rejects.toThrow();
    await expect(getObject("../../etc/passwd")).rejects.toThrow();
  });

  it("direct media requests are decided by the asset's audience: 401 anonymous, 403 client, 200 employee", async () => {
    const pub = await employeePrincipal(db, ["media.publish"]);
    const id = await uploadMedia(db, pub.principal, auditCollector().sink, { title: "Internal recording", kind: "recording", audience: "employee" }, "image/png", PNG);
    const ordinary = await employeePrincipal(db);
    const c = await clientPrincipal(db, (await makeClientOrg(db)).id);

    expect(await readMedia(db, null, id)).toMatchObject({ status: 401 });
    expect(await readMedia(db, c.principal, id)).toMatchObject({ status: 403 });
    expect(await readMedia(db, ordinary.principal, id)).toMatchObject({ status: 200, contentType: "image/png", isPublic: false });
  });

  it("a public asset is reachable anonymously and marked cacheable", async () => {
    const pub = await employeePrincipal(db, ["media.publish"]);
    const id = await uploadMedia(db, pub.principal, auditCollector().sink, { title: "Showreel poster", kind: "image", audience: "public" }, "image/png", PNG);
    expect(await readMedia(db, null, id)).toMatchObject({ status: 200, isPublic: true });
  });

  it("malformed and unknown ids are not found, and a missing file is not found", async () => {
    expect(await readMedia(db, null, "../../etc/passwd")).toMatchObject({ status: 404 });
    expect(await readMedia(db, null, "00000000-0000-0000-0000-000000000000")).toMatchObject({ status: 404 });
    const [orphan] = await db.insert(s.mediaAssets).values({ title: "Orphan", kind: "image", storageKey: "uploads/missing.png", contentType: "image/png", byteSize: 1, audience: "public" }).returning();
    expect(await readMedia(db, null, orphan.id)).toMatchObject({ status: 404 });
  });

  it("changing audience is a publishing action: denied to others, audited, and takes effect at once in both directions", async () => {
    const pub = await employeePrincipal(db, ["media.publish"]);
    const ordinary = await employeePrincipal(db);
    const id = await uploadMedia(db, pub.principal, auditCollector().sink, { title: "Recording", kind: "recording", audience: "employee" }, "image/png", PNG);

    await expect(setMediaAudience(db, ordinary.principal, auditCollector().sink, id, "public")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await readMedia(db, null, id)).toMatchObject({ status: 401 });

    const audit = auditCollector();
    await setMediaAudience(db, pub.principal, audit.sink, id, "public");
    expect(audit.log.at(-1)).toMatchObject({ action: "publish_media", subjectType: "media_asset", subjectId: id, allowed: true });
    expect(await readMedia(db, null, id)).toMatchObject({ status: 200 });

    await setMediaAudience(db, pub.principal, auditCollector().sink, id, "employee"); // withdrawn again
    expect(await readMedia(db, null, id)).toMatchObject({ status: 401 });
    await expect(setMediaAudience(db, pub.principal, auditCollector().sink, id, "tenant")).rejects.toBeInstanceOf(ZodError);
  });

  it("attaching a recording links it to its live session", async () => {
    const pub = await employeePrincipal(db, ["media.publish"]);
    const sessionId = await createLiveSession(db, pub.principal, auditCollector().sink, { title: "Recorded session", audience: "employee" });
    const mediaId = await uploadMedia(db, pub.principal, auditCollector().sink, { title: "Recording", kind: "recording", audience: "employee", liveSessionId: sessionId }, "image/png", PNG);
    const [row] = await db.select().from(s.liveSessions).where(eq(s.liveSessions.id, sessionId));
    expect(row.recordingAssetId).toBe(mediaId);
  });
});

describe("§02 homepage banner: only publishers change public content", () => {
  it("ordinary employees cannot change the banner; a publisher can, and inactive means hidden", async () => {
    const ordinary = await employeePrincipal(db);
    const pub = await employeePrincipal(db, ["media.publish"]);
    await expect(setBanner(db, ordinary.principal, auditCollector().sink, { message: "Hacked!", active: true })).rejects.toBeInstanceOf(ForbiddenError);

    await setBanner(db, pub.principal, auditCollector().sink, { message: "Hackathon registration is open", href: "/hackathon/register", active: true });
    expect(await activePublicBanner(db)).toEqual({ message: "Hackathon registration is open", href: "/hackathon/register" });

    await setBanner(db, pub.principal, auditCollector().sink, { message: "Hackathon registration is open", active: false });
    expect(await activePublicBanner(db)).toBeNull();
  });

  it("only allows site paths or https links, never script or protocol-relative URLs", async () => {
    const { principal } = await employeePrincipal(db, ["media.publish"]);
    for (const href of ["javascript:alert(1)", "//evil.example", "http://insecure.example", "data:text/html,x"]) {
      await expect(setBanner(db, principal, auditCollector().sink, { message: "Banner", href, active: true })).rejects.toBeInstanceOf(ZodError);
    }
    await expect(setBanner(db, principal, auditCollector().sink, { message: "Banner", href: "https://www.azentio.com/", active: false })).resolves.toBeUndefined();
  });
});
