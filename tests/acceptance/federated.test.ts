import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditCollector, clientPrincipal, connect, employeePrincipal, makeClientOrg, organiser, uniq } from "../helpers/db";
import type { Db } from "../../src/lib/db/client";
import { ForbiddenError } from "../../src/lib/authz/guard";
import { dbAuditSink } from "../../src/lib/audit/log";
import * as s from "../../src/lib/db/schema";
import { getObject } from "../../src/lib/storage/private";
import { PROGRAMME_CONFIG } from "../../src/lib/db/seed-federated";
import { SCHEMA_VERSION, type Example } from "../../src/lib/federated/types";
import { FederatedError } from "../../src/lib/federated/errors";
import { clientView, decide, employeeOverview, enrol, startRun, withdraw } from "../../src/lib/federated/service";

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

const reset = () => db.execute(sql`TRUNCATE TABLE fl_decisions, fl_model_versions, fl_updates, fl_rounds, fl_runs, fl_enrolments, fl_programmes CASCADE`);
beforeEach(async () => { await reset(); });

async function newProgramme(minCohort = 3) {
  const o = await organiser(db);
  const [p] = await db.insert(s.flProgrammes).values({
    name: `Programme ${uniq()}`, description: "test programme", schemaVersion: SCHEMA_VERSION, minCohort, config: PROGRAMME_CONFIG, createdBy: o.id,
  }).returning();
  return p;
}

async function enrolledOrg(profile?: string) {
  const org = await makeClientOrg(db);
  const admin = await clientPrincipal(db, org.id, "client_admin");
  await enrol(db, admin.principal, auditCollector().sink, { acknowledge: true, profile });
  return { org, admin };
}

const sink = () => auditCollector().sink;
const coordinator = () => employeePrincipal(db, ["federated.coordinate"]);
const approver = () => employeePrincipal(db, ["federated.approve"]);

async function cohort(n: number) {
  await newProgramme(3);
  const profiles = ["seasonal_heavy", "genuine_heavy", "balanced", "small_noisy"];
  const orgs = [];
  for (let i = 0; i < n; i++) orgs.push(await enrolledOrg(profiles[i % profiles.length]));
  return orgs;
}

async function registered() {
  const orgs = await cohort(4);
  const c = await coordinator();
  const r = await startRun(db, c.principal, sink(), {});
  return { orgs, c, r };
}

const forbidden = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ForbiddenError);
const fed = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

