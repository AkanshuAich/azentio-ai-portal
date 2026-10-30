import { desc } from "drizzle-orm";
import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { JsonAction } from "@/components/portal/JsonAction";
import { JsonForm } from "@/components/portal/JsonForm";
import { UploadForm } from "@/components/portal/UploadForm";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { liveSessions, mediaAssets, organizations, products, siteBanners } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const metadata = { title: "Publishing | azentio.ai" };
export const dynamic = "force-dynamic";

const AUD = { employee: "Employees only", public: "Public", tenant: "One client", entitled: "Entitled clients" } as Record<string, string>;

export default async function PublishingPage() {
  // Needs the media.publish grant on top of being an employee (IAM-02).
  const g = await guardEmployee("media.publish");
  if ("denied" in g) return g.denied;
  const db = getDb();
  const [banner] = await db.select().from(siteBanners).limit(1);
  const sessions = await db.select().from(liveSessions).orderBy(desc(liveSessions.startsAt));
  const assets = await db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt));
  const clientOrgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.kind, "client")).orderBy(organizations.name);
  const productList = await db.select({ slug: products.slug, name: products.name }).from(products).orderBy(products.name);
  const orgName = new Map(clientOrgs.map((o) => [o.id, o.name]));

  return (
    <EmployeeShell session={g.session} active="publishing" title="Your publishing workspace." lead="Manage the homepage banner, live sessions and recordings. Every change here is audited.">
      <div className="grid gap-8 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Homepage banner</h2>
          <p className="mb-4 text-sm text-text">Shown at the top of the public site while active.</p>
          <JsonForm url="/api/publishing/banner" submit="Save banner" fields={[
            { name: "message", label: "Message", required: true, maxLength: 200, defaultValue: banner?.message ?? "" },
            { name: "href", label: "Link (site path or https URL, optional)", maxLength: 300, defaultValue: banner?.href ?? "" },
            { name: "active", label: "Show on the public site", type: "checkbox", defaultValue: banner?.active ?? false },
          ]} />
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold">Schedule a live session</h2>
          <p className="mb-4 text-sm text-text">Employees-only sessions never appear on the public site.</p>
          <JsonForm url="/api/publishing/live-sessions" submit="Create session" fields={[
            { name: "title", label: "Title", required: true, maxLength: 140 },
            { name: "startsAt", label: "Starts at", type: "datetime-local" },
            { name: "streamRef", label: "Stream link (https)", type: "url", maxLength: 500 },
            { name: "audience", label: "Audience", type: "select", defaultValue: "employee", options: [{ value: "employee", label: "Employees only" }, { value: "public", label: "Public" }, { value: "tenant", label: "One client organisation (webinar or briefing)" }] },
            { name: "orgId", label: "Client organisation (for the option above)", type: "select", defaultValue: "", options: [{ value: "", label: "—" }, ...clientOrgs.map((o) => ({ value: o.id, label: o.name }))] },
          ]} />
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Upload media or a recording</h2>
          <UploadForm sessions={sessions.map((s) => ({ id: s.id, title: s.title }))} orgs={clientOrgs} products={productList} />
        </Card>

        <section>
          <h2 className="text-lg font-semibold text-ink">Media and who can see it</h2>
          <div className="mt-3 space-y-3">
            {assets.length === 0 ? <Empty>No media uploaded yet.</Empty> : assets.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-xs text-muted">{a.kind} · {a.contentType} · {(a.byteSize / 1024).toFixed(0)} KB</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${a.audience === "public" ? "bg-amber-100 text-amber-900" : "bg-white"}`}>{AUD[a.audience] ?? a.audience}{a.audience === "tenant" && a.ownerOrgId ? `: ${orgName.get(a.ownerOrgId) ?? "?"}` : a.audience === "entitled" ? `: ${a.productSlug}` : ""}</span>
                    <JsonAction
                      url={`/api/publishing/media/${a.id}`} method="PATCH"
                      body={{ audience: a.audience === "employee" ? "public" : "employee" }}
                      label={a.audience === "public" ? "Make employees-only" : a.audience === "employee" ? "Make public" : "Make employees-only"}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </EmployeeShell>
  );
}
