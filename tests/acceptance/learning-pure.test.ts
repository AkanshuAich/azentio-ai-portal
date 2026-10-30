import { describe, expect, it } from "vitest";
import {
  STATUSES, LifecycleError, allowedNext, assertTransition, authorCanEdit, canTransition, isTerminal, moderatorMayRead,
  type Actor, type Status,
} from "../../src/lib/learning/lifecycle";
import { flagKinds, scanText } from "../../src/lib/learning/scanner";
import { FORBIDDEN_SHARED_KEYS, findForbiddenKey, toSharedDTO } from "../../src/lib/learning/dto";
import { draftSchema, submitSchema, reviewDraftSchema } from "../../src/lib/learning/validation";
import { bucketCount, cohortStat, minDistinctOrgs } from "../../src/lib/insights/safeguards";

describe("§08 lifecycle: explicit allowed transitions", () => {
  // The complete legal set, written out independently of the implementation.
  const LEGAL: Array<[Status, Status, Actor]> = [
    ["draft", "submitted", "author"],
    ["submitted", "in_review", "moderator"], ["submitted", "returned", "moderator"], ["submitted", "rejected", "moderator"],
    ["submitted", "approved", "moderator"], ["submitted", "withdrawn", "author"],
    ["in_review", "returned", "moderator"], ["in_review", "rejected", "moderator"], ["in_review", "approved", "moderator"],
    ["in_review", "withdrawn", "author"],
    ["returned", "submitted", "author"], ["returned", "withdrawn", "author"],
    ["approved", "published", "moderator"],
    ["published", "withdrawn", "author"], ["published", "unpublished_under_review", "moderator"], ["published", "submitted", "author"],
    ["unpublished_under_review", "published", "moderator"], ["unpublished_under_review", "withdrawn", "author"],
    ["unpublished_under_review", "withdrawn", "moderator"], ["unpublished_under_review", "rejected", "moderator"],
  ];

  it("allows exactly the listed transitions and refuses every other (status x status x actor) combination", () => {
    const legal = new Set(LEGAL.map((t) => t.join("|")));
    for (const from of STATUSES) for (const to of STATUSES) for (const actor of ["author", "moderator", "system"] as Actor[]) {
      expect(canTransition(from, to, actor), `${from} -> ${to} by ${actor}`).toBe(legal.has(`${from}|${to}|${actor}`));
    }
  });

  it("an author can never approve, publish or reject their own contribution", () => {
    for (const from of STATUSES) for (const to of ["approved", "published", "rejected", "in_review", "unpublished_under_review"] as Status[]) {
      expect(canTransition(from, to, "author")).toBe(false);
    }
  });

  it("a moderator can never submit, or withdraw an unpublished item on the author's behalf", () => {
    expect(canTransition("draft", "submitted", "moderator")).toBe(false);
    expect(canTransition("returned", "submitted", "moderator")).toBe(false);
    expect(canTransition("submitted", "withdrawn", "moderator")).toBe(false);
  });

  it("nothing reaches published without passing through approval, and drafts cannot skip review", () => {
    expect(canTransition("draft", "published", "moderator")).toBe(false);
    expect(canTransition("submitted", "published", "moderator")).toBe(false);
    expect(canTransition("in_review", "published", "moderator")).toBe(false);
    expect(canTransition("returned", "published", "moderator")).toBe(false);
  });

  it("rejected and withdrawn are terminal", () => {
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("withdrawn")).toBe(true);
    for (const to of STATUSES) for (const a of ["author", "moderator"] as Actor[]) {
      expect(canTransition("withdrawn", to, a)).toBe(false);
      expect(canTransition("rejected", to, a)).toBe(false);
    }
  });

  it("a material edit of a published item goes back to submitted, never straight to published", () => {
    expect(canTransition("published", "submitted", "author")).toBe(true);
    expect(canTransition("published", "published", "author")).toBe(false);
  });

  it("assertTransition throws a typed error for an illegal move", () => {
    expect(() => assertTransition("draft", "published", "moderator")).toThrow(LifecycleError);
    expect(() => assertTransition("draft", "submitted", "author")).not.toThrow();
    expect(allowedNext("published", "author").sort()).toEqual(["submitted", "withdrawn"]);
  });

  it("only drafts and returned items are editable by the author; moderators never read drafts", () => {
    expect(STATUSES.filter(authorCanEdit)).toEqual(["draft", "returned"]);
    expect(moderatorMayRead("draft")).toBe(false);
    expect(STATUSES.filter((s) => s !== "draft").every(moderatorMayRead)).toBe(true);
  });
});