describe("P2 enrolment: the client administrator's own, explicit, reversible decision", () => {
  it("only a client administrator of the active organisation can enrol; members and employees cannot", async () => {
    await newProgramme();
    const org = await makeClientOrg(db);
    const member = await clientPrincipal(db, org.id, "client_member");
    const employee = await employeePrincipal(db, ["federated.coordinate", "federated.approve"]);
    await forbidden(enrol(db, member.principal, sink(), { acknowledge: true }));
    await forbidden(enrol(db, employee.principal, sink(), { acknowledge: true }));
    expect(await db.select().from(s.flEnrolments)).toHaveLength(0);
  });

  it("needs an explicit acknowledgement; a bare request enrols nobody", async () => {
    await newProgramme();
    const org = await makeClientOrg(db);
    const admin = await clientPrincipal(db, org.id, "client_admin");
    await fed(enrol(db, admin.principal, sink(), {}), "consent_required");
    await fed(enrol(db, admin.principal, sink(), { acknowledge: false }), "consent_required");
    expect(await db.select().from(s.flEnrolments)).toHaveLength(0);
  });

  it("enrols the SESSION's organisation, uses a pseudonymous reference, and cannot enrol twice", async () => {
    await newProgramme();
    const { org, admin } = await enrolledOrg();
    const [e] = await db.select().from(s.flEnrolments);
    expect(e.orgId).toBe(org.id);
    expect(e.participantRef).toMatch(/^P-[0-9a-f]{6}$/);
    expect(e.participantRef).not.toContain(org.id.slice(0, 6));
    await fed(enrol(db, admin.principal, sink(), { acknowledge: true }), "already_enrolled");
  });

  it("withdrawal affects only the caller's organisation, stops future participation, and can be reversed", async () => {
    await cohort(3);
    const org = (await db.select().from(s.flEnrolments))[0];
    const adm = await clientPrincipal(db, org.orgId, "client_admin");
    await withdraw(db, adm.principal, sink());
    const after = await db.select().from(s.flEnrolments);
    expect(after.find((x) => x.orgId === org.orgId)!.status).toBe("withdrawn");
    expect(after.filter((x) => x.orgId !== org.orgId).every((x) => x.status === "enrolled")).toBe(true);
    await fed(withdraw(db, adm.principal, sink()), "not_enrolled");
    await enrol(db, adm.principal, sink(), { acknowledge: true });
    const [again] = (await db.select().from(s.flEnrolments)).filter((x) => x.orgId === org.orgId);
    expect(again.status).toBe("enrolled");
    expect(again.participantRef).toBe(org.participantRef);
  });

  it("enrolment and withdrawal are audited", async () => {
    await newProgramme();
    const org = await makeClientOrg(db);
    const admin = await clientPrincipal(db, org.id, "client_admin");
    const dbSink = dbAuditSink(db);
    await enrol(db, admin.principal, dbSink, { acknowledge: true });
    await withdraw(db, admin.principal, dbSink);
    const rows = (await db.select().from(s.auditEvents).where(eq(s.auditEvents.orgId, org.id))).map((r) => (r.detail as { reason: string }).reason);
    expect(rows).toEqual(expect.arrayContaining(["organisation enrolled in federated programme", "organisation withdrew from federated programme"]));
  });
});

describe("P2 ordering: a refusal reveals nothing about the programme", () => {
  it("an unauthorised caller is refused before the programme is even looked up", async () => {
    // No programme exists: a non-admin must still get 403, not a 'no programme' answer that confirms state.
    const org = await makeClientOrg(db);
    const member = await clientPrincipal(db, org.id, "client_member");
    await forbidden(enrol(db, member.principal, sink(), { acknowledge: true }));
    await forbidden(withdraw(db, member.principal, sink()));
    await forbidden(startRun(db, (await employeePrincipal(db)).principal, sink(), {}));
  });
});

describe("P2 grants: coordinating and approving are separate, and neither follows from employee status", () => {
  it("running needs federated.coordinate: an ordinary employee, an approver, a moderator and a client admin are all refused", async () => {
    const orgs = await cohort(3);
    for (const who of [await employeePrincipal(db), await approver(), await employeePrincipal(db, ["learning.moderate", "ideas.manage", "platform.administer"])]) {
      await forbidden(startRun(db, who.principal, sink(), {}));
    }
    await forbidden(startRun(db, orgs[0].admin.principal, sink(), {}));
    expect(await db.select().from(s.flRuns)).toHaveLength(0);
  });

  it("deciding needs federated.approve: a coordinator cannot approve what they registered or anything else", async () => {
    const { c, r } = await registered();
    await forbidden(decide(db, c.principal, sink(), r.candidateId!, { action: "approve" }));
    const plain = await employeePrincipal(db);
    await forbidden(decide(db, plain.principal, sink(), r.candidateId!, { action: "approve" }));
  });

  it("refusals are audited with the actor", async () => {
    await cohort(3);
    const e = await employeePrincipal(db);
    const dbSink = dbAuditSink(db);
    await forbidden(startRun(db, e.principal, dbSink, {}));
    const rows = await db.select().from(s.auditEvents).where(eq(s.auditEvents.actorId, e.user.id));
    expect(rows.some((r) => r.action === "coordinate_fl" && r.allowed === false)).toBe(true);
  });

  it("the overview needs one of the two grants", async () => {
    await newProgramme();
    await forbidden(employeeOverview(db, (await employeePrincipal(db)).principal, sink()));
    expect((await employeeOverview(db, (await coordinator()).principal, sink())).canCoordinate).toBe(true);
    const a = await employeeOverview(db, (await approver()).principal, sink());
    expect(a.canApprove).toBe(true);
    expect(a.canCoordinate).toBe(false);
  });
});

