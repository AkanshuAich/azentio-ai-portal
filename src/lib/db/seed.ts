import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import * as s from "./schema";

config({ path: ".env.local" });

const PRODUCTS: Array<[string, string, string, string]> = [
  ["credit-strategy-simulator", "Credit Strategy Simulator", "Credit Intelligence", "Simulate credit policy changes before deployment. Explore potential effects on approvals, risk exposure, and portfolio outcomes."],
  ["sme-credit-decisioning", "SME Credit Decisioning Workbench", "Credit Intelligence", "Bring financial analysis, policy evaluation, risk review, and credit recommendations into one workbench with evidence and human oversight."],
  ["similar-portfolio-intelligence", "Similar Portfolio Intelligence", "Credit Intelligence", "Compare financing applications with relevant historical portfolio segments to understand patterns, risk indicators, and comparable outcomes."],
  ["rejection-intelligence", "Rejection Intelligence", "Credit Intelligence", "Analyze declined applications, uncover rejection patterns, and simulate changes that could improve eligible approvals."],
  ["riva", "RIVA", "Reporting & Analytics", "A configurable reporting environment connecting data sources, mapping report fields, supporting validation, and simplifying reporting workflows."],
  ["financial-analysis-intelligence", "Financial Analysis Intelligence", "Reporting & Analytics", "Turn financial statements into structured analysis, ratios, trends, and decision-ready credit insights."],
  ["document-intelligence", "Document Intelligence", "AI Applications", "Extract, classify, structure, and validate information from financial documents, identity records, and complex inputs."],
  ["persona-newsroom", "Persona Newsroom", "AI Applications", "Discover relevant market news, match stories to executive personas, and generate editable thought-leadership drafts."],
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const db = createDb();

  // Dev-only reset so the seed is repeatable.
  await db.execute(sql`TRUNCATE TABLE
    search_documents, outbox_messages, notifications, improvement_ideas, theme_evidence, themes,
    consents, contribution_reports, moderation_actions, shared_publications, contributions,
    audit_events, entitlements, sessions, invitations, platform_grants, memberships, users, organizations,
    release_notes, knowledge_articles, live_sessions, media_assets, products
    RESTART IDENTITY CASCADE`);

  // Organisations: Azentio plus FOUR fictional clients, one more than the k=3 threshold so
  // suppression can be shown crossing the line in both directions.
  const [az, meridian, nusantara, zahra, atlas] = await db
    .insert(s.organizations)
    .values([
      { kind: "azentio", name: "Azentio", industry: "Software", region: "Global" },
      { kind: "client", name: "Meridian Commercial Bank", industry: "Banking", region: "GCC" },
      { kind: "client", name: "Nusantara Finance", industry: "Lending", region: "South East Asia" },
      { kind: "client", name: "Zahra Takaful", industry: "Insurance", region: "Middle East & Africa" },
      { kind: "client", name: "Atlas Trading Group", industry: "ERP", region: "UAE" },
    ])
    .returning();

  const now = new Date();
  const verified = now;
  const U = await db
    .insert(s.users)
    .values([
      { email: "priya.nair@azentio.com", displayName: "Priya Nair", emailVerifiedAt: verified },
      { email: "omar.haddad@azentio.com", displayName: "Omar Haddad", emailVerifiedAt: verified },
      { email: "lena.fischer@azentio.com", displayName: "Lena Fischer", emailVerifiedAt: verified },
      { email: "ravi.menon@azentio.com", displayName: "Ravi Menon", emailVerifiedAt: verified },
      { email: "sam.okafor@azentio.com", displayName: "Sam Okafor", emailVerifiedAt: verified },
      { email: "amira.khan@meridian.example", displayName: "Amira Khan", emailVerifiedAt: verified },
      { email: "tariq.aziz@meridian.example", displayName: "Tariq Aziz", emailVerifiedAt: verified },
      { email: "dewi.lestari@nusantara.example", displayName: "Dewi Lestari", emailVerifiedAt: verified },
      { email: "budi.santoso@nusantara.example", displayName: "Budi Santoso", emailVerifiedAt: verified },
      { email: "fatima.zahra@zahra.example", displayName: "Fatima Zahra", emailVerifiedAt: verified },
      { email: "john.mercer@atlas.example", displayName: "John Mercer", emailVerifiedAt: verified },
      { email: "yusuf.advisor@advisory.example", displayName: "Yusuf Advisor", emailVerifiedAt: verified },
    ])
    .returning();
  const [priya, omar, lena, ravi, sam, amira, tariq, dewi, budi, fatima, john, yusuf] = U;

  const emp = (userId: string) => ({ userId, orgId: az.id, role: "employee" as const, status: "active" as const, approvedBy: sam.id });
  const cli = (userId: string, orgId: string, role: "client_member" | "client_admin") =>
    ({ userId, orgId, role, status: "active" as const, approvedBy: null });
  await db.insert(s.memberships).values([
    emp(priya.id), emp(omar.id), emp(lena.id), emp(ravi.id), emp(sam.id),
    cli(amira.id, meridian.id, "client_admin"), cli(tariq.id, meridian.id, "client_member"),
    cli(dewi.id, nusantara.id, "client_admin"), cli(budi.id, nusantara.id, "client_member"),
    cli(fatima.id, zahra.id, "client_admin"), cli(john.id, atlas.id, "client_admin"),
    // One user with two memberships, to exercise the explicit workspace switcher.
    cli(yusuf.id, meridian.id, "client_member"), cli(yusuf.id, atlas.id, "client_member"),
  ]);

  // Separate grants. Priya is an ordinary employee and holds none.
  const grant = (userId: string, permission: typeof s.platformGrants.$inferInsert["permission"]) =>
    ({ userId, permission, grantedBy: sam.id });
  await db.insert(s.platformGrants).values([
    grant(omar.id, "learning.moderate"),
    grant(lena.id, "media.publish"),
    grant(ravi.id, "ideas.manage"),
    grant(sam.id, "platform.administer"), grant(sam.id, "members.invite"), grant(sam.id, "roles.grant"),
  ]);

  await db.insert(s.products).values(
    PRODUCTS.map(([slug, name, category, summary]) => ({ slug, name, category, summary, audience: "public" as const })),
  );

  const ent = (orgId: string, slugs: string[]) => slugs.map((productSlug) => ({ orgId, productSlug }));
  await db.insert(s.entitlements).values([
    ...ent(meridian.id, ["credit-strategy-simulator", "sme-credit-decisioning", "financial-analysis-intelligence"]),
    ...ent(nusantara.id, ["sme-credit-decisioning", "financial-analysis-intelligence"]),
    ...ent(zahra.id, ["document-intelligence"]),
    ...ent(atlas.id, ["riva"]),
  ]);

  // --- The brief's illustrative scenario: seasonal SME cash flow, three organisations. ---
  const base = { kind: "market_observation", offering: "financial-analysis-intelligence", evidenceType: "client_experience", confidence: "medium" } as const;
  const [cM, cN, cA, , , , cRejected, cZ1, cZ2] = await db
    .insert(s.contributions)
    .values([
      { ...base, orgId: meridian.id, authorId: tariq.id, title: "Seasonal SME cash flow read as deterioration", body: "Analysts at our bank see SME customers with strong trading seasons flagged as weakening in off-season quarters. Ratios are compared against the prior quarter without any seasonal context.", industry: "Banking", region: "GCC", observationPeriod: "2026-H1", sharingChoice: "propose_shared", status: "published" },
      { ...base, orgId: nusantara.id, authorId: budi.id, title: "Harvest-cycle borrowers look volatile in quarterly analysis", body: "Borrowers tied to harvest cycles show lumpy receipts. Quarter-on-quarter comparisons overstate volatility and trigger unnecessary reviews.", industry: "Lending", region: "South East Asia", observationPeriod: "2026-H1", sharingChoice: "propose_shared", status: "published" },
      { ...base, orgId: atlas.id, authorId: john.id, title: "Seasonal demand swings distort working-capital metrics", body: "Distributors with seasonal demand show working-capital ratios that swing sharply and are hard to explain to credit teams without a seasonality-aware comparison.", industry: "ERP", region: "UAE", observationPeriod: "2026-H1", sharingChoice: "propose_shared", status: "published" },
      // Other lifecycle states, so every screen has realistic data.
      { ...base, orgId: meridian.id, authorId: tariq.id, kind: "improvement_suggestion", title: "Draft: explain covenant breaches in plain language", body: "Early notes, not ready to share.", sharingChoice: "private", status: "draft" },
      { ...base, orgId: zahra.id, authorId: fatima.id, offering: "document-intelligence", title: "Handwritten claim forms lower extraction accuracy", body: "Handwritten fields on legacy claim forms are extracted with noticeably lower confidence than printed fields.", industry: "Insurance", region: "Middle East & Africa", observationPeriod: "2026-Q2", sharingChoice: "propose_shared", status: "submitted" },
      { ...base, orgId: nusantara.id, authorId: dewi.id, title: "Returned: please remove branch-level detail", body: "Observation referencing a specific regional branch.", sharingChoice: "propose_shared", status: "returned" },
      { ...base, orgId: atlas.id, authorId: john.id, kind: "product_gap", title: "Rejected duplicate of an existing suggestion", body: "Duplicate content.", sharingChoice: "propose_shared", status: "rejected" },
      { ...base, orgId: zahra.id, authorId: fatima.id, offering: "document-intelligence", kind: "operational_challenge", title: "Mixed-language forms need locale-aware parsing", body: "Forms mixing Arabic and English fields are mis-classified in the sandbox.", industry: "Insurance", region: "Middle East & Africa", observationPeriod: "2026-Q2", sharingChoice: "propose_shared", status: "published" },
      { ...base, orgId: atlas.id, authorId: john.id, offering: "document-intelligence", kind: "operational_challenge", title: "Scanned delivery notes lose table structure", body: "Scanned multi-page delivery notes lose table structure during extraction.", industry: "ERP", region: "UAE", observationPeriod: "2026-Q2", sharingChoice: "propose_shared", status: "published" },
    ])
    .returning();

  // Reviewed shared representations: de-identified wording, reviewed fields only.
  const pubs = await db
    .insert(s.sharedPublications)
    .values([
      { contributionId: cM.id, title: "Seasonal SME cash flow can be misread as deterioration", body: "Off-season quarters for seasonal SMEs can look like weakening performance when ratios are compared to the prior quarter without seasonal context.", offering: "financial-analysis-intelligence", industry: "Banking", region: "Regional", observationPeriod: "2026-H1", evidenceType: "client_experience", confidence: "medium" },
      { contributionId: cN.id, title: "Harvest-cycle receipts overstate volatility", body: "Quarter-on-quarter comparison of cycle-driven borrowers overstates volatility and can prompt unnecessary reviews.", offering: "financial-analysis-intelligence", industry: "Lending", region: "Regional", observationPeriod: "2026-H1", evidenceType: "client_experience", confidence: "medium" },
      { contributionId: cA.id, title: "Seasonal demand distorts working-capital ratios", body: "Working-capital ratios for seasonal distributors swing sharply and are hard to explain without a seasonality-aware comparison.", offering: "financial-analysis-intelligence", industry: "Trading", region: "Regional", observationPeriod: "2026-H1", evidenceType: "client_experience", confidence: "medium" },
      { contributionId: cZ1.id, title: "Mixed-language forms are mis-classified", body: "Forms combining two scripts can be mis-classified by extraction without locale-aware parsing.", offering: "document-intelligence", industry: "Insurance", region: "Regional", observationPeriod: "2026-Q2", evidenceType: "client_experience", confidence: "low" },
      { contributionId: cZ2.id, title: "Scanned multi-page tables lose structure", body: "Scanned multi-page documents can lose table structure during extraction.", offering: "document-intelligence", industry: "Trading", region: "Regional", observationPeriod: "2026-Q2", evidenceType: "client_experience", confidence: "low" },
    ])
    .returning();

  await db.insert(s.searchDocuments).values(pubs.map((p) => ({ publicationId: p.id, text: `${p.title} ${p.body}` })));

  // Moderation trail, including the one clarification request from the scenario. Private notes stay private.
  await db.insert(s.moderationActions).values([
    { contributionId: cA.id, moderatorId: omar.id, action: "request_clarification", publicReason: "Please confirm the observation period.", privateNotes: "Reviewer: period missing; also named a customer segment." },
    { contributionId: cM.id, moderatorId: omar.id, action: "redact", publicReason: "Removed identifying detail.", privateNotes: "Reviewer: removed bank-specific product name." },
    { contributionId: cM.id, moderatorId: omar.id, action: "publish", publicReason: "Approved shared version.", privateNotes: null },
    { contributionId: cN.id, moderatorId: omar.id, action: "publish", publicReason: "Approved shared version.", privateNotes: null },
    { contributionId: cA.id, moderatorId: omar.id, action: "publish", publicReason: "Approved shared version.", privateNotes: null },
    { contributionId: cRejected.id, moderatorId: omar.id, action: "reject", publicReason: "Duplicate of an existing contribution.", privateNotes: null },
  ]);

  // Consents: four independent permissions. Model training is NOT granted anywhere.
  const consentRows = [cM, cN, cA, cZ1, cZ2].flatMap((c) => [
    { contributionId: c.id, kind: "store_process" as const, granted: true },
    { contributionId: c.id, kind: "publish_shared" as const, granted: true },
    { contributionId: c.id, kind: "attribution" as const, granted: false },
    { contributionId: c.id, kind: "model_training" as const, granted: false },
  ]);
  await db.insert(s.consents).values(consentRows);

  const [seasonality, docs] = await db
    .insert(s.themes)
    .values([
      { title: "Seasonality context", summary: "Seasonal businesses can look weaker in off-season periods when analysis lacks seasonal context.", offering: "financial-analysis-intelligence", limitations: "Small sample: three organisations. This is not evidence of market prevalence or causation." },
      { title: "Document layout and language variety", summary: "Extraction quality drops on mixed-language forms and scanned multi-page tables.", offering: "document-intelligence", limitations: "Only two contributing organisations; below the sharing threshold, so statistics are suppressed." },
    ])
    .returning();
  await db.insert(s.themeEvidence).values([
    { themeId: seasonality.id, publicationId: pubs[0].id },
    { themeId: seasonality.id, publicationId: pubs[1].id },
    { themeId: seasonality.id, publicationId: pubs[2].id },
    { themeId: docs.id, publicationId: pubs[3].id },
    { themeId: docs.id, publicationId: pubs[4].id },
  ]);

  await db.insert(s.improvementIdeas).values({
    title: "Seasonality-aware comparison explanation",
    problem: "Analysis compares periods without seasonal context, so seasonal borrowers look weaker off-season.",
    offering: "financial-analysis-intelligence",
    proposedOutcome: "Explain period-over-period changes against a seasonal baseline.",
    ownerTeam: "Financial Analysis Intelligence",
    priority: "medium",
    status: "under_review", // Under review, not a promised delivery.
    themeId: seasonality.id,
  });

  console.log("Seeded: 5 organisations, 12 users, 8 products, 9 contributions, 2 themes, 1 idea.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
