import { expect, test } from "@playwright/test";
import { persona, signIn, sql, tag } from "./helpers";

test.afterAll(async () => { await sql.end(); });

test.describe("public visitor", () => {
  test("understands the offering, opens a product and requests a demo", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Build Intelligence");
    await page.getByRole("link", { name: "Products", exact: true }).first().click();
    await page.getByRole("link", { name: /Credit Strategy Simulator/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Credit Strategy Simulator");
    await page.getByRole("link", { name: "Request a demo" }).first().click();

    const email = `visitor-${tag()}@example.com`;
    await page.getByLabel("Name", { exact: true }).fill("Visitor One");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Organisation").fill("Example Test Bank");
    await page.getByLabel("What would you like to see?").fill("We would like to see how the simulator explains its baseline.");
    await page.getByLabel(/You may contact me about this enquiry/).check();
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect(page.getByText("we've recorded your enquiry")).toBeVisible();

    const rows = await sql`select product_slug, contact_consent from demo_enquiries where email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ product_slug: "credit-strategy-simulator", contact_consent: true });
  });

  test("sees no private or employee content, and is turned away from protected areas", async ({ page, request }) => {
    await page.goto("/employee/dashboard");
    await expect(page).toHaveURL(/\/signin/);
    await page.goto("/workspace/dashboard");
    await expect(page).toHaveURL(/\/signin/);

    const employeeRecording = (await sql`select id from media_assets where audience = 'employee' limit 1`)[0].id;
    expect((await request.get(`/api/media/${employeeRecording}`)).status()).toBe(401);
    expect((await request.get(`/api/experiments`)).status()).toBe(401);
    expect((await request.get(`/api/learning/search`)).status()).toBe(401);
    const live = await (await request.get("/api/live-sessions")).json();
    expect(live.every((s: { audience: string }) => s.audience === "public")).toBe(true);
  });
});

test.describe("the collective-learning loop, end to end", () => {
  test("a client drafts and submits, a moderator redacts and publishes, another client finds it and asks AIRA, then the author withdraws", async ({ browser }) => {
    const t = tag();
    const title = `Seasonal cash flow signal ${t}`;

    // --- Meridian member writes and submits an observation ---------------------------------------
    const author = await persona(browser, "tariq.aziz@meridian.example");
    const a = author.page;
    await a.goto("/workspace/observations/new");
    await a.getByLabel("Title").fill(title);
    await a.getByLabel("Describe it").fill("Seasonal SMEs can look weaker in off-season quarters when ratios are compared with the prior quarter alone.");
    await a.getByLabel("Industry").fill("Banking");
    await a.getByLabel("Region").fill("GCC");
    await a.getByLabel("Period covered").fill("2026-H1");
    await a.getByLabel("Evidence type").selectOption("client_experience");
    await a.getByLabel("How confident are you?").selectOption("medium");
    await a.getByLabel(/Propose to the approved learning community/).check();
    await a.getByLabel(/Store and process this contribution/).check();
    await a.getByLabel(/Publish a reviewed, de-identified version/).check();
    await a.getByRole("button", { name: "Save private draft" }).click();

    await a.waitForURL(/\/workspace\/observations\/[0-9a-f-]{36}$/);
    const id = a.url().split("/").pop()!;
    await expect(a.getByText("Draft (private to you)")).toBeVisible();
    // Nothing is shared yet: the visibility panel says the original is for the author only.
    await expect(a.getByText("Only you").first()).toBeVisible();

    await a.getByRole("button", { name: "Submit for review" }).click();
    await expect(a.getByText(/Submitted for review/).first()).toBeVisible();

    // --- Another organisation cannot see the private source, and a colleague's view is separate ---
    const reader = await persona(browser, "budi.santoso@nusantara.example");
    const r = reader.page;
    expect((await r.request.get(`/api/contributions/${id}`)).status()).toBe(404);
    await r.goto(`/workspace/learning?q=${t}`);
    await expect(r.getByText("0 approved observations")).toBeVisible();

    // --- The moderator reviews, redacts and publishes ----------------------------------------------
    const mod = await persona(browser, "omar.haddad@azentio.com");
    const m = mod.page;
    await m.goto("/employee/moderation");
    await expect(m.getByText("A contribution was submitted").first()).toHaveCount(0); // queue page, not notifications
    await m.goto(`/employee/moderation/${id}`);
    await expect(m.getByText("Private source (read-only)")).toBeVisible();
    await m.getByRole("button", { name: "Start review" }).click();
    await expect(m.getByRole("button", { name: "Save reviewed copy" })).toBeVisible();
    await m.getByLabel("Region (generalise)").fill("Regional");
    await m.getByRole("button", { name: "Save reviewed copy" }).click();
    await expect(m.getByText("Reviewed copy saved")).toBeVisible();
    await m.getByRole("button", { name: "Publish reviewed copy" }).click();
    await expect(m.getByText("published", { exact: true }).first()).toBeVisible();

    // --- The other organisation finds the de-identified item, and AIRA cites it ----------------------
    await r.goto(`/workspace/learning?q=${t}`);
    await expect(r.getByText("1 approved observation match")).toBeVisible();
    await expect(r.getByRole("heading", { name: title })).toBeVisible();
    await expect(r.getByText("de-identified").first()).toBeVisible();
    await expect(r.getByText("Meridian")).toHaveCount(0);

    await r.getByLabel("Question for AIRA").fill(t);
    await r.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(r.getByText(/Plain retrieval summary|AI summary/)).toBeVisible();
    await expect(r.getByText("[1]").first()).toBeVisible();
    await expect(r.getByText(/not a measure of how common/)).toBeVisible();

    // --- The author withdraws; the item vanishes from search and AIRA at once -------------------------
    a.on("dialog", (d) => d.accept());
    await a.reload();
    await a.getByRole("button", { name: "Withdraw" }).click();
    await expect(a.getByText(/Withdrawn\. Removed from 1 search entries and \d+ AIRA passages in \d+ ms/)).toBeVisible();

    await r.goto(`/workspace/learning?q=${t}`);
    await expect(r.getByText("0 approved observations")).toBeVisible();
    await r.getByLabel("Question for AIRA").fill(t);
    await r.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(r.getByText("No approved evidence found")).toBeVisible();

    const left = await sql`select (select count(*) from search_documents sd join shared_publications p on p.id = sd.publication_id where p.contribution_id = ${id})::int as docs,
                                  (select count(*) from aira_chunks c join shared_publications p on p.id = c.publication_id where p.contribution_id = ${id})::int as chunks`;
    expect(left[0]).toMatchObject({ docs: 0, chunks: 0 });

    for (const p of [author, reader, mod]) await p.ctx.close();
  });
});

test.describe("access boundaries as a user would meet them", () => {
  test("a client sees a clear refusal on employee pages and a forbidden answer from employee APIs", async ({ browser }) => {
    const { ctx, page } = await persona(browser, "amira.khan@meridian.example");
    await page.goto("/employee/dashboard");
    await expect(page.getByText("This area is for Azentio employees")).toBeVisible();
    await page.goto("/employee/moderation");
    await expect(page.getByText("This area is for Azentio employees")).toBeVisible();
    for (const url of ["/api/moderation/queue", "/api/ideas", "/api/experiments", "/api/publishing/live-sessions"]) {
      const res = await page.request.get(url);
      expect([403, 404, 405]).toContain(res.status());
    }
    const other = (await sql`select id from organizations where name = 'Nusantara Finance'`)[0].id;
    const res = await page.request.post("/api/auth/switch-workspace", { data: { orgId: other }, headers: { origin: page.url().split("/").slice(0, 3).join("/") } });
    expect(res.status()).toBe(403);
    await ctx.close();
  });

  test("an ordinary employee gets no moderation or publishing, and a moderator gets no ideas", async ({ browser }) => {
    const priya = await persona(browser, "priya.nair@azentio.com");
    await priya.page.goto("/employee/moderation");
    await expect(priya.page.getByText(/needs the learning\.moderate grant/)).toBeVisible();
    await priya.page.goto("/employee/publishing");
    await expect(priya.page.getByText(/needs the media\.publish grant/)).toBeVisible();
    await expect(priya.page.getByRole("link", { name: "Moderation" })).toHaveCount(0);

    const omar = await persona(browser, "omar.haddad@azentio.com");
    await omar.page.goto("/employee/ideas");
    await expect(omar.page.getByText(/needs the ideas\.manage grant/)).toBeVisible();
    await priya.ctx.close();
    await omar.ctx.close();
  });

  test("response headers: framing is refused and a content security policy is present", async ({ page }) => {
    const res = await page.goto("/");
    const h = res!.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("no page logs a content-security-policy violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => { if (/Content Security Policy|violates the following/i.test(msg.text())) violations.push(msg.text()); });
    for (const url of ["/", "/products", "/products/riva", "/connect", "/signin"]) await page.goto(url);
    await signIn(page, "tariq.aziz@meridian.example");
    for (const url of ["/workspace/dashboard", "/workspace/learning", "/workspace/themes"]) await page.goto(url);
    expect(violations).toEqual([]);
  });
});

test.describe("the simulated federated programme, end to end", () => {
  test("a client enrols, a coordinator runs, a different approver decides, and a withdrawal flags the model", async ({ browser }) => {
    // --- Atlas administrator joins (the fourth organisation; the seed enrolled three) ---------------
    const atlas = await persona(browser, "john.mercer@atlas.example");
    const a = atlas.page;
    await a.goto("/workspace/federated");
    await expect(a.getByText("SYNTHETIC DATA · SIMULATED PROGRAMME")).toBeVisible();
    await expect(a.getByRole("note").getByText("Secure aggregation:")).toBeVisible();
    await expect(a.getByText("Not enrolled.")).toBeVisible();
    await expect(a.getByRole("button", { name: "Enrol this organisation" })).toBeDisabled();
    await a.getByLabel(/I have read the four statements/).check();
    await a.getByRole("button", { name: "Enrol this organisation" }).click();
    await expect(a.getByText(/Enrolled\. In programme logs you appear only as/)).toBeVisible();

    // --- A member (not an administrator) cannot enrol or withdraw --------------------------------
    const tariq = await persona(browser, "tariq.aziz@meridian.example");
    await tariq.page.goto("/workspace/federated");
    await expect(tariq.page.getByText("Only a client administrator can enrol or withdraw")).toBeVisible();
    await expect(tariq.page.getByRole("button", { name: /Enrol|Withdraw/ })).toHaveCount(0);

    // --- Ravi (federated.coordinate) runs it with an injected dropout ----------------------------------
    const ravi = await persona(browser, "ravi.menon@azentio.com");
    const r = ravi.page;
    await r.goto("/employee/federated");
    await expect(r.getByRole("heading", { name: "Participants" })).toBeVisible();
    await r.getByLabel("Fault").selectOption("dropout");
    await r.getByRole("button", { name: "Run simulated programme" }).click();
    await expect(r.getByText(/A candidate model was registered; it is not in use/)).toBeVisible();
    await expect(r.getByText("Injected fault (demonstration):")).toBeVisible();
    await expect(r.getByText("Candidate (not in use)").first()).toBeVisible();
    // Coordinating does not include approving, and he registered it anyway.
    await expect(r.getByText(/Deciding needs the federated\.approve grant/).first()).toBeVisible();
    expect((await sql`select count(*)::int as n from fl_model_versions where status = 'deployed'`)[0].n).toBe(0);

    // --- Sam (federated.approve) approves and deploys ---------------------------------------------
    const sam = await persona(browser, "sam.okafor@azentio.com");
    const sp = sam.page;
    await sp.goto("/employee/federated");
    await expect(sp.getByText(/Starting a run needs the federated\.coordinate grant/)).toBeVisible();
    await sp.getByRole("button", { name: "Approve" }).first().click();
    await expect(sp.getByText("Approved ·").first()).toBeVisible();
    await sp.getByRole("button", { name: /Deploy/ }).first().click();
    await expect(sp.getByText("Deployed (registry state)").first()).toBeVisible();

    // --- Priya has neither grant -----------------------------------------------------------------
    const priya = await persona(browser, "priya.nair@azentio.com");
    await priya.page.goto("/employee/federated");
    await expect(priya.page.getByText(/needs the federated\.coordinate or federated\.approve grant/)).toBeVisible();

    // --- The member now sees the deployed model's synthetic metrics, and only their own history ---
    await tariq.page.goto("/workspace/federated");
    await expect(tariq.page.getByText(/on a synthetic holdout/)).toBeVisible();
    const html = await tariq.page.content();
    const refs = (await sql`select participant_ref from fl_enrolments`).map((x) => x.participant_ref as string);
    expect(refs.filter((x) => html.includes(x)).length).toBeLessThanOrEqual(1);

    // --- Atlas withdraws: the model it contributed to is flagged, not untrained ----------------------
    a.once("dialog", (d) => d.accept());
    await a.reload();
    await a.getByRole("button", { name: "Withdraw this organisation" }).click();
    await expect(a.getByText("Withdrawn. You are excluded from future runs.")).toBeVisible();
    await sp.reload();
    await expect(sp.getByText("Flagged for review.")).toBeVisible();
    await expect(sp.getByRole("button", { name: "Clear review flag" })).toBeVisible();

    for (const p of [atlas, tariq, ravi, sam, priya]) await p.ctx.close();
  });
});