describe("P2 runs: minimum cohort, candidates, injected faults", () => {
  it("refuses to run below the minimum cohort and leaves no trace of a run", async () => {
    await cohort(2);
    await fed(startRun(db, (await coordinator()).principal, sink(), {}), "cohort_too_small");
    expect(await db.select().from(s.flRuns)).toHaveLength(0);
  });

  it("a run registers a CANDIDATE and deploys nothing", async () => {
    const { r } = await registered();
    expect(r.roundsCompleted).toBe(8);
    const versions = await db.select().from(s.flModelVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0].status).toBe("candidate");
    expect(versions.some((v) => v.status === "deployed")).toBe(false);
  });

  it("a dropout with four enrolled still completes; with only three enrolled the round is abandoned and nothing is registered", async () => {
    const four = await cohort(4);
    const ok = await startRun(db, (await coordinator()).principal, sink(), { faults: [{ slot: 3, kind: "dropout" }], rounds: 3 });
    expect(ok.roundsCompleted).toBe(3);
    const [run] = await db.select().from(s.flRuns);
    expect(run.injectedFaults).toEqual([expect.objectContaining({ slot: 3, kind: "dropout" })]);
    expect(four).toHaveLength(4);

    await reset();
    await cohort(3);
    const bad = await startRun(db, (await coordinator()).principal, sink(), { faults: [{ slot: 2, kind: "dropout" }], rounds: 3 });
    expect(bad.roundsCompleted).toBe(0);
    expect(bad.candidateId).toBeNull();
    expect(await db.select().from(s.flModelVersions)).toHaveLength(0);
    const rounds = await db.select().from(s.flRounds);
    expect(rounds.every((x) => x.status === "abandoned" && x.abandonReason === "below_minimum_cohort")).toBe(true);
  });

  it("an injected poisoning update is rejected and recorded with its reason", async () => {
    await cohort(4);
    await startRun(db, (await coordinator()).principal, sink(), { faults: [{ slot: 1, kind: "scale_up" }], rounds: 3 });
    const ups = await db.select().from(s.flUpdates);
    const bad = ups.filter((u) => u.status === "rejected");
    expect(bad.length).toBeGreaterThanOrEqual(3);
    expect(bad.every((u) => u.reason && ["poisoning_suspected", "norm_exceeds_hard_limit"].includes(u.reason))).toBe(true);
    expect(new Set(bad.map((u) => u.participantRef)).size).toBe(1);
  });

  it("rejects malformed run requests (bad fault, out-of-range rounds)", async () => {
    await cohort(3);
    const c = (await coordinator()).principal;
    await expect(startRun(db, c, sink(), { rounds: 500 })).rejects.toThrow();
    await expect(startRun(db, c, sink(), { faults: [{ slot: 0, kind: "nonsense" }] })).rejects.toThrow();
    await fed(startRun(db, c, sink(), { faults: [{ slot: 9, kind: "dropout" }] }), "illegal_state");
  });

  it("noise, when requested, is recorded with a declared accountant on the run", async () => {
    await cohort(3);
    await startRun(db, (await coordinator()).principal, sink(), { noiseMultiplier: 1.5, rounds: 4 });
    const [run] = await db.select().from(s.flRuns);
    const dp = run.dp as { epsilon: number; assumptions: string[] };
    expect(dp.epsilon).toBeGreaterThan(0);
    expect(dp.assumptions.join(" ")).toMatch(/coordinator is trusted/);
  });
});