describe("§07 scanner: flags likely-sensitive content for review (not a guarantee)", () => {
  const kinds = (t: string, names: string[] = []) => scanText(t, { knownNames: names }).map((f) => f.kind);

  it.each([
    ["email", "Contact jane.doe@meridianbank.example about it"],
    ["phone", "Call +971 4 123 4567 for details"],
    ["iban", "Settled to GB82 WEST 1234 5698 7654 32 last week"],
    ["account_number", "Account 123456789012 was affected"],
    ["url", "See https://intranet.customer.example/case/9 for more"],
    ["currency_amount", "The facility was $2,500,000 in total"],
    ["currency_amount", "They borrowed 750000 AED"],
    ["exact_date", "It happened on 2026-03-14 at the branch"],
    ["exact_date", "Reported on 14 March 2026"],
    ["credential", "the login was password: hunter2"],
  ])("flags %s", (kind, text) => {
    expect(kinds(text)).toContain(kind);
  });

  it("recognises a payment card by its checksum, and does not mistake an ordinary number for one", () => {
    expect(kinds("Card 4111 1111 1111 1111 was declined")).toContain("card_number");
    expect(kinds("Card 4111 1111 1111 1112 was declined")).not.toContain("card_number");
  });

  it("flags known client names, case-insensitively, but only as whole words", () => {
    expect(kinds("meridian commercial bank saw this", ["Meridian Commercial Bank"])).toContain("known_name");
    expect(kinds("a bank with a sunny disposition", ["Sun"])).not.toContain("known_name");
  });

  it("leaves ordinary generalised wording alone", () => {
    expect(scanText("Seasonal SMEs can look weaker off-season when ratios are compared quarter on quarter.")).toEqual([]);
    expect(scanText("About 40% of borrowers in the region showed this pattern in 2026-H1.").map((f) => f.kind)).not.toContain("exact_date");
  });

  it("flagKinds returns each kind once across fields, and ignores empty fields", () => {
    expect(flagKinds(["a@b.example and c@d.example", null, undefined, "no flags"]).sort()).toEqual(["email"]);
  });
});

describe("§08/§09 shared DTO is a whitelist", () => {
  const row = {
    id: "pub-1", title: "T", body: "B", offering: "riva", industry: "Banking", region: "Regional", observationPeriod: "2026-H1",
    evidenceType: "client_experience", confidence: "medium", evidenceQuality: "moderate", topic: "market_observation", version: 2,
    publishedAt: new Date("2026-10-01T00:00:00Z"), attribution: "anonymous",
    // Things that must never be copied across even if a row carried them:
    orgId: "ORG", authorId: "AUTHOR", contributionId: "CONTRIB", privateNotes: "secret", sensitiveFlags: ["email"],
  };

  it("contains only whitelisted keys, even when the source row carries extra fields", () => {
    const dto = toSharedDTO(row as never);
    expect(Object.keys(dto).sort()).toEqual([
      "body", "confidence", "contributor", "evidenceQuality", "evidenceType", "id", "industry", "observationPeriod",
      "offering", "publishedAt", "region", "title", "topic", "version",
    ]);
    expect(JSON.stringify(dto)).not.toMatch(/ORG|AUTHOR|CONTRIB|secret/);
    expect(findForbiddenKey(dto)).toBeNull();
  });

  it("names the organisation only when attribution was opted into", () => {
    expect(toSharedDTO(row as never, "Meridian").contributor).toBeNull();
    expect(toSharedDTO({ ...row, attribution: "organisation" } as never, "Meridian").contributor).toBe("Meridian");
    expect(toSharedDTO({ ...row, attribution: "organisation" } as never, null).contributor).toBeNull();
  });

  it("the key walker finds a forbidden key at any depth", () => {
    for (const k of FORBIDDEN_SHARED_KEYS) {
      expect(findForbiddenKey({ items: [{ nested: { [k]: 1 } }] })).toBe(`$.items[0].nested.${k}`);
    }
    expect(findForbiddenKey({ items: [{ title: "fine" }] })).toBeNull();
  });
});

