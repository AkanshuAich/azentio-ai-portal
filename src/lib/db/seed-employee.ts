import type { createDb } from "./client";
import * as s from "./schema";
import { putObject } from "../storage/private";

type Db = ReturnType<typeof createDb>;
interface Person {
  id: string;
  displayName?: string;
}

const slate = (title: string, note: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#171b3a"/><g fill="none" stroke="#55ffbe" stroke-width="2"><path d="M320 80 L380 114 V182 L320 216 L260 182 V114 Z"/></g><text x="320" y="262" fill="#fff" font-family="Arial" font-size="26" text-anchor="middle">${title}</text><text x="320" y="296" fill="#55ffbe" font-family="Arial" font-size="15" text-anchor="middle">${note}</text></svg>`,
  );

/** Employee portal demo content. Everything is fictional; recordings are placeholder slates, not real video. */
export async function seedEmployeeContent(db: Db, u: { priya: Person; omar: Person; lena: Person; ravi: Person }) {
  await putObject("seed/showreel-poster.svg", slate("azentio.ai showreel", "placeholder poster"));
  await putObject("seed/credit-sim-recording.svg", slate("Credit simulator deep dive", "placeholder recording slate (employees only)"));

  const [, rec] = await db
    .insert(s.mediaAssets)
    .values([
      { title: "Product showreel poster", kind: "image", storageKey: "seed/showreel-poster.svg", contentType: "image/svg+xml", byteSize: 700, audience: "public" },
      { title: "Credit simulator deep dive (internal)", kind: "recording", storageKey: "seed/credit-sim-recording.svg", contentType: "image/svg+xml", byteSize: 760, audience: "employee" },
    ])
    .returning();

  const day = 86_400_000;
  await db.insert(s.liveSessions).values([
    { title: "Weekly AI Lab sync", startsAt: new Date(Date.now() + 3 * day), streamRef: "https://stream.example.com/ai-lab-sync", audience: "employee" },
    { title: "Credit simulator deep dive", startsAt: new Date(Date.now() - 10 * day), recordingAssetId: rec.id, audience: "employee" },
    { title: "Hackathon kickoff (open to everyone)", startsAt: new Date(Date.now() + 14 * day), streamRef: "https://stream.example.com/hackathon-kickoff", audience: "public" },
  ]);

  await db.insert(s.knowledgeArticles).values([
    { title: "How we label synthetic data", body: "All demonstration data is generated in-process and labelled SAMPLE DATA. Outputs are labelled SIMULATED. Never paste real customer records into any sandbox.", ownerName: "Priya Nair", createdBy: u.priya.id, reviewDate: "2099-06-30", audience: "employee" },
    { title: "Running a client demo safely", body: "Use the entitled sandbox for the client organisation only. Do not show another client's data, even as an example. Check the entitlement list before the call.", ownerName: "Priya Nair", createdBy: u.priya.id, reviewDate: "2099-03-31", audience: "employee" },
    { title: "Escalating a suspected data leak", body: "If shared content may contain identifying detail, unpublish it first, then notify the moderator on call. This guide is overdue for review.", ownerName: "Omar Haddad", createdBy: u.omar.id, reviewDate: "2025-01-15", audience: "employee" },
  ]);

  await db.insert(s.experiments).values([
    { title: "Seasonality-aware comparison explainer", hypothesis: "Showing a same-quarter comparison beside quarter-on-quarter reduces unnecessary credit referrals.", expectedOutcome: "Fewer false referrals in the synthetic portfolio.", status: "running", ownerId: u.ravi.id, audience: "employee" },
    { title: "Small-model summarisation of moderator notes", hypothesis: "A small language model can draft reviewer summaries that moderators accept with light edits.", status: "proposed", ownerId: u.priya.id, audience: "employee" },
  ]);

  const [team] = await db
    .insert(s.hackathonTeams)
    .values({ name: "Team Seasonality", description: "Prototype a seasonality-aware explanation for Financial Analysis Intelligence.", createdBy: u.ravi.id, audience: "employee" })
    .returning();
  await db.insert(s.hackathonTeamMembers).values([{ teamId: team.id, userId: u.ravi.id }, { teamId: team.id, userId: u.priya.id }]);

  await db.insert(s.releaseNotes).values([
    { title: "Playground 1.2: seasonality scenario", body: "Added the financial-analysis seasonality scenario. Sandbox outputs now carry an explicit not-a-decision notice.", audience: "employee", version: 2 },
    { title: "Portal 1.0: employee workspace", body: "Employee dashboard, knowledge library with review dates, and gated recordings.", audience: "employee", version: 1 },
  ]);

  await db.insert(s.siteBanners).values({ message: "Hackathon registration is open", href: "/hackathon/register", active: false, audience: "public", updatedBy: u.lena.id });
}