describe("P2 isolation: client training data never reaches the coordinator's records", () => {
  it("no feature value, label or organisation id appears in anything the coordinator persists or logs", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); }));
    try {
      const orgs = await cohort(4);
      await startRun(db, (await coordinator()).principal, dbAuditSink(db), { faults: [{ slot: 0, kind: "sign_flip" }] });

      const values: string[] = [];
      for (const { org } of orgs) {
        const data = JSON.parse((await getObject(`fl/clients/${org.id}.json`)).toString("utf8")) as Example[];
        expect(data.length).toBeGreaterThan(10);
        for (const e of data.slice(0, 40)) for (const v of e.x) values.push(String(v));
      }
      const versions = (await db.select().from(s.flModelVersions)).map((v) => ({ ...v, weights: undefined }));
      const persisted = JSON.stringify([
        await db.select().from(s.flRuns), await db.select().from(s.flRounds), await db.select().from(s.flUpdates),
        await db.select().from(s.flDecisions), versions, await db.select().from(s.auditEvents).where(sql`${s.auditEvents.action} in ('coordinate_fl','approve_fl')`),
      ]);
      for (const v of values) expect(persisted.includes(v), `value ${v} found in coordinator records`).toBe(false);
      for (const v of values) expect(logged.join("\n").includes(v)).toBe(false);
      // Participants are pseudonymous in the run record: no organisation id anywhere.
      for (const { org } of orgs) expect(persisted.includes(org.id)).toBe(false);
      // Updates hold no delta vector.
      expect(Object.keys((await db.select().from(s.flUpdates))[0]).sort()).toEqual(["clippedNorm", "id", "nExamples", "participantRef", "rawNorm", "reason", "roundId", "status", "weight"]);
    } finally {
      spies.forEach((x) => x.mockRestore());
    }
  });

  it("static rule: only the client environment reads client datasets; only the wiring module imports it", () => {
    const root = path.resolve(__dirname, "../../src");
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
    walk(root);
    const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
    const readsClientData = files.filter((f) => readFileSync(f, "utf8").includes("fl/clients/")).map(rel);
    expect(readsClientData).toEqual(["lib/federated/clientEnv.ts"]);
    const importsClientEnv = files.filter((f) => /from\s+["'][^"']*clientEnv["']/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(importsClientEnv).toEqual(["lib/db/seed-federated.ts", "lib/federated/wiring.ts"]);
  });
});

describe("P2 registry: candidates are never auto-deployed; two-person approval; rollback", () => {
  it("the registrar cannot approve their own candidate, even holding both grants", async () => {
    await cohort(3);
    const both = await employeePrincipal(db, ["federated.coordinate", "federated.approve"]);
    const r = await startRun(db, both.principal, sink(), {});
    const dbSink = dbAuditSink(db);
    await forbidden(decide(db, both.principal, dbSink, r.candidateId!, { action: "approve" }));
    expect((await db.select().from(s.flModelVersions))[0].status).toBe("candidate");
    const denied = await db.select().from(s.auditEvents).where(eq(s.auditEvents.actorId, both.user.id));
    expect(denied.some((x) => x.action === "approve_fl" && x.allowed === false)).toBe(true);
  });

  it("candidate → approved → deployed, in order only; each step recorded", async () => {
    const { r } = await registered();
    const a = (await approver()).principal;
    await fed(decide(db, a, sink(), r.candidateId!, { action: "deploy" }), "illegal_state");
    expect(await decide(db, a, sink(), r.candidateId!, { action: "approve" })).toMatchObject({ status: "approved" });
    await fed(decide(db, a, sink(), r.candidateId!, { action: "approve" }), "illegal_state");
    expect(await decide(db, a, sink(), r.candidateId!, { action: "deploy" })).toMatchObject({ status: "deployed" });
    expect((await db.select().from(s.flDecisions)).map((d) => d.action).sort()).toEqual(["approve", "deploy"]);
  });

  it("a rejected model cannot later be approved or deployed", async () => {
    const { r } = await registered();
    const a = (await approver()).principal;
    await decide(db, a, sink(), r.candidateId!, { action: "reject" });
    await fed(decide(db, a, sink(), r.candidateId!, { action: "approve" }), "illegal_state");
    await fed(decide(db, a, sink(), r.candidateId!, { action: "deploy" }), "illegal_state");
  });

  it("deploying a new model supersedes the old one; rollback restores the previous approved model", async () => {
    const { c, r: r1 } = await registered();
    const a = (await approver()).principal;
    await decide(db, a, sink(), r1.candidateId!, { action: "approve" });
    await decide(db, a, sink(), r1.candidateId!, { action: "deploy" });
    const r2 = await startRun(db, c.principal, sink(), { rounds: 4 });
    await decide(db, a, sink(), r2.candidateId!, { action: "approve" });
    await decide(db, a, sink(), r2.candidateId!, { action: "deploy" });
    const status = async () => Object.fromEntries((await db.select().from(s.flModelVersions)).map((v) => [v.id, v.status]));
    expect(await status()).toMatchObject({ [r1.candidateId!]: "superseded", [r2.candidateId!]: "deployed" });
    const out = await decide(db, a, sink(), r2.candidateId!, { action: "rollback" });
    expect(out).toMatchObject({ status: "rolled_back", restored: r1.candidateId });
    expect(await status()).toMatchObject({ [r1.candidateId!]: "deployed", [r2.candidateId!]: "rolled_back" });
    await fed(decide(db, a, sink(), r2.candidateId!, { action: "rollback" }), "illegal_state");
  });

  it("rolling back with no previous model leaves nothing deployed", async () => {
    const { r } = await registered();
    const a = (await approver()).principal;
    await decide(db, a, sink(), r.candidateId!, { action: "approve" });
    await decide(db, a, sink(), r.candidateId!, { action: "deploy" });
    expect(await decide(db, a, sink(), r.candidateId!, { action: "rollback" })).toMatchObject({ restored: null });
    expect((await db.select().from(s.flModelVersions)).some((v) => v.status === "deployed")).toBe(false);
  });
});