describe("§07 validation: draft is light, submit is strict, limits apply", () => {
  const draft = { kind: "market_observation", title: "Seasonal cash flow", body: "", offering: "financial-analysis-intelligence" };
  const complete = {
    ...draft, body: "Seasonal SMEs can look weaker off-season when ratios are compared quarter on quarter.",
    industry: "Banking", region: "GCC", observationPeriod: "2026-H1", evidenceType: "client_experience", confidence: "medium", sharingChoice: "propose_shared",
  };

  it("accepts a bare draft and defaults it to private", () => {
    const d = draftSchema.parse(draft);
    expect(d.sharingChoice).toBe("private");
  });

  it("enforces length limits on drafts", () => {
    expect(draftSchema.safeParse({ ...draft, title: "x" }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, title: "x".repeat(141) }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, body: "x".repeat(4001) }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, kind: "rumour" }).success).toBe(false);
  });

  it("submit requires every reviewer-facing field", () => {
    expect(submitSchema.safeParse(complete).success).toBe(true);
    for (const missing of ["industry", "region", "observationPeriod", "evidenceType", "confidence"]) {
      const { [missing]: _drop, ...rest } = complete as Record<string, unknown>;
      void _drop;
      expect(submitSchema.safeParse(rest).success, `missing ${missing}`).toBe(false);
    }
    expect(submitSchema.safeParse({ ...complete, body: "too short" }).success).toBe(false);
  });

  it("only a contribution proposed to the community can be submitted for review", () => {
    expect(submitSchema.safeParse({ ...complete, sharingChoice: "private" }).success).toBe(false);
    expect(submitSchema.safeParse({ ...complete, sharingChoice: "organisation" }).success).toBe(false);
  });

  it("review drafts default to anonymous attribution", () => {
    expect(reviewDraftSchema.parse({ title: "Title", body: "A reviewed body text.", offering: "riva" }).attribution).toBe("anonymous");
  });
});

describe("§09 aggregation safeguards: distinct organisations, never posts", () => {
  it("five posts from one organisation count as one", () => {
    const s = cohortStat(["a", "a", "a", "a", "a"], 3);
    expect(s).toMatchObject({ suppressed: true });
  });

  it("suppresses below the minimum and reveals no number, shows it at the minimum", () => {
    const two = cohortStat(["a", "b"], 3);
    expect(two.suppressed).toBe(true);
    expect(JSON.stringify(two)).not.toMatch(/distinctOrgs/);
    expect(cohortStat(["a", "b", "c"], 3)).toEqual({ suppressed: false, distinctOrgs: 3 });
    expect(cohortStat(["a", "b", "c", "c"], 3)).toEqual({ suppressed: false, distinctOrgs: 3 });
  });

  it("the threshold is configurable but can never be set below 2", () => {
    expect(minDistinctOrgs(undefined)).toBe(3);
    expect(minDistinctOrgs("5")).toBe(5);
    expect(minDistinctOrgs("1")).toBe(2);
    expect(minDistinctOrgs("0")).toBe(2);
    expect(minDistinctOrgs("banana")).toBe(3);
  });

  it("facet buckets hide their count when too few organisations stand behind them", () => {
    expect(bucketCount(10, ["a", "a", "a"], 3)).toBeNull();
    expect(bucketCount(3, ["a", "b", "c"], 3)).toBe(3);
  });
});
