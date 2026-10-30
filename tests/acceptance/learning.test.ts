import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import {
  auditCollector, clientPrincipal, connect, employeePrincipal, ensureProduct, makeClientOrg, makeUser, principalIn, uniq as uniqRaw,
} from "../helpers/db";
import type { Db } from "../../src/lib/db/client";
import * as s from "../../src/lib/db/schema";
import { ForbiddenError } from "../../src/lib/authz/guard";
import { LifecycleError } from "../../src/lib/learning/lifecycle";
import { NotFoundError } from "../../src/lib/employee/service";
import {
  consentHistory, createDraft, currentConsents, getContribution, listMine, listOrganisation, setConsents,
  shareWithOrganisation, submitContribution, updateContribution, withdrawMine,
} from "../../src/lib/learning/contributions";
import {
  dismissReport, listOpenReports, listQueue, openReview, publishReviewed, rejectContribution, requestClarification,
  restore, saveReviewDraft, startReview, unpublish, withdrawByModerator,
} from "../../src/lib/learning/moderation";
import {
  exportCsv, feedbackSummary, getPublication, giveFeedback, listSavedSearches, reportPublication, saveSearch, searchFeed, suggest,
  deleteSavedSearch,
} from "../../src/lib/learning/feed";
import { createTheme, linkThemeEvidence, listThemes } from "../../src/lib/learning/themes";
import { createIdea, getIdea, linkIdeaEvidence, publishClientUpdate, updateIdeaStatus } from "../../src/lib/learning/ideas";
import { cacheClear } from "../../src/lib/learning/cache";
import { findForbiddenKey } from "../../src/lib/learning/dto";
import { listNotifications } from "../../src/lib/notifications/inapp";
import { readEpoch } from "../../src/lib/learning/core";

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

// Tags are letters only: an 8-digit run is (rightly) flagged by the scanner as a possible account number.
const uniq = () => uniqRaw().replace(/[0-9]/g, (d) => "ghijklmnop"[Number(d)]);
const FAI = "financial-analysis-intelligence";
const sink = () => auditCollector().sink;
const CONSENT = { store_process: true, publish_shared: true };

const fields = (o: Record<string, unknown> = {}) => ({
  kind: "market_observation", title: `Seasonal cash flow ${uniq()}`,
  body: "Seasonal SMEs can look weaker in off-season quarters when ratios are compared with the prior quarter alone.",
  offering: FAI, industry: "Banking", region: "GCC", observationPeriod: "2026-H1", evidenceType: "client_experience",
  confidence: "medium", sharingChoice: "propose_shared", ...o,
});

type P = Awaited<ReturnType<typeof clientPrincipal>>;
type M = Awaited<ReturnType<typeof employeePrincipal>>;

async function author(orgId?: string): Promise<P> {
  await ensureProduct(db, FAI);
  return clientPrincipal(db, orgId ?? (await makeClientOrg(db)).id);
}
const moderator = (): Promise<M> => employeePrincipal(db, ["learning.moderate"]);

async function proposed(a: P, over: Record<string, unknown> = {}, consents: Record<string, boolean> = CONSENT) {
  const { id } = await createDraft(db, a.principal, sink(), fields(over), consents);
  await submitContribution(db, a.principal, sink(), id);
  return id;
}

const reviewed = (tag: string, over: Record<string, unknown> = {}) => ({
  title: `Seasonality signal ${tag}`,
  body: "Off-season quarters can look weaker for seasonal SMEs when ratios use only the prior quarter.",
  offering: FAI, industry: "Banking", region: "Regional", observationPeriod: "2026-H1", evidenceType: "client_experience", confidence: "medium",
  topic: "market_observation", attribution: "anonymous", ...over,
});

/** Takes a submitted item through review to publication. Returns the publication id. */
async function publish(m: M, id: string, over: Record<string, unknown> = {}, tag = uniq()) {
  await startReview(db, m.principal, sink(), id);
  await saveReviewDraft(db, m.principal, sink(), id, reviewed(tag, over));
  return { ...(await publishReviewed(db, m.principal, sink(), id)), tag };
}

async function live(a: P, m: M, over: Record<string, unknown> = {}) {
  const id = await proposed(a, over);
  const p = await publish(m, id);
  return { id, ...p };
}

const visibleTitles = async (p: M["principal"] | P["principal"], q?: string) =>
  (await searchFeed(db, p, sink(), { q })).items.map((i) => i.title);