/** Client portal demo content. Each item is addressed to one tenant or to one product's entitled clients. */
export async function seedClientContent(
  db: Db,
  o: { meridian: Person; nusantara: Person; amira: Person; tariq: Person },
) {
  await putObject("seed/entitled-demo.svg", slate("Credit strategy walkthrough", "approved demonstration (entitled clients)"));
  await putObject("seed/meridian-briefing.svg", slate("Meridian Q4 briefing", "client briefing for one organisation"));

  const [demo, briefing] = await db
    .insert(s.mediaAssets)
    .values([
      { title: "Credit strategy walkthrough (approved demo)", kind: "video", storageKey: "seed/entitled-demo.svg", contentType: "image/svg+xml", byteSize: 700, audience: "entitled", productSlug: "credit-strategy-simulator" },
      { title: "Meridian Q4 client briefing", kind: "document", storageKey: "seed/meridian-briefing.svg", contentType: "image/svg+xml", byteSize: 700, audience: "tenant", ownerOrgId: o.meridian.id },
    ])
    .returning();

  const day = 86_400_000;
  await db.insert(s.liveSessions).values([
    { title: "Meridian roadmap webinar (invitation only)", startsAt: new Date(Date.now() + 5 * day), streamRef: "https://stream.example.com/meridian-roadmap", audience: "tenant", ownerOrgId: o.meridian.id },
    { title: "Nusantara onboarding session", startsAt: new Date(Date.now() + 2 * day), streamRef: "https://stream.example.com/nusantara-onboarding", audience: "tenant", ownerOrgId: o.nusantara.id },
  ]);

  const [note] = await db
    .insert(s.releaseNotes)
    .values([
      { title: "Release notes for Meridian: sandbox update", body: "The Credit Strategy Simulator sandbox now explains its baseline. Applies to Meridian only.", audience: "tenant", ownerOrgId: o.meridian.id, version: 3 },
      { title: "Release notes for Nusantara: new scenario", body: "A seasonality scenario is now available in your Financial Analysis sandbox.", audience: "tenant", ownerOrgId: o.nusantara.id, version: 3 },
    ])
    .returning();

  await db.insert(s.comments).values([
    { parentType: "media", parentId: briefing.id, orgId: o.meridian.id, authorId: o.amira.id, body: "Thanks. We'll review this with the credit committee." },
    { parentType: "media", parentId: demo.id, orgId: o.meridian.id, authorId: o.tariq.id, body: "Could the walkthrough show a different cutoff?" },
  ]);
  void note;

  await db.insert(s.notifications).values([
    { userId: o.tariq.id, message: "Your contribution 'Seasonal SME cash flow read as deterioration' was approved and published.", href: "/workspace/dashboard" },
    { userId: o.tariq.id, message: "A new briefing was shared with Meridian Commercial Bank.", href: "/workspace/resources" },
  ]);

  await db.insert(s.supportRequests).values({ orgId: o.meridian.id, userId: o.amira.id, subject: "Request to enable the SME workbench sandbox", body: "We would like our credit analysts to try the SME Credit Decisioning Workbench sandbox.", status: "recorded" });
}
