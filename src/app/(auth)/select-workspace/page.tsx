import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ActionButton } from "@/components/auth/ActionButton";
import { getSession } from "@/lib/auth/http";
import { landingFor } from "@/lib/auth/landing";

export const metadata = { title: "Choose a workspace | azentio.ai" };

export default async function SelectWorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/signin");
  if (landingFor(session) !== "/select-workspace") redirect(landingFor(session));

  return (
    <AuthShell label="Multiple memberships" title="Choose a workspace">
      <p className="mb-5 text-sm text-white/80">
        You belong to more than one organisation. Pick the one you want to work in. You can switch at any
        time, and nothing is shared between workspaces.
      </p>
      <ul className="space-y-3">
        {session.workspaces.filter((w) => w.termsAccepted).map((w) => (
          <li key={w.orgId} className="flex items-center justify-between gap-4 rounded-az border border-white/15 p-3">
            <span>{w.orgName}</span>
            <ActionButton url="/api/auth/switch-workspace" body={{ orgId: w.orgId }}>Open</ActionButton>
          </li>
        ))}
      </ul>
    </AuthShell>
  );
}