// =====================================================================================================
describe("§07 capture: private by default, saving never shares", () => {
  it("a new contribution is a private draft that only its author can read", async () => {
    const a = await author();
    const colleague = await clientPrincipal(db, a.principal.activeOrgId!);
    const other = await author();
    const mod = await moderator();
    const { id } = await createDraft(db, a.principal, sink(), fields({ sharingChoice: "private" }), { store_process: true });

    expect((await getContribution(db, a.principal, sink(), id)).status).toBe("draft");
    expect((await listMine(db, a.principal)).map((c) => c.id)).toContain(id);
    expect((await listOrganisation(db, colleague.principal)).map((c) => c.id)).not.toContain(id);
    await expect(getContribution(db, colleague.principal, sink(), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getContribution(db, other.principal, sink(), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(openReview(db, mod.principal, sink(), id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await visibleTitles(a.principal)).not.toContain(fields().title);
  });

  it("choosing 'within my organisation' and saving does NOT share it; only the explicit action does", async () => {
    const a = await author();
    const colleague = await clientPrincipal(db, a.principal.activeOrgId!);
    const { id } = await createDraft(db, a.principal, sink(), fields({ sharingChoice: "organisation" }), { store_process: true });
    await updateContribution(db, a.principal, sink(), id, fields({ sharingChoice: "organisation", title: "Edited but still private" }));
    expect((await listOrganisation(db, colleague.principal)).map((c) => c.id)).not.toContain(id);

    await shareWithOrganisation(db, a.principal, sink(), id, true);
    expect((await listOrganisation(db, colleague.principal)).map((c) => c.id)).toContain(id);
    expect((await getContribution(db, colleague.principal, sink(), id)).isAuthor).toBe(false);

    await shareWithOrganisation(db, a.principal, sink(), id, false);
    expect((await listOrganisation(db, colleague.principal)).map((c) => c.id)).not.toContain(id);
  });

  it("cannot share with the organisation unless that was chosen, nor by anyone but the author, nor across tenants", async () => {
    const a = await author();
    const colleague = await clientPrincipal(db, a.principal.activeOrgId!);
    const other = await author();
    const { id } = await createDraft(db, a.principal, sink(), fields({ sharingChoice: "private" }), { store_process: true });
    await expect(shareWithOrganisation(db, a.principal, sink(), id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await updateContribution(db, a.principal, sink(), id, fields({ sharingChoice: "organisation" }));
    await expect(shareWithOrganisation(db, colleague.principal, sink(), id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(shareWithOrganisation(db, other.principal, sink(), id, true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("moving away from 'within my organisation' stops sharing at once", async () => {
    const a = await author();
    const colleague = await clientPrincipal(db, a.principal.activeOrgId!);
    const { id } = await createDraft(db, a.principal, sink(), fields({ sharingChoice: "organisation" }), { store_process: true });
    await shareWithOrganisation(db, a.principal, sink(), id, true);
    await updateContribution(db, a.principal, sink(), id, fields({ sharingChoice: "private" }));
    expect((await listOrganisation(db, colleague.principal)).map((c) => c.id)).not.toContain(id);
  });

  it("validates on the server: required fields, lengths, kinds, and a real offering", async () => {
    const a = await author();
    const bad = (o: Record<string, unknown>) => createDraft(db, a.principal, sink(), fields(o), { store_process: true });
    await expect(bad({ title: "x" })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ title: "x".repeat(141) })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ body: "x".repeat(4001) })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ kind: "rumour" })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ offering: `ghost-${uniq()}` })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an employee or a user with no client workspace cannot create contributions", async () => {
    const emp = await employeePrincipal(db, ["learning.moderate"]);
    await expect(createDraft(db, emp.principal, sink(), fields(), { store_process: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("flags likely-sensitive content for review, stores only the kinds, and still allows the draft", async () => {
    const a = await author();
    const org = await makeClientOrg(db, `Zebra Holdings ${uniq()}`);
    const r = await createDraft(db, a.principal, sink(), fields({ body: `Contact jane@zebra.example about account 123456789012 at ${org.name}. Total $2,500,000.` }), { store_process: true });
    expect(r.sensitiveFlags).toEqual(expect.arrayContaining(["email", "account_number", "currency_amount", "known_name"]));
    const [row] = await db.select().from(s.contributions).where(eq(s.contributions.id, r.id));
    expect(JSON.stringify(row.sensitiveFlags)).not.toContain("jane@zebra");
  });
});

describe("§09 consent: four independent permissions with history", () => {
  it("storing is required to save; the others default to off", async () => {
    const a = await author();
    // Consent to store is explicit: false and absent are both refused.
    await expect(createDraft(db, a.principal, sink(), fields(), { store_process: false })).rejects.toBeInstanceOf(ZodError);
    await expect(createDraft(db, a.principal, sink(), fields(), {})).rejects.toBeInstanceOf(ZodError);
    const { id } = await createDraft(db, a.principal, sink(), fields(), { store_process: true });
    expect(await currentConsents(db, id)).toEqual({ store_process: true, publish_shared: false, attribution: false, model_training: false });
  });

  it("each permission changes independently and every change is appended to the history", async () => {
    const a = await author();
    const { id } = await createDraft(db, a.principal, sink(), fields(), { store_process: true });
    await setConsents(db, a.principal, sink(), id, { publish_shared: true });
    await setConsents(db, a.principal, sink(), id, { model_training: true });
    await setConsents(db, a.principal, sink(), id, { publish_shared: false });
    expect(await currentConsents(db, id)).toMatchObject({ publish_shared: false, model_training: true, attribution: false });
    const history = await consentHistory(db, id);
    expect(history.filter((h) => h.kind === "publish_shared").map((h) => h.granted).sort()).toEqual([false, true]);
    expect(history.length).toBeGreaterThanOrEqual(4);
  });

  it("an unchanged value writes no new history row", async () => {
    const a = await author();
    const { id } = await createDraft(db, a.principal, sink(), fields(), { store_process: true });
    const before = (await consentHistory(db, id)).length;
    await setConsents(db, a.principal, sink(), id, { attribution: false });
    expect((await consentHistory(db, id)).length).toBe(before);
  });

  it("publishing permission is required to submit; membership alone is not consent", async () => {
    const a = await author();
    const { id } = await createDraft(db, a.principal, sink(), fields(), { store_process: true });
    await expect(submitContribution(db, a.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError);
    await setConsents(db, a.principal, sink(), id, { publish_shared: true });
    await expect(submitContribution(db, a.principal, sink(), id)).resolves.toMatchObject({ status: "submitted" });
  });

  it("storing cannot be revoked in place (withdraw instead), and only the author can change consents", async () => {
    const a = await author();
    const colleague = await clientPrincipal(db, a.principal.activeOrgId!);
    const { id } = await createDraft(db, a.principal, sink(), fields({ sharingChoice: "organisation" }), { store_process: true });
    await shareWithOrganisation(db, a.principal, sink(), id, true);
    await expect(setConsents(db, a.principal, sink(), id, { store_process: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setConsents(db, colleague.principal, sink(), id, { model_training: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("training consent is only recorded: nothing in the system reads it to train anything", async () => {
    const a = await author();
    const mod = await moderator();
    const id = await proposed(a, {}, { ...CONSENT, model_training: true });
    await publish(mod, id);
    expect((await currentConsents(db, id)).model_training).toBe(true);
    const detail = await getContribution(db, a.principal, sink(), id);
    expect(detail.visibility.find((v) => v.version === "Model training")?.use).toMatch(/No model is trained/);
  });
});

describe("§08 submit: validation, flags, and who may act", () => {
  it("requires every reviewer-facing field, and only community-proposed items can be submitted", async () => {
    const a = await author();
    const mk = (o: Record<string, unknown>) => createDraft(db, a.principal, sink(), fields(o), CONSENT).then((r) => r.id);
    for (const o of [{ body: "too short" }, { industry: "" }, { region: "" }, { observationPeriod: "" }, { evidenceType: undefined }, { confidence: undefined }]) {
      await expect(submitContribution(db, a.principal, sink(), await mk(o)), JSON.stringify(o)).rejects.toBeInstanceOf(ZodError);
    }
    await expect(submitContribution(db, a.principal, sink(), await mk({ sharingChoice: "private" }))).rejects.toBeInstanceOf(ZodError);
    await expect(submitContribution(db, a.principal, sink(), await mk({ sharingChoice: "organisation" }))).rejects.toBeInstanceOf(ZodError);
  });

  it("submission moves it to submitted, tells the author in-app, and records an audited, author-visible event", async () => {
    const a = await author();
    const audit = auditCollector();
    const { id } = await createDraft(db, a.principal, audit.sink, fields(), CONSENT);
    await submitContribution(db, a.principal, audit.sink, id);
    expect(audit.log.find((r) => r.detail?.to === "submitted")).toMatchObject({ actorId: a.user.id, allowed: true, detail: { from: "draft", to: "submitted" } });
    const d = await getContribution(db, a.principal, sink(), id);
    expect(d.timeline.map((t) => t.to)).toEqual(["submitted", "draft"]);
    expect((await listNotifications(db, a.user.id)).some((n) => /Submitted for review/.test(n.message))).toBe(true);
  });

  it("flagged content may be submitted but is marked for the moderator", async () => {
    const a = await author();
    const { id } = await createDraft(db, a.principal, sink(), fields({ body: "We called +971 4 123 4567 about the shortfall at the branch and it was a problem for them." }), CONSENT);
    const r = await submitContribution(db, a.principal, sink(), id);
    expect(r.sensitiveFlags).toContain("phone");
  });

  it("only the author can submit or withdraw, and a submitted item cannot be edited or re-submitted", async () => {
    const a = await author();
    const colleague = await clientPrincipal(db, a.principal.activeOrgId!);
    const id = await proposed(a);
    await expect(submitContribution(db, colleague.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withdrawMine(db, colleague.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateContribution(db, a.principal, sink(), id, fields())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitContribution(db, a.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// =====================================================================================================
describe("§08 moderation: review, redact, clarify, reject, publish", () => {
  it("is limited to holders of the learning.moderate grant", async () => {
    const a = await author();
    const id = await proposed(a);
    const ordinary = await employeePrincipal(db);
    const publisherOnly = await employeePrincipal(db, ["media.publish", "ideas.manage"]);
    for (const e of [ordinary, publisherOnly, a]) {
      await expect(listQueue(db, e.principal, sink())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(openReview(db, e.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(startReview(db, e.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("the moderation grant is not access to drafts or to organisation-only items", async () => {
    const a = await author();
    const mod = await moderator();
    const { id: draft } = await createDraft(db, a.principal, sink(), fields(), CONSENT);
    const { id: orgOnly } = await createDraft(db, a.principal, sink(), fields({ sharingChoice: "organisation" }), { store_process: true });
    await shareWithOrganisation(db, a.principal, sink(), orgOnly, true);
    await expect(openReview(db, mod.principal, sink(), draft)).rejects.toBeInstanceOf(NotFoundError);
    await expect(openReview(db, mod.principal, sink(), orgOnly)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listQueue(db, mod.principal, sink())).map((q) => q.id)).not.toContain(draft);
  });

  it("opening a private source is audited, and the moderator sees live scan matches only there", async () => {
    const a = await author();
    const mod = await moderator();
    const { id } = await createDraft(db, a.principal, sink(), fields({ body: "Reach jane@zebra.example regarding the facility of $2,500,000 which was approved in the quarter." }), CONSENT);
    await submitContribution(db, a.principal, sink(), id);
    const audit = auditCollector();
    const r = await openReview(db, mod.principal, audit.sink, id);
    expect(audit.log.some((x) => x.subjectType === "contribution_review_read" && x.allowed)).toBe(true);
    expect(r.sourceFlags.map((f) => f.kind)).toEqual(expect.arrayContaining(["email", "currency_amount"]));
  });

  it("walks submitted -> in_review -> returned (public reason) -> amended -> resubmitted; reviewer notes stay private", async () => {
    const a = await author();
    const mod = await moderator();
    const id = await proposed(a);
    await startReview(db, mod.principal, sink(), id);
    await requestClarification(db, mod.principal, sink(), id, { reason: "Please confirm the observation period." }, "PRIVATE reviewer note: author seems unsure");

    let d = await getContribution(db, a.principal, sink(), id);
    expect(d.status).toBe("returned");
    expect(d.timeline[0]).toMatchObject({ to: "returned", note: "Please confirm the observation period." });
    expect(JSON.stringify(d)).not.toContain("PRIVATE reviewer note");
    expect((await listNotifications(db, a.user.id)).some((n) => /Please confirm the observation period/.test(n.message))).toBe(true);
    expect(d.canEdit).toBe(true);

    await updateContribution(db, a.principal, sink(), id, fields({ observationPeriod: "2026-Q2" }));
    await submitContribution(db, a.principal, sink(), id);
    d = await getContribution(db, a.principal, sink(), id);
    expect(d.status).toBe("submitted");
    expect(d.timeline.some((t) => t.note === "Amended and resubmitted")).toBe(true);

    // The moderator's own view does include the private note.
    await startReview(db, mod.principal, sink(), id);
    expect(JSON.stringify(await openReview(db, mod.principal, sink(), id))).toContain("PRIVATE reviewer note");
  });

  it("rejection needs a public reason, is final, and tells the author", async () => {
    const a = await author();
    const mod = await moderator();
    const id = await proposed(a);
    await expect(rejectContribution(db, mod.principal, sink(), id, { reason: "no" })).rejects.toBeInstanceOf(ZodError);
    await rejectContribution(db, mod.principal, sink(), id, { reason: "Duplicate of an existing contribution." });
    expect((await getContribution(db, a.principal, sink(), id)).status).toBe("rejected");
    await expect(startReview(db, mod.principal, sink(), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateContribution(db, a.principal, sink(), id, fields())).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listNotifications(db, a.user.id)).some((n) => /Duplicate of an existing contribution/.test(n.message))).toBe(true);
  });

  it("publication needs a review in progress, a prepared reviewed copy, and the author's permission", async () => {
    const a = await author();
    const mod = await moderator();
    const id = await proposed(a);
    await expect(publishReviewed(db, mod.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError); // not started
    await startReview(db, mod.principal, sink(), id);
    await expect(publishReviewed(db, mod.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError); // no reviewed copy
    await saveReviewDraft(db, mod.principal, sink(), id, reviewed(uniq()));
    await setConsents(db, a.principal, sink(), id, { publish_shared: false }).catch(() => undefined);
    await db.insert(s.consents).values({ contributionId: id, kind: "publish_shared", granted: false });
    await expect(publishReviewed(db, mod.principal, sink(), id)).rejects.toBeInstanceOf(ForbiddenError); // permission withdrawn
  });

  it("blocks publication while the reviewed copy still contains likely-sensitive content, unless explicitly confirmed", async () => {
    const a = await author();
    const mod = await moderator();
    const id = await proposed(a);
    await startReview(db, mod.principal, sink(), id);
    const r = await saveReviewDraft(db, mod.principal, sink(), id, reviewed(uniq(), { body: "Reach jane@zebra.example about the shortfall noted in the quarter." }));
    expect(r.flags.map((f) => f.kind)).toContain("email");
    await expect(publishReviewed(db, mod.principal, sink(), id)).rejects.toThrow(/likely-sensitive/);
    await expect(publishReviewed(db, mod.principal, sink(), id, { confirmReviewedCopyIsSafe: true })).resolves.toBeTruthy();
  });

  it("the shared version is built from the reviewed copy only: identifying source text never reaches it", async () => {
    const a = await author();
    const mod = await moderator();
    const secret = `Zebracorp-${uniq()}`;
    const id = await proposed(a, { title: `About ${secret}`, body: `${secret} saw seasonal swings. Contact ceo@${secret.toLowerCase()}.example for the case file and 2026-03-14 details.` });
    const { publicationId, tag } = await publish(mod, id);

    const [pub] = await db.select().from(s.sharedPublications).where(eq(s.sharedPublications.id, publicationId));
    expect(JSON.stringify(pub)).not.toContain(secret);
    expect(pub.title).toBe(`Seasonality signal ${tag}`);

    const found = await searchFeed(db, a.principal, sink(), { q: tag });
    expect(JSON.stringify(found)).not.toContain(secret);
    const [src] = await db.select().from(s.contributions).where(eq(s.contributions.id, id));
    expect(src.body).toContain(secret); // the private source is untouched
    const docs = await db.select().from(s.searchDocuments).where(eq(s.searchDocuments.publicationId, publicationId));
    const chunks = await db.select().from(s.airaChunks).where(eq(s.airaChunks.publicationId, publicationId));
    expect(JSON.stringify([docs, chunks])).not.toContain(secret);
    expect(docs).toHaveLength(1);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("is anonymous by default; naming the organisation needs the author's opt-in AND the moderator's approval", async () => {
    const a = await author();
    const mod = await moderator();
    const id = await proposed(a);
    await startReview(db, mod.principal, sink(), id);
    await expect(saveReviewDraft(db, mod.principal, sink(), id, reviewed(uniq(), { attribution: "organisation" }))).rejects.toBeInstanceOf(ForbiddenError);

    await setConsents(db, a.principal, sink(), id, { attribution: true });
    const tag = uniq();
    await saveReviewDraft(db, mod.principal, sink(), id, reviewed(tag, { attribution: "organisation" }));
    await publishReviewed(db, mod.principal, sink(), id);
    const hit = (await searchFeed(db, a.principal, sink(), { q: tag })).items[0];
    expect(hit.contributor).toBeTruthy();

    const b = await author();
    const id2 = await proposed(b);
    const p2 = await publish(mod, id2);
    expect((await searchFeed(db, a.principal, sink(), { q: p2.tag })).items[0].contributor).toBeNull();
  });

  it("two moderators racing to publish: exactly one wins and the item is listed once", async () => {
    const a = await author();
    const m1 = await moderator();
    const m2 = await moderator();
    const id = await proposed(a);
    await startReview(db, m1.principal, sink(), id);
    const tag = uniq();
    await saveReviewDraft(db, m1.principal, sink(), id, reviewed(tag));
    const results = await Promise.allSettled([publishReviewed(db, m1.principal, sink(), id), publishReviewed(db, m2.principal, sink(), id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await searchFeed(db, a.principal, sink(), { q: tag })).items).toHaveLength(1);
  });

  it("every transition writes an audit event with actor, from and to", async () => {
    const a = await author();
    const mod = await moderator();
    const audit = auditCollector();
    const id = await proposed(a);
    await startReview(db, mod.principal, audit.sink, id);
    await saveReviewDraft(db, mod.principal, audit.sink, id, reviewed(uniq()));
    await publishReviewed(db, mod.principal, audit.sink, id);
    const moves = audit.log.filter((r) => r.detail?.from).map((r) => `${r.detail!.from}->${r.detail!.to}`);
    expect(moves).toEqual(["submitted->in_review", "in_review->approved", "approved->published"]);
    expect(audit.log.filter((r) => r.detail?.from).every((r) => r.actorId === mod.user.id && r.action === "moderate")).toBe(true);
  });
});

// =====================================================================================================
describe("§08 withdrawal: invalidates search, index, cache and AIRA retrieval, synchronously", () => {
  it("removes the item from every derived surface at once, and reports how long it took", async () => {
    cacheClear();
    const a = await author();
    const b = await author();
    const c = await author();
    const mod = await moderator();
    const tag = uniq();
    const ids: { id: string; pub: string; who: P }[] = [];
    for (const who of [a, b, c]) {
      const id = await proposed(who);
      const pub = await publish(mod, id, {}, tag);
      ids.push({ id, pub: pub.publicationId, who });
    }
    const themeId = await createTheme(db, mod.principal, sink(), { title: `Theme ${tag}`, summary: "Seasonality seen across organisations.", offering: FAI });
    for (const x of ids) await linkThemeEvidence(db, mod.principal, sink(), themeId, x.pub);
    const idea = await createIdea(db, (await employeePrincipal(db, ["ideas.manage"])).principal, sink(), {
      title: `Idea ${tag}`, problem: "Seasonal swings are misread by analysis.", offering: FAI, ownerTeam: "FAI team", evidence: [ids[0].pub],
    }).catch(() => null);
    void idea;

    const viewer = a.principal;
    expect((await listThemes(db, viewer, sink())).find((t) => t.id === themeId)).toMatchObject({ suppressed: false, distinctOrganisations: 3 });
    expect(await visibleTitles(viewer, tag)).toHaveLength(3);
    expect(await suggest(db, viewer, sink(), tag.slice(0, 4))).not.toEqual([]);
    const epoch0 = await readEpoch(db);

    const r = await withdrawMine(db, ids[2].who.principal, sink(), ids[2].id);
    expect(r).toMatchObject({ publicationsWithdrawn: 1, searchEntriesRemoved: 1 });
    expect(r.retrievalChunksRemoved).toBeGreaterThan(0);
    expect(r.elapsedMs).toBeLessThan(60_000);
    expect(r.elapsedMs).toBeLessThan(5_000);

    // Search, listing, facets, suggestions and exports no longer return it.
    expect(await visibleTitles(viewer, tag)).toHaveLength(2);
    const feed = await searchFeed(db, viewer, sink(), { offering: FAI, limit: 100 });
    expect(feed.items.some((i) => i.id === ids[2].pub)).toBe(false);
    expect((await exportCsv(db, viewer, sink(), { q: tag })).split("\r\n").length).toBe(3); // header + 2
    await expect(getPublication(db, viewer, sink(), ids[2].pub)).rejects.toBeInstanceOf(NotFoundError);

    // Index entries and retrieval chunks are physically gone.
    expect(await db.select().from(s.searchDocuments).where(eq(s.searchDocuments.publicationId, ids[2].pub))).toEqual([]);
    expect(await db.select().from(s.airaChunks).where(eq(s.airaChunks.publicationId, ids[2].pub))).toEqual([]);

    // The cached theme view was invalidated by the epoch bump: the theme drops below the minimum and is suppressed.
    expect(await readEpoch(db)).toBeGreaterThan(epoch0);
    expect((await listThemes(db, viewer, sink())).find((t) => t.id === themeId)).toMatchObject({ suppressed: true });
  });

  it("the author is told, the audit trail records the fan-out, and a second withdrawal is refused", async () => {
    const a = await author();
    const mod = await moderator();
    const { id } = await live(a, mod);
    const audit = auditCollector();
    await withdrawMine(db, a.principal, audit.sink, id);
    expect(audit.log.find((r) => r.subjectType === "contribution_withdrawal")).toMatchObject({ allowed: true, detail: { publicationsWithdrawn: 1 } });
    expect((await listNotifications(db, a.user.id)).some((n) => /no longer searchable or used by AIRA/.test(n.message))).toBe(true);
    await expect(withdrawMine(db, a.principal, sink(), id)).rejects.toBeInstanceOf(LifecycleError);
  });

  it("an item can be withdrawn before it is ever published, and from returned", async () => {
    const a = await author();
    const mod = await moderator();
    const id1 = await proposed(a);
    expect(await withdrawMine(db, a.principal, sink(), id1)).toMatchObject({ publicationsWithdrawn: 0 });
    const id2 = await proposed(a);
    await startReview(db, mod.principal, sink(), id2);
    await requestClarification(db, mod.principal, sink(), id2, { reason: "Please add the period covered." });
    await withdrawMine(db, a.principal, sink(), id2);
    expect((await getContribution(db, a.principal, sink(), id2)).status).toBe("withdrawn");
  });

  it("withdrawing the permission to publish withdraws the shared version; withdrawing attribution anonymises it", async () => {
    const a = await author();
    const mod = await moderator();
    const id = await proposed(a, {}, { ...CONSENT, attribution: true });
    await startReview(db, mod.principal, sink(), id);
    const tag = uniq();
    await saveReviewDraft(db, mod.principal, sink(), id, reviewed(tag, { attribution: "organisation" }));
    await publishReviewed(db, mod.principal, sink(), id);
    expect((await searchFeed(db, a.principal, sink(), { q: tag })).items[0].contributor).toBeTruthy();

    await setConsents(db, a.principal, sink(), id, { attribution: false });
    expect((await searchFeed(db, a.principal, sink(), { q: tag })).items[0].contributor).toBeNull();

    const r = await setConsents(db, a.principal, sink(), id, { publish_shared: false });
    expect(r.withdrawn).toMatchObject({ publicationsWithdrawn: 1 });
    expect(await visibleTitles(a.principal, tag)).toEqual([]);
  });

  it("a moderator can withdraw unsafe content, with a public reason, and the contributor is told", async () => {
    const a = await author();
    const mod = await moderator();
    const { id } = await live(a, mod);
    // Urgent removal is two audited steps: pause (instantly out of search and AIRA), then withdraw.
    await unpublish(db, mod.principal, sink(), id, { reason: "Paused: possible confidential detail." });
    const r = await withdrawByModerator(db, mod.principal, sink(), id, { reason: "Found to contain confidential detail." });
    expect(r.publicationsWithdrawn).toBe(1);
    expect((await listNotifications(db, a.user.id)).some((n) => /Found to contain confidential detail/.test(n.message))).toBe(true);
  });
});

describe("§08 material edits create a new version and need renewed review", () => {
  it("editing a published item sends version 2 for review while version 1 stays as reviewed; approving v2 replaces v1", async () => {
    const a = await author();
    const mod = await moderator();
    const { id, tag } = await live(a, mod);
    const [v1] = await db.select().from(s.sharedPublications).where(eq(s.sharedPublications.contributionId, id));

    const r = await updateContribution(db, a.principal, sink(), id, fields({ body: "A revised and materially different description of the same seasonal pattern observed across quarters." }));
    expect(r).toMatchObject({ status: "submitted", newVersion: true });
    const d = await getContribution(db, a.principal, sink(), id);
    expect(d.version).toBe(2);
    expect(d.liveVersion?.version).toBe(1);
    expect((await searchFeed(db, a.principal, sink(), { q: tag })).items.map((i) => i.version)).toEqual([1]); // v1 still the live reviewed copy

    const tag2 = uniq();
    await startReview(db, mod.principal, sink(), id);
    await saveReviewDraft(db, mod.principal, sink(), id, reviewed(tag2, { body: "A reviewed description of the revised pattern across quarters for seasonal firms." }));
    await publishReviewed(db, mod.principal, sink(), id);

    expect(await visibleTitles(a.principal, tag)).toEqual([]);
    expect((await searchFeed(db, a.principal, sink(), { q: tag2 })).items.map((i) => i.version)).toEqual([2]);
    const [old] = await db.select().from(s.sharedPublications).where(eq(s.sharedPublications.id, v1.id));
    expect(old.supersededAt).not.toBeNull();
    expect(await db.select().from(s.searchDocuments).where(eq(s.searchDocuments.publicationId, v1.id))).toEqual([]);
  });

  it("an edit never silently widens the audience, and needs the full submit-grade fields", async () => {
    const a = await author();
    const mod = await moderator();
    const { id } = await live(a, mod);
    await expect(updateContribution(db, a.principal, sink(), id, fields({ sharingChoice: "organisation" }))).rejects.toBeInstanceOf(ZodError);
    await expect(updateContribution(db, a.principal, sink(), id, fields({ body: "short" }))).rejects.toBeInstanceOf(ZodError);
    expect((await getContribution(db, a.principal, sink(), id)).status).toBe("published");
  });

  it("an edit is refused once the permission to publish has been withdrawn", async () => {
    const a = await author();
    const mod = await moderator();
    const { id } = await live(a, mod);
    await db.insert(s.consents).values({ contributionId: id, kind: "publish_shared", granted: false });
    await expect(updateContribution(db, a.principal, sink(), id, fields())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("§08 reports: unpublish during review, decide, inform; the reporter stays anonymous", () => {
  it("participants can report; the report carries no reporter identity to moderators or the author", async () => {
    const a = await author();
    const reporter = await author();
    const mod = await moderator();
    const { id, publicationId } = await live(a, mod);
    expect(await reportPublication(db, reporter.principal, sink(), publicationId, { reason: "This looks confidential." })).toEqual({ duplicate: false });
    expect(await reportPublication(db, reporter.principal, sink(), publicationId, { reason: "Still confidential." })).toEqual({ duplicate: true });

    const reports = (await listOpenReports(db, mod.principal, sink())).filter((r) => r.contributionId === id);
    expect(reports).toHaveLength(1);
    expect(JSON.stringify(reports)).not.toContain(reporter.user.id);
    expect(Object.keys(reports[0])).not.toEqual(expect.arrayContaining(["reporterId"]));
    expect(JSON.stringify(await getContribution(db, a.principal, sink(), id))).not.toContain(reporter.user.id);
    await expect(listOpenReports(db, reporter.principal, sink())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reporting needs no knowledge of other clients, only read access, and needs a reason", async () => {
    const a = await author();
    const mod = await moderator();
    const { publicationId } = await live(a, mod);
    const noWorkspace = await makeUser(db, `nw-${uniq()}@x.example`);
    const { createSession, loadSession } = await import("../../src/lib/auth/session");
    const ctx = (await loadSession(db, (await createSession(db, noWorkspace.id)).token))!;
    await expect(reportPublication(db, ctx.principal, sink(), publicationId, { reason: "Bad content here." })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reportPublication(db, a.principal, sink(), publicationId, { reason: "no" })).rejects.toBeInstanceOf(ZodError);
  });

  it("a moderator can unpublish during review (gone from search and retrieval at once), then restore or withdraw", async () => {
    const a = await author();
    const mod = await moderator();
    const { id, tag, publicationId } = await live(a, mod);
    await unpublish(db, mod.principal, sink(), id, { reason: "Paused while we check a report." }, "PRIVATE: reporter says it names a customer");

    expect(await visibleTitles(a.principal, tag)).toEqual([]);
    // A plain listing (no text query, so not via the index) must also exclude a paused item.
    expect((await searchFeed(db, a.principal, sink(), { offering: FAI, limit: 100 })).items.some((i) => i.id === publicationId)).toBe(false);
    expect(await db.select().from(s.searchDocuments).where(eq(s.searchDocuments.publicationId, publicationId))).toEqual([]);
    expect(await db.select().from(s.airaChunks).where(eq(s.airaChunks.publicationId, publicationId))).toEqual([]);
    const d = await getContribution(db, a.principal, sink(), id);
    expect(d.status).toBe("unpublished_under_review");
    expect(d.timeline[0].note).toBe("Paused while we check a report.");
    expect(JSON.stringify(d)).not.toContain("PRIVATE");
    expect((await listNotifications(db, a.user.id)).some((n) => /Temporarily paused/.test(n.message))).toBe(true);

    await restore(db, mod.principal, sink(), id, { reason: "Checked: no issue found." });
    expect(await visibleTitles(a.principal, tag)).toHaveLength(1);
    expect((await db.select().from(s.searchDocuments).where(eq(s.searchDocuments.publicationId, publicationId))).length).toBe(1);
  });

  it("dismissing a report records the decision, and withdrawal resolves open reports", async () => {
    const a = await author();
    const reporter = await author();
    const mod = await moderator();
    const x = await live(a, mod);
    await reportPublication(db, reporter.principal, sink(), x.publicationId, { reason: "Looks misleading to me." });
    const [r] = (await listOpenReports(db, mod.principal, sink())).filter((q) => q.contributionId === x.id);
    await dismissReport(db, mod.principal, sink(), r.reportId, { reason: "Reviewed: accurate and de-identified." });
    expect((await listOpenReports(db, mod.principal, sink())).some((q) => q.reportId === r.reportId)).toBe(false);

    const y = await live(a, mod);
    await reportPublication(db, reporter.principal, sink(), y.publicationId, { reason: "Possibly confidential." });
    await withdrawMine(db, a.principal, sink(), y.id);
    expect((await listOpenReports(db, mod.principal, sink())).some((q) => q.contributionId === y.id)).toBe(false);
  });
});

// =====================================================================================================
describe("§06/§10 shared feed: same visibility rules for search, counts, suggestions and exports", () => {
  it("is for authorised participants only", async () => {
    const noWorkspace = await makeUser(db, `feed-${uniq()}@x.example`);
    const { createSession, loadSession } = await import("../../src/lib/auth/session");
    const ctx = (await loadSession(db, (await createSession(db, noWorkspace.id)).token))!;
    for (const fn of [
      () => searchFeed(db, ctx.principal, sink(), {}), () => suggest(db, ctx.principal, sink(), "seas"),
      () => exportCsv(db, ctx.principal, sink(), {}), () => listThemes(db, ctx.principal, sink()),
    ]) await expect(fn()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows employees and clients the same reviewed items, and never any tenant id or private field at any depth", async () => {
    const a = await author();
    const mod = await moderator();
    const { tag } = await live(a, mod);
    const client = await author();
    const asClient = await searchFeed(db, client.principal, sink(), { q: tag });
    const asEmployee = await searchFeed(db, mod.principal, sink(), { q: tag });
    expect(asClient.items.map((i) => i.id)).toEqual(asEmployee.items.map((i) => i.id));
    for (const payload of [asClient, asEmployee, await getPublication(db, client.principal, sink(), asClient.items[0].id), await listThemes(db, client.principal, sink())]) {
      expect(findForbiddenKey(payload)).toBeNull();
    }
    const raw = JSON.stringify(asClient);
    expect(raw).not.toContain(a.principal.activeOrgId!);
    expect(raw).not.toContain(a.user.id);
  });

  it("never lists drafts, organisation-only items, or submitted-but-unreviewed items from any tenant", async () => {
    const a = await author();
    const tag = uniq();
    await createDraft(db, a.principal, sink(), fields({ title: `Draft ${tag}` }), { store_process: true });
    const { id: orgOnly } = await createDraft(db, a.principal, sink(), fields({ title: `OrgOnly ${tag}`, sharingChoice: "organisation" }), { store_process: true });
    await shareWithOrganisation(db, a.principal, sink(), orgOnly, true);
    await proposed(a, { title: `Submitted ${tag}` });
    const viewer = await author();
    expect((await searchFeed(db, viewer.principal, sink(), { q: tag })).items).toEqual([]);
    expect((await searchFeed(db, viewer.principal, sink(), { limit: 100 })).items.every((i) => !i.title.includes(tag))).toBe(true);
  });

  it("filters by offering, industry, region, period and topic, and finds text through the index", async () => {
    const a = await author();
    const mod = await moderator();
    const tag = uniq();
    const x = await proposed(a, { title: `Filter ${tag}` });
    await startReview(db, mod.principal, sink(), x);
    await saveReviewDraft(db, mod.principal, sink(), x, reviewed(tag, { industry: `Industry-${tag}`, region: `Region-${tag}`, observationPeriod: "2031-Q3", topic: "emerging_trend" }));
    await publishReviewed(db, mod.principal, sink(), x);
    const v = (await author()).principal;
    const hits = async (o: Record<string, unknown>) => (await searchFeed(db, v, sink(), o)).items.filter((i) => i.title.includes(tag)).length;
    expect(await hits({ q: tag })).toBe(1);
    expect(await hits({ industry: `Industry-${tag}` })).toBe(1);
    expect(await hits({ region: `Region-${tag}` })).toBe(1);
    expect(await hits({ period: "2031" })).toBe(1);
    expect(await hits({ topic: "emerging_trend" })).toBe(1);
    expect(await hits({ offering: FAI, region: "Nowhere" })).toBe(0);
    expect(await hits({ q: `${tag}-nomatch` })).toBe(0);
  });

  it("withholds a facet's count when fewer than the minimum number of organisations stand behind it", async () => {
    const mod = await moderator();
    const tag = uniq();
    const region = `Region-${tag}`;
    const orgs = [await author(), await author(), await author()];
    const v = (await author()).principal;

    for (let i = 0; i < 2; i++) { const id = await proposed(orgs[i]); await publish(mod, id, { region }, `${tag}${i}`); }
    let bucket = (await searchFeed(db, v, sink(), { region })).facets.region.find((b) => b.value === region);
    expect(bucket?.count).toBeNull(); // two organisations: suppressed

    const id3 = await proposed(orgs[2]);
    await publish(mod, id3, { region }, `${tag}2`);
    bucket = (await searchFeed(db, v, sink(), { region })).facets.region.find((b) => b.value === region);
    expect(bucket?.count).toBe(3);
  });

  it("suggestions come only from visible items", async () => {
    const a = await author();
    const mod = await moderator();
    const hidden = `Hidden${uniq()}`;
    await proposed(a, { title: `${hidden} unreviewed` });
    const { tag } = await live(a, mod);
    const v = (await author()).principal;
    expect(await suggest(db, v, sink(), hidden.slice(0, 8))).toEqual([]);
    expect((await suggest(db, v, sink(), tag.slice(0, 5))).some((t) => t.includes(tag))).toBe(true);
    expect(await suggest(db, v, sink(), "a")).toEqual([]);
  });

  it("exports the same reviewed fields as the feed, with no identifiers, and neutralises spreadsheet formulas", async () => {
    const a = await author();
    const mod = await moderator();
    const tag = uniq();
    const id = await proposed(a);
    await startReview(db, mod.principal, sink(), id);
    await saveReviewDraft(db, mod.principal, sink(), id, reviewed(tag, { title: `=1+1 ${tag}` }));
    await publishReviewed(db, mod.principal, sink(), id);
    const csv = await exportCsv(db, (await author()).principal, sink(), { q: tag });
    expect(csv.split("\r\n")[0]).toBe("title,offering,topic,industry,region,observationPeriod,evidenceType,confidence,evidenceQuality,contributor,publishedAt,body");
    expect(csv).toContain(`"'=1+1 ${tag}"`);
    expect(csv).not.toContain(a.principal.activeOrgId!);
    expect(csv).not.toContain(a.user.id);
  });

  it("quality feedback is one vote each, replaceable, and its totals are for moderators and product owners only", async () => {
    const a = await author();
    const mod = await moderator();
    const v1 = await author();
    const v2 = await author();
    const { publicationId } = await live(a, mod);
    await giveFeedback(db, v1.principal, sink(), publicationId, "needs_evidence");
    await giveFeedback(db, v1.principal, sink(), publicationId, "useful");
    await giveFeedback(db, v2.principal, sink(), publicationId, "useful");
    await expect(giveFeedback(db, v1.principal, sink(), publicationId, "five_stars")).rejects.toBeInstanceOf(ZodError);
    expect(await feedbackSummary(db, mod.principal, sink(), publicationId)).toEqual({ useful: 2, needsEvidence: 0 });
    await expect(feedbackSummary(db, v1.principal, sink(), publicationId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getPublication(db, v1.principal, sink(), publicationId)).myFeedback).toBe("useful");
    expect(JSON.stringify(await getPublication(db, v2.principal, sink(), publicationId))).not.toMatch(/useful.*[0-9]+ (people|votes)/);
  });

  it("saved searches are private to the person and workspace that saved them", async () => {
    await ensureProduct(db, FAI);
    const x = await makeClientOrg(db);
    const y = await makeClientOrg(db);
    const u = await makeUser(db, `ss-${uniq()}@advisory.example`);
    const { makeMembership } = await import("../helpers/db");
    await makeMembership(db, u.id, x.id, "client_member");
    await makeMembership(db, u.id, y.id, "client_member");
    const inX = await principalIn(db, u.id, x.id);
    const inY = await principalIn(db, u.id, y.id);
    const colleague = await clientPrincipal(db, x.id);

    const id = await saveSearch(db, inX, sink(), { name: "Seasonality in GCC", query: { q: "seasonal", region: "GCC" } });
    expect((await listSavedSearches(db, inX)).map((q) => q.id)).toContain(id);
    expect((await listSavedSearches(db, inY)).map((q) => q.id)).not.toContain(id);
    expect((await listSavedSearches(db, colleague.principal)).map((q) => q.id)).not.toContain(id);
    await expect(deleteSavedSearch(db, colleague.principal, id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteSavedSearch(db, inX, id);
    await expect(saveSearch(db, inX, sink(), { name: "x", query: {} })).rejects.toBeInstanceOf(ZodError);
  });
});

// =====================================================================================================
describe("§09/§10 themes: distinct organisations, suppression, evidence links, caution", () => {
  async function themeWith(orgs: P[], postsPerOrg: number[], mod: M) {
    const tag = uniq();
    const themeId = await createTheme(db, mod.principal, sink(), { title: `Seasonality context ${tag}`, summary: "Seasonal businesses can look weaker off-season.", offering: FAI, limitations: "Based on a small number of reviewed observations." });
    for (let i = 0; i < orgs.length; i++) for (let j = 0; j < postsPerOrg[i]; j++) {
      const id = await proposed(orgs[i]);
      const p = await publish(mod, id, {}, `${tag}${i}${j}`);
      await linkThemeEvidence(db, mod.principal, sink(), themeId, p.publicationId);
    }
    return themeId;
  }
  const find = async (p: P["principal"], id: string) => (await listThemes(db, p, sink())).find((t) => t.id === id)!;

  it("five posts from one organisation are ONE organisation, so the theme stays suppressed", async () => {
    cacheClear();
    const mod = await moderator();
    const [a, b] = [await author(), await author()];
    const id = await themeWith([a, b], [5, 1], mod);
    const t = await find(a.principal, id);
    expect(t.suppressed).toBe(true);
  });

  it("two organisations: no count, no evidence links, no period; three: count, evidence, period, and cautions", async () => {
    cacheClear();
    const mod = await moderator();
    const orgs = [await author(), await author(), await author()];
    const id = await themeWith(orgs.slice(0, 2), [1, 1], mod);
    let t = await find(orgs[0].principal, id);
    expect(t).toMatchObject({ suppressed: true });
    expect(JSON.stringify(t)).not.toMatch(/distinctOrganisations|evidence|observationPeriod/);
    expect(t.suppressed && t.reason).toMatch(/Fewer than 3 organisations/);

    const extra = await proposed(orgs[2]);
    const p = await publish(mod, extra, {}, uniq());
    await linkThemeEvidence(db, mod.principal, sink(), id, p.publicationId);
    t = await find(orgs[0].principal, id);
    expect(t.suppressed).toBe(false);
    if (!t.suppressed) {
      expect(t.distinctOrganisations).toBe(3);
      expect(t.evidence).toHaveLength(3);
      expect(t.observationPeriod).toBe("2026-H1");
      expect(t.confidence).toBe("medium");
      expect(t.limitations.join(" ")).toMatch(/Small sample: 3 organisations/);
      expect(t.limitations.join(" ")).toMatch(/not evidence of how common/);
      expect(findForbiddenKey(t)).toBeNull();
    }
  });

  it("with many posts from three organisations the count is three, not the number of posts", async () => {
    cacheClear();
    const mod = await moderator();
    const orgs = [await author(), await author(), await author()];
    const id = await themeWith(orgs, [3, 1, 2], mod);
    const t = await find(orgs[0].principal, id);
    expect(t.suppressed).toBe(false);
    if (!t.suppressed) { expect(t.distinctOrganisations).toBe(3); expect(t.evidence).toHaveLength(6); }
  });

  it("only moderators curate themes, and only live items can be linked", async () => {
    const a = await author();
    const mod = await moderator();
    const ordinary = await employeePrincipal(db);
    await expect(createTheme(db, ordinary.principal, sink(), { title: "Nope", summary: "A sneaky theme.", offering: FAI })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTheme(db, a.principal, sink(), { title: "Nope", summary: "A sneaky theme.", offering: FAI })).rejects.toBeInstanceOf(ForbiddenError);
    const themeId = await createTheme(db, mod.principal, sink(), { title: "Real theme", summary: "A genuine theme summary.", offering: FAI });
    const x = await live(a, mod);
    await withdrawMine(db, a.principal, sink(), x.id);
    await expect(linkThemeEvidence(db, mod.principal, sink(), themeId, x.publicationId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the cached view is rebuilt after any publish, so a new item shows without waiting", async () => {
    cacheClear();
    const mod = await moderator();
    const orgs = [await author(), await author(), await author()];
    const id = await themeWith(orgs.slice(0, 2), [1, 1], mod);
    expect((await find(orgs[0].principal, id)).suppressed).toBe(true); // cached now
    const x = await proposed(orgs[2]);
    const p = await publish(mod, x, {}, uniq());
    await linkThemeEvidence(db, mod.principal, sink(), id, p.publicationId);
    expect((await find(orgs[0].principal, id)).suppressed).toBe(false);
  });
});

// =====================================================================================================
describe("§10 improvement ideas: linked evidence, audited status, close the loop", () => {
  const idea = (over: Record<string, unknown> = {}) => ({
    title: `Idea ${uniq()}`, problem: "Seasonal swings are misread by period-over-period analysis.", offering: FAI,
    proposedOutcome: "Explain changes against a seasonal baseline.", ownerTeam: "Financial Analysis team", priority: "medium", ...over,
  });
  const owner = () => employeePrincipal(db, ["ideas.manage"]);

  it("needs the ideas.manage grant: not employee status, not moderation, not a client role", async () => {
    const a = await author();
    const mod = await moderator();
    const ordinary = await employeePrincipal(db);
    for (const e of [ordinary, mod, a]) await expect(createIdea(db, e.principal, sink(), idea())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("links only live reviewed evidence, and the owner alone changes it", async () => {
    const a = await author();
    const mod = await moderator();
    const o = await owner();
    const other = await owner();
    const x = await live(a, mod);
    const y = await live(a, mod);
    const id = await createIdea(db, o.principal, sink(), idea({ evidence: [x.publicationId] }));

    await expect(linkIdeaEvidence(db, o.principal, sink(), id, `00000000-0000-0000-0000-000000000000`)).rejects.toBeInstanceOf(NotFoundError);
    await linkIdeaEvidence(db, o.principal, sink(), id, y.publicationId);
    expect((await getIdea(db, o.principal, sink(), id)).evidence).toHaveLength(2);
    await expect(linkIdeaEvidence(db, other.principal, sink(), id, y.publicationId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateIdeaStatus(db, other.principal, sink(), id, "planned")).rejects.toBeInstanceOf(ForbiddenError);

    // Evidence that is later withdrawn drops out automatically.
    await withdrawMine(db, a.principal, sink(), x.id);
    expect((await getIdea(db, o.principal, sink(), id)).evidence.map((e) => e.id)).toEqual([y.publicationId]);
  });

  it("the idea's evidence is the reviewed copy only, never a private source", async () => {
    const a = await author();
    const mod = await moderator();
    const o = await owner();
    const secret = `Zebracorp-${uniq()}`;
    const id = await proposed(a, { body: `${secret} struggled with seasonal ratios across several quarters of the year.` });
    const p = await publish(mod, id);
    const ideaId = await createIdea(db, o.principal, sink(), idea({ evidence: [p.publicationId] }));
    const got = await getIdea(db, o.principal, sink(), ideaId);
    expect(JSON.stringify(got.evidence)).not.toContain(secret);
    expect(findForbiddenKey(got.evidence)).toBeNull();
  });

  it("every status change is audited with from and to, and moves the last-update time", async () => {
    const o = await owner();
    const audit = auditCollector();
    const id = await createIdea(db, o.principal, audit.sink, idea());
    const [before] = await db.select().from(s.improvementIdeas).where(eq(s.improvementIdeas.id, id));
    await new Promise((r) => setTimeout(r, 15));
    await updateIdeaStatus(db, o.principal, audit.sink, id, "under_review");
    await updateIdeaStatus(db, o.principal, audit.sink, id, "planned");
    const moves = audit.log.filter((r) => r.detail?.from).map((r) => `${r.detail!.from}->${r.detail!.to}`);
    expect(moves).toEqual(["proposed->under_review", "under_review->planned"]);
    const [after] = await db.select().from(s.improvementIdeas).where(eq(s.improvementIdeas.id, id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    await expect(updateIdeaStatus(db, o.principal, audit.sink, id, "shipped")).rejects.toBeInstanceOf(ZodError);
  });

  it("is hidden from clients until the owner publishes an approved plain-language summary", async () => {
    const o = await owner();
    const orgId = (await makeClientOrg(db)).id;
    const { grantEntitlement } = await import("../helpers/db");
    await grantEntitlement(db, orgId, FAI);
    const c = await clientPrincipal(db, orgId);
    const { getClientDashboard } = await import("../../src/lib/client/service");
    const id = await createIdea(db, o.principal, sink(), idea({ title: `Visible only after update ${uniq()}` }));
    const titles = async () => (await getClientDashboard(db, c.principal, sink())).ideas.map((i) => i.title);
    expect(await titles()).not.toContain((await db.select().from(s.improvementIdeas).where(eq(s.improvementIdeas.id, id)))[0].title);

    await updateIdeaStatus(db, o.principal, sink(), id, "under_review");
    await publishClientUpdate(db, o.principal, sink(), id, { summary: "We are exploring a seasonality-aware comparison. This is under review." });
    const shown = (await getClientDashboard(db, c.principal, sink())).ideas.find((i) => i.id === id)!;
    expect(shown).toMatchObject({ statusLabel: "Under review", commitmentNote: "Not a commitment to deliver." });
    expect(JSON.stringify(shown)).not.toMatch(/problem|priority|proposedOutcome/i);
  });

  it("the client update cannot name a client or carry contact details, and notifies supporting authors without source detail", async () => {
    const a = await author();
    const mod = await moderator();
    const o = await owner();
    const x = await live(a, mod);
    const id = await createIdea(db, o.principal, sink(), idea({ evidence: [x.publicationId] }));

    const clientName = (await db.select().from(s.organizations).where(eq(s.organizations.id, a.principal.activeOrgId!)))[0].name;
    await expect(publishClientUpdate(db, o.principal, sink(), id, { summary: `Raised by ${clientName}, who asked for it.` })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishClientUpdate(db, o.principal, sink(), id, { summary: "Contact jane@example.com for details on this." })).rejects.toBeInstanceOf(ForbiddenError);

    await updateIdeaStatus(db, o.principal, sink(), id, "planned");
    const r = await publishClientUpdate(db, o.principal, sink(), id, { summary: "We plan to add a seasonal baseline. Timing is not committed." });
    expect(r.notified).toBe(1);
    const note = (await listNotifications(db, a.user.id)).find((n) => /improvement idea/.test(n.message))!;
    expect(note.message).toMatch(/not a commitment/i);
    expect(note.message).not.toContain(x.tag);
    expect(note.message).not.toMatch(/problem|priority/);
  });

  it("an organisation sees an idea its approved contribution supports, and stops seeing it after withdrawal", async () => {
    const a = await author();
    const mod = await moderator();
    const o = await owner();
    const x = await live(a, mod, { offering: FAI });
    const themeId = await createTheme(db, mod.principal, sink(), { title: `T ${uniq()}`, summary: "A theme about seasonal behaviour.", offering: "riva" });
    await ensureProduct(db, "riva");
    await linkThemeEvidence(db, mod.principal, sink(), themeId, x.publicationId);
    const id = await createIdea(db, o.principal, sink(), idea({ offering: "riva", themeId, evidence: [x.publicationId] }));
    await publishClientUpdate(db, o.principal, sink(), id, { summary: "We are looking into this area. Under review, not promised." });

    const { getClientDashboard } = await import("../../src/lib/client/service");
    expect((await getClientDashboard(db, a.principal, sink())).ideas.map((i) => i.id)).toContain(id);
    await withdrawMine(db, a.principal, sink(), x.id);
    expect((await getClientDashboard(db, a.principal, sink())).ideas.map((i) => i.id)).not.toContain(id);
  });
});

describe("§10 the brief's illustrative scenario, end to end", () => {
  it("three organisations -> moderator redacts and clarifies -> a 'Seasonality context' theme with a small-sample warning -> an Under-review idea -> clients see status; private drafts and notes stay private", async () => {
    cacheClear();
    const mod = await moderator();
    const o = await employeePrincipal(db, ["ideas.manage"]);
    const orgs = [await author(), await author(), await author()];
    const names = ["Alpha", "Beta", "Gamma"];
    const tag = uniq();

    // Each fictional client submits an observation; one has a private draft that must stay private.
    const privateDraft = (await createDraft(db, orgs[0].principal, sink(), fields({ title: `PrivateDraft ${tag}`, sharingChoice: "private" }), { store_process: true })).id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await proposed(orgs[i], { title: `${names[i]} seasonal SME cash flow ${tag}`, body: `${names[i]} sees seasonal SME cash flow read as deterioration when quarters are compared like for like in every period of the year.` }));

    // The moderator asks one clarification, then removes identifying detail and publishes.
    await startReview(db, mod.principal, sink(), ids[1]);
    await requestClarification(db, mod.principal, sink(), ids[1], { reason: "Please confirm the observation period." }, "PRIVATE: author named a branch in the notes");
    await updateContribution(db, orgs[1].principal, sink(), ids[1], fields({ title: `Beta seasonal SME cash flow ${tag}`, observationPeriod: "2026-H1" }));
    await submitContribution(db, orgs[1].principal, sink(), ids[1]);
    const pubs: string[] = [];
    for (const id of ids) pubs.push((await publish(mod, id, { title: `Seasonal SME cash flow signal ${tag}` }, tag + "x")).publicationId);

    // The dashboard groups them into a theme with a small-sample warning.
    const themeId = await createTheme(db, mod.principal, sink(), { title: "Seasonality context", summary: "Seasonal SME cash flow can be misread as deterioration.", offering: FAI });
    for (const p of pubs) await linkThemeEvidence(db, mod.principal, sink(), themeId, p);
    const theme = (await listThemes(db, orgs[0].principal, sink())).find((t) => t.id === themeId)!;
    expect(theme.suppressed).toBe(false);
    if (!theme.suppressed) { expect(theme.distinctOrganisations).toBe(3); expect(theme.limitations.join(" ")).toMatch(/Small sample/); }

    // A product owner raises an idea that is Under review, not a promise.
    const ideaId = await createIdea(db, o.principal, sink(), { title: "Seasonality-aware comparison explanation", problem: "Analysis compares periods without seasonal context.", offering: FAI, ownerTeam: "Financial Analysis Intelligence", themeId, evidence: pubs });
    await updateIdeaStatus(db, o.principal, sink(), ideaId, "under_review");
    await publishClientUpdate(db, o.principal, sink(), ideaId, { summary: "We are exploring a seasonality-aware comparison. Under review, not a delivery promise." });

    // Clients see the shared theme and the status ...
    const { getClientDashboard } = await import("../../src/lib/client/service");
    const { grantEntitlement } = await import("../helpers/db");
    await grantEntitlement(db, orgs[0].principal.activeOrgId!, FAI);
    const fresh = await principalIn(db, orgs[0].user.id, orgs[0].principal.activeOrgId!);
    const dash = await getClientDashboard(db, fresh, sink());
    expect(dash.ideas.find((i) => i.id === ideaId)).toMatchObject({ statusLabel: "Under review", commitmentNote: "Not a commitment to deliver." });

    // ... while private drafts, moderation notes and source records stay private.
    const everything = JSON.stringify([await searchFeed(db, orgs[2].principal, sink(), { q: tag }), await listThemes(db, orgs[2].principal, sink()), dash]);
    expect(everything).not.toContain("PrivateDraft");
    expect(everything).not.toContain("PRIVATE: author named a branch");
    expect(everything).not.toContain("Alpha");
    expect(everything).not.toContain("Gamma");
    expect((await getContribution(db, orgs[0].principal, sink(), privateDraft)).status).toBe("draft");
    expect((await db.select().from(s.moderationActions).where(and(eq(s.moderationActions.contributionId, ids[1]), eq(s.moderationActions.action, "request_clarification"))))[0].privateNotes).toContain("PRIVATE");
  });
});

describe("moderators are told something is waiting, without any content", () => {
  it("notifies every current holder of the moderation grant on submit, amend and material edit, and nobody else", async () => {
    const a = await author();
    const mod = await moderator();
    const bystander = await employeePrincipal(db);
    const publisher = await employeePrincipal(db, ["media.publish"]);
    const unique = `Zebraquartz${uniq()}`;
    const { id } = await createDraft(db, a.principal, sink(), fields({ title: `About ${unique}` }), CONSENT);
    await submitContribution(db, a.principal, sink(), id);

    const mine = (await listNotifications(db, mod.user.id)).filter((n) => /waiting for review/.test(n.message));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].href).toBe("/employee/moderation");
    expect(mine.map((n) => n.message).join(" ")).not.toContain(unique); // no title, no organisation, no content
    expect(mine.map((n) => n.message).join(" ")).not.toContain(a.principal.activeOrgId!);
    for (const other of [bystander, publisher]) expect((await listNotifications(db, other.user.id)).some((n) => /waiting for review/.test(n.message))).toBe(false);
    expect((await listNotifications(db, a.user.id)).some((n) => /waiting for review/.test(n.message))).toBe(false);
  });

  it("an expired moderation grant no longer receives them", async () => {
    const a = await author();
    const lapsed = await employeePrincipal(db);
    await db.insert(s.platformGrants).values({ userId: lapsed.user.id, permission: "learning.moderate", expiresAt: new Date(Date.now() - 1000) });
    await proposed(a);
    expect((await listNotifications(db, lapsed.user.id)).some((n) => /waiting for review/.test(n.message))).toBe(false);
  });
});