describe("P2 withdrawal: stops future participation and flags affected models; it does not untrain", () => {
  it("flags every live model the participant contributed to, blocks approval and deployment until reviewed, and leaves the weights unchanged", async () => {
    const { orgs, r } = await registered();
    const [before] = await db.select().from(s.flModelVersions);
    const out = await withdraw(db, orgs[0].admin.principal, sink());
    expect(out.flaggedModels).toBe(1);
    const [after] = await db.select().from(s.flModelVersions);
    expect(after.needsReview).toBe(true);
    expect(after.needsReviewReason).toMatch(/does not remove/);
    expect(after.weights).toEqual(before.weights);
    const a = (await approver()).principal;
    await fed(decide(db, a, sink(), r.candidateId!, { action: "approve" }), "review_required");
    await fed(decide(db, a, sink(), r.candidateId!, { action: "clear_review", note: "ok" }), "review_required");
    await decide(db, a, sink(), r.candidateId!, { action: "clear_review", note: "Re-run without the withdrawn participant compared within tolerance." });
    expect(await decide(db, a, sink(), r.candidateId!, { action: "approve" })).toMatchObject({ status: "approved" });
  });

  it("an approved-but-flagged model cannot be deployed", async () => {
    const { orgs, r } = await registered();
    const a = (await approver()).principal;
    await decide(db, a, sink(), r.candidateId!, { action: "approve" });
    await withdraw(db, orgs[1].admin.principal, sink());
    await fed(decide(db, a, sink(), r.candidateId!, { action: "deploy" }), "review_required");
  });

  it("a flagged previous model is not restored by a rollback", async () => {
    const { orgs, c, r: r1 } = await registered();
    const a = (await approver()).principal;
    await decide(db, a, sink(), r1.candidateId!, { action: "approve" });
    await decide(db, a, sink(), r1.candidateId!, { action: "deploy" });
    const r2 = await startRun(db, c.principal, sink(), { rounds: 4 });
    await decide(db, a, sink(), r2.candidateId!, { action: "approve" });
    await decide(db, a, sink(), r2.candidateId!, { action: "deploy" });
    await withdraw(db, orgs[0].admin.principal, sink());
    expect(await decide(db, a, sink(), r2.candidateId!, { action: "rollback" })).toMatchObject({ restored: null });
  });

  it("a model trained without the withdrawn participant is not flagged, and they are excluded from later runs", async () => {
    const { orgs, c } = await registered();
    await withdraw(db, orgs[0].admin.principal, sink());
    const [withdrawn] = await db.select().from(s.flEnrolments).where(eq(s.flEnrolments.orgId, orgs[0].org.id));
    const r2 = await startRun(db, c.principal, sink(), { rounds: 3 });
    const v2 = (await db.select().from(s.flModelVersions)).find((v) => v.id === r2.candidateId)!;
    expect(v2.needsReview).toBe(false);
    expect(v2.contributorRefs as string[]).not.toContain(withdrawn.participantRef);
    const ups = await db.select().from(s.flUpdates);
    const rounds = await db.select().from(s.flRounds);
    const lastRun = (await db.select().from(s.flRuns).where(eq(s.flRuns.id, r2.runId)))[0];
    const ids = rounds.filter((x) => x.runId === lastRun.id).map((x) => x.id);
    expect(ups.filter((u) => ids.includes(u.roundId)).some((u) => u.participantRef === withdrawn.participantRef)).toBe(false);
  });

  it("withdrawing below the minimum cohort blocks the next run", async () => {
    const { orgs, c } = await registered();
    await withdraw(db, orgs[0].admin.principal, sink());
    await startRun(db, c.principal, sink(), { rounds: 2 });
    await withdraw(db, orgs[1].admin.principal, sink());
    await fed(startRun(db, c.principal, sink(), { rounds: 2 }), "cohort_too_small");
  });
});

describe("P2 client view: a client sees only its own participation and the deployed model", () => {
  it("shows the caller's own history only and hides other participants, candidates and weights", async () => {
    const { orgs, r } = await registered();
    const mine = await clientView(db, orgs[0].admin.principal);
    expect(mine.enrolment?.status).toBe("enrolled");
    const refs = (await db.select().from(s.flEnrolments)).map((e) => e.participantRef).filter((x) => x !== mine.enrolment!.participantRef);
    const text = JSON.stringify(mine);
    for (const other of refs) expect(text.includes(other)).toBe(false);
    expect(mine.history.length).toBe(8);
    expect(mine.deployedModel).toBeNull();
    expect(text).not.toContain("weights");
    const a = (await approver()).principal;
    await decide(db, a, sink(), r.candidateId!, { action: "approve" });
    expect((await clientView(db, orgs[0].admin.principal)).deployedModel).toBeNull();
    await decide(db, a, sink(), r.candidateId!, { action: "deploy" });
    const after = await clientView(db, orgs[0].admin.principal);
    expect(after.deployedModel?.final.n).toBeGreaterThan(100);
    expect(after.participatingOrganisations).toBe(4);
  });

  it("hides the participant count below the minimum cohort, and shows no history to a non-participant", async () => {
    await cohort(2);
    const org = await makeClientOrg(db);
    const outsider = await clientPrincipal(db, org.id, "client_member");
    const v = await clientView(db, outsider.principal);
    expect(v.participatingOrganisations).toBeNull();
    expect(v.enrolment).toBeNull();
    expect(v.history).toEqual([]);
    expect(v.canManage).toBe(false);
  });

  it("an employee cannot use the client view", async () => {
    await newProgramme();
    await forbidden(clientView(db, (await employeePrincipal(db, ["federated.coordinate"])).principal));
  });

  it("the employee overview shows organisation names against pseudonyms but no weight deltas", async () => {
    await registered();
    const o = await employeeOverview(db, (await coordinator()).principal, sink());
    expect(o.enrolments).toHaveLength(4);
    expect(o.runs[0].rounds[0].updates[0]).not.toHaveProperty("delta");
    expect(JSON.stringify(o)).not.toMatch(/"delta"/);
  });
});

describe("P2 service guard rails", () => {
  it("decision errors are typed so the API returns a stable code", async () => {
    await cohort(3);
    const a = (await approver()).principal;
    await expect(decide(db, a, sink(), "not-a-uuid", { action: "approve" })).rejects.toBeInstanceOf(FederatedError);
    await expect(decide(db, a, sink(), "00000000-0000-0000-0000-000000000000", { action: "approve" })).rejects.toBeInstanceOf(FederatedError);
  });
});
